#!/usr/bin/env node

// Polyfill fetch for Node.js environment
if (!globalThis.fetch) {
  const nodeFetch = await import("node-fetch");
  globalThis.fetch = nodeFetch.default as unknown as typeof fetch;
}

import path from "node:path";
import readline from "node:readline";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { OAuth2Client } from "google-auth-library";
import { loadConfig } from "./config.js";
import { FileAuthStorage } from "./auth/session-storage.js";
import { GoogleOAuthManager } from "./auth/oauth-manager.js";
import { ColabClient } from "./colab/client.js";
import { RuntimeManager } from "./runtime/runtime-manager.js";
import { TerminalSession } from "./runtime/terminal-session.js";
import { RemoteCommandRunner } from "./runtime/remote-command-runner.js";
import { buildPosixCommand } from "./utils/shell.js";
import { Variant } from "./colab/api.js";
import { uploadFileToRuntime } from "./runtime/file-transfer.js";
import { startServeServer } from "./serve/server.js";
import { KNOWN_GEMINI_MODELS } from "./serve/utils.js";
import type { ColabConnection } from "./jupyter/colab-connection.js";
import { ReplyStatus } from "./jupyter/protocol.js";
import type { ExecutionResult } from "./jupyter/protocol.js";
import { queryGpuInfo, formatMemory, calculateMemoryUsage } from "./runtime/gpu-info.js";
import { ExecutionHistoryStorage } from "./runtime/execution-history.js";
import type { HistoryQueryFilters } from "./runtime/execution-history.js";
import { OutputFormatter } from "./utils/output-formatter.js";
import type { StatusInfo, RuntimeInfo } from "./utils/output-formatter.js";
import { ErrorCode, ErrorCategory, formatError } from "./jupyter/error-handler.js";
import { DriveClient } from "./drive/client.js";
import { NotebookManager } from "./drive/notebook-manager.js";
import { SessionStorage } from "./session/session-storage.js";
import { SessionManager, type EnrichedSession, type SessionStats } from "./session/session-manager.js";
import { ConnectionPool } from "./jupyter/connection-pool.js";
import { initFileLogger, LogLevel } from "./utils/file-logger.js";
import { handleSessionsList, switchSession, deleteSession, cleanStaleSessions } from "./commands/sessions-handlers.js";

// Prevent EPIPE errors when piping output (e.g. to head/tail)
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
});

/**
 * Parse Drive API errors and provide user-friendly guidance based on HTTP status codes.
 * 
 * @param error - The error object from a Drive API call
 * @returns Formatted error message with actionable guidance
 */
function formatDriveError(error: unknown): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const debug = Boolean(process.env.LECODER_CGPU_DEBUG);
  
  // Check for specific HTTP status codes in error messages
  if (errorMessage.includes("403") || errorMessage.toLowerCase().includes("forbidden")) {
    return "Access forbidden (403). Your authentication may have expired.\nTry running the command again with --force-login to re-authenticate.";
  }
  
  if (errorMessage.includes("404") || errorMessage.toLowerCase().includes("not found")) {
    return "Notebook not found (404). Please verify the notebook ID is correct.\nYou can list available notebooks with: lecoder-cgpu notebook list";
  }
  
  if (errorMessage.includes("429") || errorMessage.toLowerCase().includes("rate limit")) {
    return "Rate limit exceeded (429). Google Drive API quota exhausted.\nPlease wait a few minutes and try again. Consider adding delays between operations.";
  }
  
  // For other errors, provide the original message
  if (debug) {
    // In debug mode, include full stack trace
    return error instanceof Error && error.stack ? error.stack : errorMessage;
  }
  
  return errorMessage;
}

interface GlobalOptions {
  config?: string;
  forceLogin?: boolean;
  session?: string;
}

interface ConnectCommandOptions extends GlobalOptions {
  newRuntime?: boolean;
  startupCommand?: string;
  startupCode?: string;
  tpu?: boolean;
  cpu?: boolean;
  mode?: "terminal" | "kernel";
}

interface RunCommandOptions extends GlobalOptions {
  newRuntime?: boolean;
  verbose?: boolean;
  tpu?: boolean;
  cpu?: boolean;
  mode?: "terminal" | "kernel";
  json?: boolean;
}

interface CopyCommandOptions extends GlobalOptions {
  newRuntime?: boolean;
  tpu?: boolean;
  cpu?: boolean;
}

async function createApp(configPath?: string) {
  const config = await loadConfig(configPath);
  
  // Initialize file logger for debugging
  // Default to DEBUG level for file logs (useful for troubleshooting)
  // Console output only shown in debug mode
  const logsDir = path.join(config.storageDir, "logs");
  const logger = initFileLogger(logsDir, {
    minLevel: LogLevel.DEBUG,
    consoleOutput: Boolean(process.env.LECODER_CGPU_DEBUG),
  });
  logger.info("CLI", "Application started", { configPath, storageDir: config.storageDir });
  
  const authStorage = new FileAuthStorage(config.storageDir);
  const oauthClient = new OAuth2Client(config.clientId, config.clientSecret);
  const auth = new GoogleOAuthManager(oauthClient, authStorage);
  const colabClient = new ColabClient(
    new URL(config.colabApiDomain),
    new URL(config.colabGapiDomain),
    async () => (await auth.getAccessToken()).accessToken,
  );
  const driveClient = new DriveClient(async () => (await auth.getAccessToken()).accessToken);
  const notebookManager = new NotebookManager(driveClient);
  const sessionStorage = new SessionStorage(config.storageDir);
  const connectionPool = ConnectionPool.getInstance();
  const runtimeManager = new RuntimeManager(colabClient);
  const sessionManager = new SessionManager(sessionStorage, runtimeManager, colabClient, connectionPool);
  return { auth, authStorage, colabClient, driveClient, notebookManager, config, sessionManager, runtimeManager, connectionPool, logger };
}

// Get package version dynamically
// When compiled, this file is at dist/src/index.js, so we need to go up two levels
const require = createRequire(import.meta.url);
const packageJson = require("../../package.json");

const program = new Command();
program
  .name("lecoder-cgpu")
  .version(packageJson.version, "-v, --version", "output the current version")
  .description("LeCoder cGPU - Robust CLI for Google Colab GPU access")
  .option("-c, --config <path>", "path to config file")
  .option("--force-login", "ignore cached session")
  .option("-s, --session <id>", "target a specific session by ID");

program
  .command("connect")
  .description("Authenticate and open a terminal or kernel session on a Colab GPU runtime")
  .option(
    "--new-runtime",
    "Request a brand-new Colab runtime instead of reusing an existing one",
  )
  .option(
    "--startup-command <command>",
    "Custom command to run after the remote terminal attaches (terminal mode only)",
  )
  .option(
    "--startup-code <code>",
    "Python code to execute on kernel startup (kernel mode only)",
  )
  .option("--tpu", "Request a Colab TPU runtime instead of a GPU")
  .option("--cpu", "Request a CPU-only Colab runtime instead of a GPU")
  .option(
    "-m, --mode <type>",
    "Connection mode: 'terminal' for shell access, 'kernel' for Jupyter kernel",
    "terminal",
  )
  .action(async (_args, cmd) => {
    const globalOptions = (cmd.parent?.opts() as GlobalOptions) ?? {};
    const connectOptions = (cmd.opts() as ConnectCommandOptions) ?? {};
    await withApp(globalOptions, async ({ auth, colabClient, sessionManager, runtimeManager, connectionPool }) => {
      const authSession = await auth.getAccessToken(globalOptions.forceLogin);
      console.log(
        chalk.green(
          `Authenticated as ${authSession.account.label} <${authSession.account.id}>`,
        ),
      );
      
      // Update subscription tier for accurate session limits
      await updateSubscriptionTier(colabClient, connectionPool);
      
      // Validate conflicting options
      if (globalOptions.session && (connectOptions.newRuntime || connectOptions.tpu || connectOptions.cpu)) {
        throw new Error("Cannot use --session with --new-runtime, --tpu, or --cpu flags");
      }
      
      // Get or create session
      const variant = resolveVariant(connectOptions);
      const session = await sessionManager.getOrCreateSession(globalOptions.session, {
        variant,
        forceNew: Boolean(connectOptions.newRuntime),
      });
      
      const runtime = session.runtime;
      const mode = connectOptions.mode ?? "terminal";

      if (mode === "kernel") {
        await runKernelMode(
          runtimeManager,
          colabClient,
          runtime,
          connectOptions
        );
      } else {
        const terminal = new TerminalSession(colabClient, runtime, {
          startupCommand: connectOptions.startupCommand,
        });
        await terminal.start();
      }
    });
  });

program
  .command("run")
  .description("Run a shell command or Python code on a Colab runtime")
  .allowUnknownOption()
  .argument("<command...>", "Command to run remotely")
  .option(
    "--new-runtime",
    "Request a brand-new Colab runtime instead of reusing an existing one",
  )
  .option("--tpu", "Request a Colab TPU runtime instead of a GPU")
  .option("--cpu", "Request a Colab CPU runtime instead of a GPU")
  .option("-v, --verbose", "Show detailed logging during the remote run")
  .option(
    "-m, --mode <type>",
    "Execution mode: 'terminal' for shell commands, 'kernel' for Python code",
    "terminal",
  )
  .option("--json", "Output results as JSON for machine parsing")
  .action(async (commandArgs: string[], options: RunCommandOptions, cmd) => {
    if (commandArgs.length === 0) {
      throw new Error("No command provided. Pass the command after 'run'.");
    }
    const commandString = buildPosixCommand(commandArgs, {
      quoteFirstArg: false,
    });
    const globalOptions = (cmd.parent?.opts() as GlobalOptions) ?? {};
    const runOptions = options ?? {};
    const mode = runOptions.mode || "terminal";
    
    await withApp(globalOptions, async ({ auth, colabClient, sessionManager, runtimeManager, connectionPool }) => {
      const authSession = await auth.getAccessToken(globalOptions.forceLogin);
      const jsonMode = Boolean(runOptions.json);
      
      // Update subscription tier for accurate session limits
      await updateSubscriptionTier(colabClient, connectionPool);
      
      if (!jsonMode) {
        console.log(
          chalk.green(
            `Authenticated as ${authSession.account.label} <${authSession.account.id}>`,
          ),
        );
      }
      
      // Validate conflicting options
      if (globalOptions.session && (runOptions.newRuntime || runOptions.tpu || runOptions.cpu)) {
        throw new Error("Cannot use --session with --new-runtime, --tpu, or --cpu flags");
      }
      
      // Get or create session
      const variant = resolveVariant(runOptions);
      const session = await sessionManager.getOrCreateSession(globalOptions.session, {
        variant,
        forceNew: Boolean(runOptions.newRuntime),
      });
      
      const runtime = session.runtime;
      
      const historyStorage = new ExecutionHistoryStorage();
      
      if (mode === "kernel") {
        // Kernel mode: Execute Python code via Jupyter kernel
        let connection;
        try {
          connection = await runtimeManager.createKernelConnection(runtime);
          
          // Attach error handler to prevent unhandled error crash
          connection.on("error", (error: Error) => {
            if (process.env.LECODER_CGPU_DEBUG) {
              console.error(chalk.yellow("Connection error:"), error.message);
            }
          });
        } catch (connError) {
          // Handle connection errors (WebSocket 404, kernel not found, timeout, etc.)
          const errorMessage = connError instanceof Error ? connError.message : String(connError);
          const isNotFound = errorMessage.includes("404") || errorMessage.includes("not found");
          const isTimeout = errorMessage.includes("timeout") || errorMessage.includes("timed out") || 
                           errorMessage.includes("failed to become ready") ||
                           errorMessage.includes("Max reconnection attempts");
          const isAuthError = errorMessage.includes("401") || errorMessage.includes("403") || 
                             errorMessage.includes("Authentication");
          const isBadGateway = errorMessage.includes("502") || errorMessage.includes("Bad Gateway") ||
                              errorMessage.includes("503") || errorMessage.includes("Service Unavailable");
          
          // Determine error category and code
          let errorCode = ErrorCode.IO_ERROR;
          let errorName = "ConnectionError";
          
          if (isTimeout) {
            errorCode = ErrorCode.TIMEOUT_ERROR;
            errorName = "KernelTimeout";
          } else if (isBadGateway) {
            errorCode = ErrorCode.IO_ERROR;
            errorName = "ServiceUnavailable";
          } else if (isNotFound) {
            errorCode = ErrorCode.IO_ERROR;
            errorName = "KernelNotFound";
          } else if (isAuthError) {
            errorCode = ErrorCode.IO_ERROR;
            errorName = "AuthenticationError";
          }
          
          const result: ExecutionResult = {
            status: ReplyStatus.ERROR,
            stdout: "",
            stderr: "",
            traceback: [],
            display_data: [],
            execution_count: null,
            error: {
              ename: errorName,
              evalue: errorMessage,
              traceback: [],
            },
          };
          
          // Store in history
          const entry = ExecutionHistoryStorage.createEntry(
            result,
            commandString,
            "kernel",
            { label: runtime.label, accelerator: runtime.accelerator },
            errorCode
          );
          await historyStorage.append(entry);
          
          if (jsonMode) {
            const jsonOutput = OutputFormatter.formatExecutionResult(result, { json: true });
            console.log(jsonOutput);
          } else {
            console.error(chalk.red(`Connection error: ${errorMessage}`));
            
            // Provide specific suggestions based on error type
            if (isTimeout) {
              console.log(chalk.gray("Tip: Kernel initialization is taking longer than expected."));
              console.log(chalk.gray("  - Try again with --new-runtime to get a fresh runtime"));
              console.log(chalk.gray("  - Wait a moment and retry (runtime may be initializing)"));
              console.log(chalk.gray("  - Check Colab status at https://colab.research.google.com/"));
            } else if (isBadGateway) {
              console.log(chalk.gray("Tip: Colab runtime is temporarily unavailable (502/503 error)."));
              console.log(chalk.gray("  - Wait 10-30 seconds and retry"));
              console.log(chalk.gray("  - Try with --new-runtime to get a different runtime"));
              console.log(chalk.gray("  - Reduce request frequency (avoid rapid successive calls)"));
            } else if (isNotFound) {
              console.log(chalk.gray("Tip: Try using --new-runtime to request a fresh GPU runtime."));
              console.log(chalk.gray("Or run 'lecoder-cgpu sessions clean' to remove stale sessions."));
            } else if (isAuthError) {
              console.log(chalk.gray("Tip: Authentication failed. Try:"));
              console.log(chalk.gray("  - lecoder-cgpu auth --force (re-authenticate)"));
              console.log(chalk.gray("  - lecoder-cgpu run --new-runtime (get fresh runtime)"));
            }
          }
          
          process.exitCode = 1;
          return;
        }
        
        try {
          const result = await connection.executeCode(commandString);
          
          // Store in history
          const entry = ExecutionHistoryStorage.createEntry(
            result,
            commandString,
            "kernel",
            { label: runtime.label, accelerator: runtime.accelerator },
            result.status === ReplyStatus.OK ? ErrorCode.SUCCESS : undefined
          );
          await historyStorage.append(entry);
          
          // Output result
          if (jsonMode) {
            const jsonOutput = OutputFormatter.formatExecutionResult(result, { json: true });
            // Ensure output is flushed to stdout
            console.log(jsonOutput);
            // Force flush stdout to prevent empty output issues
            if (process.stdout.isTTY) {
              process.stdout.write("");
            }
          } else {
            displayExecutionResult(result, false);
          }
          
          process.exitCode = result.status === ReplyStatus.OK ? 0 : 1;
        } finally {
          await connection.shutdown();
        }
      } else {
        // Terminal mode (default): Execute shell command via terminal WebSocket
        const runner = new RemoteCommandRunner(colabClient, runtime, {
          verbose: Boolean(runOptions.verbose),
        });
        const exitCode = await runner.run(commandString);
        
        // Create execution result for history
        const result: ExecutionResult = {
          status: exitCode === 0 ? ReplyStatus.OK : ReplyStatus.ERROR,
          stdout: "",
          stderr: "",
          traceback: [],
          display_data: [],
          execution_count: null,
        };
        
        const entry = ExecutionHistoryStorage.createEntry(
          result,
          commandString,
          "terminal",
          { label: runtime.label, accelerator: runtime.accelerator },
          exitCode === 0 ? ErrorCode.SUCCESS : ErrorCode.RUNTIME_ERROR
        );
        await historyStorage.append(entry);
        
        if (jsonMode) {
          const jsonOutput = OutputFormatter.formatExecutionResult(result, { json: true });
          console.log(jsonOutput);
        }
        
        process.exitCode = exitCode;
      }
    });
  });

program
  .command("copy")
  .description("Upload a local file to your Colab runtime")
  .argument("<source>", "Local file to copy")
  .argument(
    "[destination]",
    "Remote path (defaults to /content/<filename>)",
  )
  .option(
    "--new-runtime",
    "Request a brand-new Colab runtime instead of reusing an existing one",
  )
  .option("--tpu", "Request a Colab TPU runtime instead of a GPU")
  .option("--cpu", "Request a Colab CPU runtime instead of a GPU")
  .action(async (
    source: string,
    destination: string | undefined,
    options: CopyCommandOptions,
    cmd,
  ) => {
    const globalOptions = (cmd.parent?.opts() as GlobalOptions) ?? {};
    const copyOptions = options ?? {};
    await withApp(globalOptions, async ({ auth, sessionManager, colabClient, connectionPool }) => {
      const authSession = await auth.getAccessToken(globalOptions.forceLogin);
      console.log(
        chalk.green(
          `Authenticated as ${authSession.account.label} <${authSession.account.id}>`,
        ),
      );
      
      // Update subscription tier for accurate session limits
      await updateSubscriptionTier(colabClient, connectionPool);
      
      // Validate conflicting options
      if (globalOptions.session && (copyOptions.newRuntime || copyOptions.tpu || copyOptions.cpu)) {
        throw new Error("Cannot use --session with --new-runtime, --tpu, or --cpu flags");
      }
      
      // Get or create session
      const variant = resolveVariant(copyOptions);
      const session = await sessionManager.getOrCreateSession(globalOptions.session, {
        variant,
        forceNew: Boolean(copyOptions.newRuntime),
      });
      
      const runtime = session.runtime;
      const result = await uploadFileToRuntime({
        runtime,
        localPath: source,
        remotePath: destination,
      });
      console.log(
        `${chalk.green("Uploaded")}: ${path.basename(source)} → ${result.remotePath} (${formatBytes(result.bytes)})`,
      );
    });
  });

program
  .command("status")
  .description("Show authentication status, active runtime details, and sessions")
  .option("--json", "Output status as JSON for machine parsing")
  .action(async (cmdOptions, cmd) => {
    const globalOptions = (cmd.parent?.opts() as GlobalOptions) ?? {};
    const jsonMode = Boolean(cmdOptions.json);
    const targetSessionId = globalOptions.session;
    await withApp(globalOptions, async ({ auth, colabClient, sessionManager, connectionPool }) => {
      const session = await auth.getAccessToken(globalOptions.forceLogin);
      const ccu = await colabClient.getCcuInfo();
      
      // Update subscription tier for accurate limits/tier display
      await updateSubscriptionTier(colabClient, connectionPool);
      let targetSession: EnrichedSession | undefined;

      if (targetSessionId) {
        try {
          const sessions = await sessionManager.listSessions();
          
          // Try exact match first
          targetSession = sessions.find((s) => s.id === targetSessionId);
          
          // If not found, try prefix match
          if (!targetSession && targetSessionId.length >= 4) {
            const matches = sessions.filter((s) => s.id.startsWith(targetSessionId));
            if (matches.length === 1) {
              targetSession = matches[0];
            } else if (matches.length > 1) {
              const matchIds = matches.map(s => s.id.substring(0, 8)).join(", ");
              throw new Error(`Ambiguous session ID "${targetSessionId}". Matches: ${matchIds}`);
            }
          }

          if (!targetSession) {
            throw new Error(`Session not found: ${targetSessionId}`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Unable to load session ${targetSessionId}: ${message}`);
        }
      }
      
      // Collect status information
      const statusInfo: StatusInfo = {
        authenticated: true,
        account: {
          id: session.account.id,
          label: session.account.label,
        },
        eligibleGpus: ccu.eligibleGpus,
        runtimes: [],
      };

      // Collect session statistics
      let sessionStats: SessionStats | undefined;
      let activeSessionDetails: { id: string; label: string; runtime: string } | undefined;
      try {
        sessionStats = await sessionManager.getStats();
        const sessions = await sessionManager.listSessions();
        const activeSess = sessions.find((s) => s.isActive);
        
        statusInfo.sessions = {
          total: sessionStats.totalSessions,
          active: sessionStats.activeSessions,
          connected: sessionStats.connectedSessions,
          stale: sessionStats.staleSessions,
          max: sessionStats.maxSessions,
          tier: sessionStats.tier,
        };

        if (activeSess) {
          activeSessionDetails = {
            id: activeSess.id,
            label: activeSess.label,
            runtime: activeSess.runtime.label,
          };
          statusInfo.sessions.activeSession = activeSessionDetails;
        }
      } catch (error) {
        // Session info unavailable (e.g. storage error), continue without it
        if (process.env.LECODER_CGPU_DEBUG && !jsonMode) {
           console.error(chalk.yellow("Warning: Could not fetch session stats"), error);
        }
      }
      
      // Check for active runtimes
      try {
        const assignments = await colabClient.listAssignments();
        const assignmentsToInspect = targetSession
          ? assignments.filter((assignment) => assignment.endpoint === targetSession.runtime.endpoint)
          : assignments;

        if (targetSession && assignmentsToInspect.length === 0) {
          statusInfo.runtimes.push({
            label: targetSession.runtime.label,
            endpoint: targetSession.runtime.endpoint,
            accelerator: targetSession.runtime.accelerator,
            connected: false,
          });
        }
        
        const runtimePromises = assignmentsToInspect.map(async (assignment) => {
          const runtimeLabel = `Colab ${assignment.variant} ${assignment.accelerator}`;
          const runtimeInfo: RuntimeInfo = {
            label: runtimeLabel,
            endpoint: assignment.endpoint,
            accelerator: assignment.accelerator,
            connected: false,
          };

          try {
            // Get runtime proxy info to verify connectivity
            const proxy = await colabClient.refreshConnection(assignment.endpoint);
            
            const runtime = {
              label: runtimeLabel,
              accelerator: assignment.accelerator,
              endpoint: assignment.endpoint,
              proxy,
            };

            runtimeInfo.connected = true;
            
            // Try to get GPU info if it's a GPU runtime
            if (assignment.accelerator && assignment.accelerator.toLowerCase() !== "none") {
              try {
                const runner = new RemoteCommandRunner(colabClient, runtime);
                const gpuInfo = await queryGpuInfo(runner);
                
                if (gpuInfo) {
                  runtimeInfo.gpu = {
                    name: gpuInfo.name,
                    memory: {
                      total: formatMemory(gpuInfo.memoryTotal),
                      used: formatMemory(gpuInfo.memoryUsed),
                      free: formatMemory(gpuInfo.memoryTotal - gpuInfo.memoryUsed),
                    },
                    utilization: {
                      gpu: `${gpuInfo.utilization}%`,
                      memory: `${calculateMemoryUsage(gpuInfo.memoryUsed, gpuInfo.memoryTotal)}%`,
                    },
                  };
                }
              } catch {
                // GPU info unavailable, continue without it
              }
            }

            // Try to get kernel status
            try {
              const kernels = await colabClient.listKernels(proxy.url, proxy.token);

              if (kernels.length > 0) {
                const kernel = kernels[0];
                runtimeInfo.kernel = {
                  id: kernel.id,
                  state: kernel.executionState,
                  executionCount: kernel.connections,
                };
              }
            } catch {
              // Kernel info unavailable
            }
          } catch {
            // Connection failed, runtimeInfo.connected is already false
          }
          return runtimeInfo;
        });

        const results = await Promise.all(runtimePromises);
        statusInfo.runtimes.push(...results);
      } catch (error) {
        // Gracefully handle errors fetching assignments
        if (process.env.LECODER_CGPU_DEBUG && !jsonMode) {
          console.error(chalk.yellow("\nWarning: Could not fetch runtime assignments"));
          console.error(error);
        }
      }

      // Output results
      if (jsonMode) {
        const jsonOutput = OutputFormatter.formatStatus(statusInfo, true);
        console.log(jsonOutput);
      } else {
        // Human-readable output
        console.log(
          `${chalk.green("✓ Authenticated")} as ${session.account.label}`,
        );
        console.log(
          `  Eligible GPUs: ${ccu.eligibleGpus.join(", ")}`,
        );
        if (targetSession) {
          console.log(
            chalk.gray(
              `  Showing runtimes for session ${targetSession.id.substring(0, 8)} (${targetSession.label})`,
            ),
          );
        }
        
        if (statusInfo.runtimes.length === 0) {
          console.log(chalk.gray("\nNo active runtimes"));
          return;
        }
        
        console.log(chalk.bold("\nActive Runtimes:"));
        
        for (const runtimeInfo of statusInfo.runtimes) {
          console.log(chalk.bold(`\n┌─ Runtime: ${runtimeInfo.label}`));
          console.log(chalk.gray(`│  Endpoint: ${runtimeInfo.endpoint}`));
          console.log(chalk.gray(`│  Accelerator: ${runtimeInfo.accelerator}`));
          
          if (runtimeInfo.gpu) {
            console.log(chalk.gray(`│  GPU: ${runtimeInfo.gpu.name}`));
            const memUsagePercent = Number.parseInt(runtimeInfo.gpu.utilization.memory.replace("%", ""), 10);
            const memColor = memUsagePercent > 80 ? chalk.yellow : chalk.gray;
            console.log(memColor(`│  GPU Memory: ${runtimeInfo.gpu.memory.used} / ${runtimeInfo.gpu.memory.total} (${runtimeInfo.gpu.utilization.memory})`));
            console.log(chalk.gray(`│  GPU Utilization: ${runtimeInfo.gpu.utilization.gpu}`));
          }
          
          if (runtimeInfo.kernel) {
            console.log(chalk.gray(`│  Kernel: ${runtimeInfo.kernel.id} (${runtimeInfo.kernel.state})`));
            console.log(chalk.gray(`│  Connections: ${runtimeInfo.kernel.executionCount}`));
          } else if (runtimeInfo.connected) {
            console.log(chalk.gray(`│  Kernel: None active`));
          }
          
          if (runtimeInfo.connected) {
            console.log(chalk.green(`│  Status: Connected`));
          } else {
            console.log(chalk.red(`│  Status: Disconnected`));
          }
          
          console.log(chalk.bold("└─"));
        }
        
        // Show session information
        if (sessionStats) {
          console.log(chalk.bold("\nSessions:"));
          console.log(`  Total: ${sessionStats.totalSessions} / ${sessionStats.maxSessions} (${sessionStats.tier} tier)`);
          
          if (activeSessionDetails) {
            console.log(`  Active Session: ${chalk.bold(activeSessionDetails.id.substring(0, 8))} (${activeSessionDetails.label})`);
          }

          if (sessionStats.totalSessions > 0) {
            console.log(`  ${chalk.green("●")} Active: ${sessionStats.activeSessions}`);
            console.log(`  ${chalk.blue("●")} Connected: ${sessionStats.connectedSessions}`);
            if (sessionStats.staleSessions > 0) {
              console.log(`  ${chalk.red("●")} Stale: ${sessionStats.staleSessions} (run 'lecoder-cgpu sessions clean' to remove)`);
            }
          }
        }
      }
    });
  });

program
  .command("auth")
  .description("Authenticate or re-authenticate with Google Colab")
  .option("-f, --force", "Skip confirmation if already authenticated")
  .option("--select-account", "Show account picker to login with a different Google account")
  .option("--validate", "Verify credentials with a test API call")
  .action(async (options, cmd) => {
    const globalOptions = (cmd.parent?.opts() as GlobalOptions) ?? {};
    const selectAccount = Boolean(options.selectAccount);
    
    await withApp(globalOptions, async ({ auth, colabClient }) => {
      let existingSession: Awaited<ReturnType<typeof auth.getAccessToken>> | undefined;
      
      // Check if already authenticated (use checkExistingSession to avoid triggering login)
      try {
        existingSession = await auth.checkExistingSession();
      } catch {
        // No existing session, proceed with fresh authentication
        existingSession = undefined;
      }

      // If --select-account is used, always proceed with authentication
      // to allow switching accounts without prompting
      if (selectAccount) {
        if (existingSession) {
          console.log(
            chalk.yellow(
              `Currently authenticated as ${existingSession.account.label} <${existingSession.account.id}>`
            )
          );
          console.log(chalk.cyan("Switching accounts..."));
          await auth.signOut();
        }
        
        const session = await auth.getAccessToken(true, { selectAccount: true });
        console.log(
          chalk.green(
            `✓ Authenticated as ${session.account.label} <${session.account.id}>`
          )
        );
        
        displaySetupReminder();
        
        if (options.validate) {
          await validateCredentials(colabClient);
        }
        return;
      }

      // If session exists and neither --force nor --force-login is set, prompt for confirmation
      if (existingSession && !options.force && !globalOptions.forceLogin) {
        console.log(
          chalk.yellow(
            `Currently authenticated as ${existingSession.account.label} <${existingSession.account.id}>`
          )
        );
        
        // Check if running in interactive terminal
        if (process.stdin.isTTY) {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          
          try {
            const answer = await new Promise<string>((resolve) => {
              rl.question(
                "Re-authenticate? This will clear your current session. (y/N): ",
                resolve
              );
            });
            
            const yesPattern = /^y(es)?$/;
            if (!yesPattern.exec(answer.toLowerCase())) {
              console.log(chalk.gray("Authentication cancelled."));
              console.log(chalk.gray("Tip: Use --select-account to login with a different Google account."));
              return;
            }
          } finally {
            rl.close();
          }
        }
      }

      // Clear existing session if any (or if --force-login was used)
      if (existingSession || globalOptions.forceLogin) {
        await auth.signOut();
      }

      // Perform authentication
      const session = await auth.getAccessToken(true);
      console.log(
        chalk.green(
          `✓ Authenticated as ${session.account.label} <${session.account.id}>`
        )
      );
      
      displaySetupReminder();

      // Validate credentials if requested
      if (options.validate) {
        await validateCredentials(colabClient);
      }
    });
  });

program
  .command("auth-export")
  .description("Export session token for use in headless/container environments")
  .option("--json", "Output as JSON for programmatic use")
  .action(async (options, cmd) => {
    const globalOptions = (cmd.parent?.opts() as GlobalOptions) ?? {};
    
    await withApp(globalOptions, async ({ auth, authStorage }) => {
      const session = await auth.checkExistingSession();
      
      if (!session) {
        if (options.json) {
          console.log(JSON.stringify({
            status: "error",
            errorCode: 1,
            error: { message: "Not authenticated. Run 'lecoder-cgpu auth' first." }
          }, null, 2));
        } else {
          console.log(chalk.red("Not authenticated. Run 'lecoder-cgpu auth' first."));
        }
        process.exit(1);
        return;
      }

      // Get the stored session with refresh token
      const storedSession = await authStorage.getSession();
      if (!storedSession) {
        if (options.json) {
          console.log(JSON.stringify({
            status: "error",
            errorCode: 1,
            error: { message: "Session file not found." }
          }, null, 2));
        } else {
          console.log(chalk.red("Session file not found."));
        }
        process.exit(1);
        return;
      }

      if (options.json) {
        console.log(JSON.stringify({
          status: "ok",
          session: storedSession,
          instructions: "Use 'lecoder-cgpu auth-import' to import this session on another machine"
        }, null, 2));
      } else {
        console.log(chalk.cyan("Session Token Export"));
        console.log(chalk.gray("─".repeat(50)));
        console.log(chalk.yellow("\n⚠️  Keep this token secret! It grants access to your Colab account.\n"));
        console.log(chalk.bold("Copy this entire JSON object:"));
        console.log();
        console.log(JSON.stringify(storedSession, null, 2));
        console.log();
        console.log(chalk.gray("To import on another machine or container:"));
        console.log(chalk.cyan("  lecoder-cgpu auth-import '<paste JSON here>'"));
        console.log();
        console.log(chalk.gray("Or pipe from a file:"));
        console.log(chalk.cyan("  cat session.json | lecoder-cgpu auth-import -"));
      }
    });
  });

program
  .command("auth-import")
  .description("Import session token for headless/container environments")
  .argument("[token]", "Session token JSON (or '-' to read from stdin)")
  .option("--json", "Output as JSON for programmatic use")
  .option("-f, --force", "Overwrite existing session without confirmation")
  .action(async (tokenArg: string | undefined, options, cmd) => {
    const globalOptions = (cmd.parent?.opts() as GlobalOptions) ?? {};
    
    let tokenJson: string;
    
    // Read token from argument or stdin
    if (!tokenArg || tokenArg === "-") {
      // Read from stdin
      if (process.stdin.isTTY && !tokenArg) {
        if (options.json) {
          console.log(JSON.stringify({
            status: "error",
            errorCode: 1,
            error: { message: "No token provided. Pass token as argument or pipe from stdin." }
          }, null, 2));
        } else {
          console.log(chalk.red("No token provided."));
          console.log(chalk.gray("Usage: lecoder-cgpu auth-import '<session JSON>'"));
          console.log(chalk.gray("   or: cat session.json | lecoder-cgpu auth-import -"));
        }
        process.exit(1);
        return;
      }
      
      // Read from stdin
      const chunks: string[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(String(chunk));
      }
      tokenJson = chunks.join("").trim();
    } else {
      tokenJson = tokenArg;
    }
    
    // Parse and validate the token
    let session: {
      id: string;
      refreshToken: string;
      scopes: string[];
      account: { id: string; label: string };
    };
    
    try {
      session = JSON.parse(tokenJson);
      
      // Validate required fields
      if (!session.id || !session.refreshToken || !session.scopes || !session.account) {
        throw new Error("Missing required fields");
      }
      if (!session.account.id || !session.account.label) {
        throw new Error("Invalid account object");
      }
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({
          status: "error",
          errorCode: 1,
          error: { message: `Invalid session JSON: ${(err as Error).message}` }
        }, null, 2));
      } else {
        console.log(chalk.red(`Invalid session JSON: ${(err as Error).message}`));
        console.log(chalk.gray("Expected format: { id, refreshToken, scopes, account: { id, label } }"));
      }
      process.exit(1);
      return;
    }
    
    await withApp(globalOptions, async ({ auth, authStorage }) => {
      // Check for existing session
      const existingSession = await auth.checkExistingSession();
      
      if (existingSession && !options.force) {
        if (process.stdin.isTTY && !options.json) {
          console.log(chalk.yellow(`Currently authenticated as ${existingSession.account.label} <${existingSession.account.id}>`));
          
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          
          try {
            const answer = await new Promise<string>((resolve) => {
              rl.question("Replace with imported session? (y/N): ", resolve);
            });
            
            if (!/^y(es)?$/i.test(answer)) {
              console.log(chalk.gray("Import cancelled."));
              return;
            }
          } finally {
            rl.close();
          }
        } else if (!options.force) {
          if (options.json) {
            console.log(JSON.stringify({
              status: "error",
              errorCode: 1,
              error: { message: "Session already exists. Use --force to overwrite." }
            }, null, 2));
          } else {
            console.log(chalk.red("Session already exists. Use --force to overwrite."));
          }
          process.exit(1);
          return;
        }
      }
      
      // Store the imported session
      await authStorage.storeSession(session);
      
      if (options.json) {
        console.log(JSON.stringify({
          status: "ok",
          account: session.account,
          message: "Session imported successfully"
        }, null, 2));
      } else {
        console.log(chalk.green(`✓ Session imported for ${session.account.label} <${session.account.id}>`));
        console.log(chalk.gray("Run 'lecoder-cgpu status' to verify."));
      }
    });
  });

program
  .command("logout")
  .description("Forget cached credentials")
  .option("--all", "Remove ALL configuration including OAuth app credentials (complete reset)")
  .action(async (options, cmd) => {
    const globalOpts = (cmd.parent?.opts() as GlobalOptions) ?? {};
    
    if (options.all) {
      // Complete reset - remove everything
      if (process.stdin.isTTY) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        
        try {
          console.log(chalk.yellow("This will remove ALL configuration including:"));
          console.log(chalk.gray("  • OAuth app credentials (client ID/secret)"));
          console.log(chalk.gray("  • User session token"));
          console.log(chalk.gray("  • Execution history"));
          console.log(chalk.gray("  • Debug logs"));
          console.log();
          
          const answer = await new Promise<string>((resolve) => {
            rl.question(
              chalk.yellow("Are you sure you want to completely reset? (y/N): "),
              resolve
            );
          });
          
          const yesPattern = /^y(es)?$/;
          if (!yesPattern.exec(answer.toLowerCase())) {
            console.log(chalk.gray("Reset cancelled."));
            return;
          }
        } finally {
          rl.close();
        }
      }
      
      // Import and use removeAllConfig
      const { removeAllConfig, getDefaultConfigDir } = await import("./config.js");
      const configDir = getDefaultConfigDir();
      await removeAllConfig();
      console.log(chalk.yellow(`✓ Removed all configuration from ${configDir}`));
      console.log(chalk.gray("Run 'lecoder-cgpu auth login' to set up fresh credentials."));
      return;
    }
    
    // Standard logout - only remove session
    await withApp(globalOpts, async ({ auth }) => {
      await auth.signOut();
      console.log(chalk.yellow("Signed out and cleared session cache."));
      console.log(chalk.gray("Tip: Use 'logout --all' to completely reset (remove OAuth app credentials too)."));
    });
  });

program
  .command("logs")
  .description("Retrieve execution history from previous runs")
  .option("-n, --limit <number>", "Maximum number of entries to show", "50")
  .option("--status <status>", "Filter by status: ok, error, abort")
  .option("--category <category>", "Filter by error category")
  .option("--since <date>", "Show entries since date (ISO 8601 or relative like '1h', '1d')")
  .option("--mode <mode>", "Filter by execution mode: terminal, kernel")
  .option("--json", "Output as JSON")
  .option("--clear", "Clear all execution history")
  .option("--stats", "Show summary statistics instead of entries")
  .action(async (options) => {
    const historyStorage = new ExecutionHistoryStorage();

    // Handle clear flag
    if (options.clear) {
      await historyStorage.clear();
      if (options.json) {
        console.log(JSON.stringify({ cleared: true }));
      } else {
        console.log(chalk.green("✓ Execution history cleared"));
      }
      return;
    }

    // Handle stats flag
    if (options.stats) {
      const stats = await historyStorage.getStats();
      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(chalk.bold("Execution History Statistics"));
        console.log(chalk.gray("─".repeat(50)));
        console.log(`Total executions: ${stats.totalExecutions}`);
        console.log(`${chalk.green("✓")} Successful: ${stats.successfulExecutions}`);
        console.log(`${chalk.red("✗")} Failed: ${stats.failedExecutions}`);
        console.log(`${chalk.yellow("⚠")} Aborted: ${stats.abortedExecutions}`);
        console.log(`Success rate: ${stats.successRate.toFixed(1)}%`);
        console.log(`\\nBy mode:`);
        console.log(`  Terminal: ${stats.executionsByMode.terminal}`);
        console.log(`  Kernel: ${stats.executionsByMode.kernel}`);
        if (Object.keys(stats.errorsByCategory).length > 0) {
          console.log(`\\nErrors by category:`);
          for (const [category, count] of Object.entries(stats.errorsByCategory)) {
            console.log(`  ${category}: ${count}`);
          }
        }
        if (stats.oldestEntry) {
          console.log(`\\nOldest entry: ${stats.oldestEntry.toISOString()}`);
        }
        if (stats.newestEntry) {
          console.log(`Newest entry: ${stats.newestEntry.toISOString()}`);
        }
      }
      return;
    }

    // Parse filters
    const filters: HistoryQueryFilters = {};
    
    if (options.limit) {
      filters.limit = Number.parseInt(options.limit, 10);
    }
    
    if (options.status) {
      filters.status = options.status as ReplyStatus;
    }
    
    if (options.category) {
      // Map user input to ErrorCategory (case-insensitive)
      const categoryInput = options.category.toLowerCase();
      const validCategories: Record<string, ErrorCategory> = {
        'syntax': ErrorCategory.SYNTAX,
        'runtime': ErrorCategory.RUNTIME,
        'timeout': ErrorCategory.TIMEOUT,
        'memory': ErrorCategory.MEMORY,
        'import': ErrorCategory.IMPORT,
        'io': ErrorCategory.IO,
        'unknown': ErrorCategory.UNKNOWN,
      };
      
      if (categoryInput in validCategories) {
        filters.category = validCategories[categoryInput];
      } else {
        console.error(chalk.red(`Invalid category: ${options.category}`));
        console.error(chalk.gray(`Valid categories: ${Object.keys(validCategories).join(', ')}`));
        process.exit(1);
      }
    }
    
    if (options.mode) {
      filters.mode = options.mode as "terminal" | "kernel";
    }
    
    if (options.since) {
      filters.since = parseRelativeDate(options.since);
    }

    // Query history
    const entries = await historyStorage.query(filters);

    // Output results
    if (options.json) {
      console.log(OutputFormatter.formatHistoryList(entries, true));
    } else {
      if (entries.length === 0) {
        console.log(chalk.gray("No execution history found"));
        return;
      }

      console.log(chalk.bold(`Execution History (${entries.length} entries)`));
      console.log(chalk.gray("─".repeat(80)));

      for (const entry of entries) {
        const timestamp = entry.timestamp.toISOString().replace("T", " ").substring(0, 19);
        let statusIcon: string;
        if (entry.status === ReplyStatus.OK) {
          statusIcon = chalk.green("✓");
        } else if (entry.status === ReplyStatus.ERROR) {
          statusIcon = chalk.red("✗");
        } else {
          statusIcon = chalk.yellow("⚠");
        }
        const mode = entry.mode === "kernel" ? "K" : "T";
        const command = entry.command.length > 50 ? entry.command.substring(0, 47) + "..." : entry.command;
        const duration = entry.timing ? `${entry.timing.duration_ms}ms` : "N/A";
        
        console.log(`${statusIcon} ${chalk.gray(timestamp)} [${mode}] ${command}`);
        if (entry.status === ReplyStatus.ERROR && entry.error) {
          console.log(chalk.red(`  Error: ${entry.error.ename}: ${entry.error.evalue}`));
        }
        console.log(chalk.gray(`  Runtime: ${entry.runtime.label} | Duration: ${duration}`));
        console.log("");
      }
    }
  });

// Notebook management command group
const notebookCmd = program
  .command("notebook")
  .description("Manage Google Colab notebooks in Drive");

notebookCmd
  .command("list")
  .description("List your Colab notebooks from Drive")
  .option("-n, --limit <number>", "Maximum number of notebooks to show", "50")
  .option("--order-by <field>", "Sort by: name, createdTime, modifiedTime", "modifiedTime")
  .option("--enrich", "Fetch full notebook content to extract internal name (slower)")
  .option("--json", "Output as JSON")
  .action(async (options, cmd) => {
    const globalOptions = (cmd.parent?.parent?.opts() as GlobalOptions) ?? {};
    const jsonMode = Boolean(options.json);
    
    await withApp(globalOptions, async ({ auth, notebookManager }) => {
      const session = await auth.getAccessToken(globalOptions.forceLogin);
      
      if (!jsonMode) {
        console.log(
          chalk.green(
            `Authenticated as ${session.account.label} <${session.account.id}>`,
          ),
        );
      }
      
      const spinner = jsonMode ? undefined : ora("Fetching notebooks...").start();
      
      try {
        const notebooks = await notebookManager.listNotebooks({
          limit: Number.parseInt(options.limit, 10),
          orderBy: options.orderBy,
          enrich: Boolean(options.enrich),
        });
        
        spinner?.succeed(`Found ${notebooks.length} notebooks`);
        
        if (jsonMode) {
          console.log(JSON.stringify(notebooks, null, 2));
        } else {
          if (notebooks.length === 0) {
            console.log(chalk.gray("No notebooks found"));
            return;
          }
          
          console.log(chalk.bold(`\nNotebooks (${notebooks.length}):`));
          console.log(chalk.gray("─".repeat(100)));
          
          for (const nb of notebooks) {
            const created = new Date(nb.createdTime).toLocaleDateString();
            const modified = new Date(nb.modifiedTime).toLocaleDateString();
            const idShort = nb.id.substring(0, 12) + "...";
            
            console.log(chalk.bold(nb.colabName ?? nb.name));
            console.log(chalk.gray(`  ID: ${idShort} | Created: ${created} | Modified: ${modified}`));
            if (nb.webViewLink) {
              console.log(chalk.blue(`  ${nb.webViewLink}`));
            }
            console.log("");
          }
        }
      } catch (error) {
        spinner?.fail("Failed to fetch notebooks");
        console.error(chalk.red("\n" + formatDriveError(error)));
        process.exit(1);
      }
    });
  });

notebookCmd
  .command("create")
  .description("Create a new Colab notebook")
  .argument("<name>", "Notebook name")
  .option("-t, --template <type>", "Template: default, gpu, tpu", "default")
  .option("--json", "Output as JSON")
  .action(async (name: string, options, cmd) => {
    const globalOptions = (cmd.parent?.parent?.opts() as GlobalOptions) ?? {};
    const jsonMode = Boolean(options.json);
    
    await withApp(globalOptions, async ({ auth, notebookManager }) => {
      const session = await auth.getAccessToken(globalOptions.forceLogin);
      
      if (!jsonMode) {
        console.log(
          chalk.green(
            `Authenticated as ${session.account.label} <${session.account.id}>`,
          ),
        );
      }
      
      const spinner = jsonMode ? undefined : ora(`Creating notebook "${name}"...`).start();
      
      try {
        const notebook = await notebookManager.createNotebook(name, options.template);
        
        spinner?.succeed("Notebook created");
        
        if (jsonMode) {
          console.log(JSON.stringify(notebook, null, 2));
        } else {
          console.log(chalk.green(`\n✓ Created notebook: ${notebook.colabName ?? notebook.name}`));
          console.log(chalk.gray(`  ID: ${notebook.id}`));
          if (notebook.webViewLink) {
            console.log(chalk.blue(`  ${notebook.webViewLink}`));
          }
        }
      } catch (error) {
        spinner?.fail("Failed to create notebook");
        console.error(chalk.red("\n" + formatDriveError(error)));
        process.exit(1);
      }
    });
  });

notebookCmd
  .command("delete")
  .description("Delete a Colab notebook")
  .argument("<id>", "Notebook file ID")
  .option("-f, --force", "Skip confirmation")
  .option("--json", "Output as JSON")
  .action(async (id: string, options, cmd) => {
    const globalOptions = (cmd.parent?.parent?.opts() as GlobalOptions) ?? {};
    const jsonMode = Boolean(options.json);
    
    await withApp(globalOptions, async ({ auth, driveClient }) => {
      const session = await auth.getAccessToken(globalOptions.forceLogin);
      
      if (!jsonMode) {
        console.log(
          chalk.green(
            `Authenticated as ${session.account.label} <${session.account.id}>`,
          ),
        );
      }
      
      // Get notebook info for confirmation
      const notebook = await driveClient.getNotebook(id);
      
      // Confirm deletion unless --force
      if (!options.force && !jsonMode) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        
        try {
          const promptText = chalk.yellow(`Delete notebook "${notebook.name}"? (y/N): `);
          const answer = await new Promise<string>((resolve) => {
            rl.question(promptText, resolve);
          });
          
          const yesPattern = /^y(es)?$/;
          if (!yesPattern.exec(answer.toLowerCase())) {
            console.log(chalk.gray("Deletion cancelled"));
            return;
          }
        } finally {
          rl.close();
        }
      }
      
      const spinner = jsonMode ? undefined : ora(`Deleting notebook...`).start();
      
      try {
        await driveClient.deleteNotebook(id);
        
        spinner?.succeed("Notebook deleted");
        
        if (jsonMode) {
          console.log(JSON.stringify({ deleted: true, id, name: notebook.name }, null, 2));
        } else {
          console.log(chalk.green(`\n✓ Deleted notebook: ${notebook.name}`));
        }
      } catch (error) {
        spinner?.fail("Failed to delete notebook");
        console.error(chalk.red("\n" + formatDriveError(error)));
        process.exit(1);
      }
    });
  });

notebookCmd
  .command("open")
  .description("Open a Colab notebook and connect to runtime")
  .argument("<id>", "Notebook file ID")
  .option("-m, --mode <type>", "Connection mode: terminal, kernel", "kernel")
  .option("--new-runtime", "Request a brand-new runtime")
  .option("--tpu", "Request a TPU runtime")
  .option("--cpu", "Request a CPU runtime")
  .option("--startup-code <code>", "Python code to execute on startup (kernel mode)")
  .action(async (id: string, options, cmd) => {
    const globalOptions = (cmd.parent?.parent?.opts() as GlobalOptions) ?? {};
    
    await withApp(globalOptions, async ({ auth, notebookManager, colabClient, sessionManager, runtimeManager }) => {
      const authSession = await auth.getAccessToken(globalOptions.forceLogin);
      console.log(
        chalk.green(
          `Authenticated as ${authSession.account.label} <${authSession.account.id}>`,
        ),
      );
      
      const spinner = ora("Opening notebook...").start();
      
      try {
        let variantStr: "tpu" | "cpu" | "gpu";
        if (options.tpu) {
          variantStr = "tpu";
        } else if (options.cpu) {
          variantStr = "cpu";
        } else {
          variantStr = "gpu";
        }
        
        let variantEnum: Variant;
        if (variantStr === "tpu") {
          variantEnum = Variant.TPU;
        } else if (variantStr === "cpu") {
          variantEnum = Variant.DEFAULT;
        } else {
          variantEnum = Variant.GPU;
        }
        
        // Get or create session
        const session = await sessionManager.getOrCreateSession(globalOptions.session, {
          variant: variantEnum,
          forceNew: Boolean(options.newRuntime),
        });
        
        const { notebook } = await notebookManager.openNotebook(
          id,
          runtimeManager,
          {
            forceNew: Boolean(options.newRuntime),
            variant: variantStr,
          }
        );
        
        const runtime = session.runtime;
        
        spinner.succeed(`Opened notebook: ${notebook.colabName ?? notebook.name}`);
        
        console.log(chalk.gray(`Notebook ID: ${notebook.id}`));
        console.log(chalk.gray(`Runtime: ${runtime.label}`));
        console.log(chalk.gray(`Accelerator: ${runtime.accelerator}`));
        console.log("");
        
        const mode = options.mode ?? "kernel";
        
        if (mode === "kernel") {
          await runKernelMode(
            runtimeManager,
            colabClient,
            runtime,
            { startupCode: options.startupCode }
          );
        } else {
          const terminal = new TerminalSession(colabClient, runtime, {});
          await terminal.start();
        }
      } catch (error) {
        spinner.fail("Failed to open notebook");
        console.error(chalk.red("\n" + formatDriveError(error)));
        process.exit(1);
      }
    });
  });

program
  .command("serve")
  .description("Start an OpenAI-compatible API server backed by Google Gemini")
  .option("-p, --port <number>", "Port to listen on", "8080")
  .option("-H, --host <string>", "Host to listen on", "127.0.0.1")
  .option("--gemini-bin <path>", "Path to the gemini executable", "gemini")
  .option("--default-model <model>", "Default model to use if not specified", "gemini-2.0-flash")
  .option("--timeout <ms>", "Request timeout in milliseconds", "120000")
  .option("--workspace-dir <path>", "Directory prefix for temporary workspaces")
  .option("--list-models", "List available Gemini models and exit")
  .action(async (options) => {
    if (options.listModels) {
      console.log("Available Gemini models:");
      for (const model of KNOWN_GEMINI_MODELS) {
        console.log(`  - ${model}`);
      }
      return;
    }

    const port = Number.parseInt(options.port, 10);
    const timeout = Number.parseInt(options.timeout, 10);

    await startServeServer({
      port,
      host: options.host,
      geminiBin: options.geminiBin,
      defaultModel: options.defaultModel,
      requestTimeoutMs: timeout,
      workspaceDirPrefix: options.workspaceDir,
      logger: console,
    });
  });

// Session management commands
const sessionsCmd = program
  .command("sessions")
  .description("Manage Colab runtime sessions");

sessionsCmd
  .command("list")
  .description("List all active Colab runtime sessions")
  .option("--json", "Output as JSON")
  .option("--stats", "Show summary statistics")
  .action(async (options, cmd) => {
    const globalOptions = (cmd.parent?.parent?.opts() as GlobalOptions) ?? {};
    const jsonMode = Boolean(options.json);
    
    await withApp(globalOptions, async ({ auth, sessionManager, colabClient, connectionPool }) => {
      const session = await auth.getAccessToken(globalOptions.forceLogin);
      
      // Update subscription tier for accurate limits/tier display
      await updateSubscriptionTier(colabClient, connectionPool);
      
      if (!jsonMode && !options.stats) {
        console.log(
          chalk.green(
            `Authenticated as ${session.account.label} <${session.account.id}>`,
          ),
        );
      }
      
      await handleSessionsList(sessionManager, options, formatRelativeTime);
    });
  });

sessionsCmd
  .command("switch")
  .description("Switch to a different Colab runtime session")
  .argument("[session-id]", "Session ID to switch to (defaults to --session flag)")
  .option("--json", "Output as JSON")
  .action(async (sessionId: string | undefined, options, cmd) => {
    const globalOptions = (cmd.parent?.parent?.opts() as GlobalOptions) ?? {};
    const targetSessionId = sessionId ?? globalOptions.session;
    const jsonMode = Boolean(options?.json);

    if (!targetSessionId) {
      if (jsonMode) {
        console.error(JSON.stringify({
          status: "error",
          errorCode: 1,
          error: { message: "Session ID is required. Provide it as an argument or via --session." }
        }, null, 2));
      } else {
        console.error(chalk.red("Session ID is required. Provide it as an argument or via --session."));
      }
      process.exit(1);
    }
    
    await withApp(globalOptions, async ({ auth, sessionManager }) => {
      const session = await auth.getAccessToken(globalOptions.forceLogin);
      
      if (!jsonMode) {
        console.log(
          chalk.green(
            `Authenticated as ${session.account.label} <${session.account.id}>`,
          ),
        );
      }
      
      const result = await switchSession(sessionManager, targetSessionId, jsonMode);
      if ("error" in result) {
        if (jsonMode) {
          console.error(JSON.stringify({
            status: "error",
            errorCode: 1,
            error: { message: result.error }
          }, null, 2));
        } else {
          console.error(chalk.red(`\n✗ ${result.error}`));
        }
        process.exit(1);
      }
    });
  });

sessionsCmd
  .command("close")
  .description("Close a specific session")
  .argument("[session-id]", "Session ID to close (defaults to --session flag)")
  .option("--json", "Output as JSON")
  .action(async (sessionId: string | undefined, options, cmd) => {
    const globalOptions = (cmd.parent?.parent?.opts() as GlobalOptions) ?? {};
    const targetSessionId = sessionId ?? globalOptions.session;
    const jsonMode = Boolean(options?.json);

    if (!targetSessionId) {
      if (jsonMode) {
        console.error(JSON.stringify({
          status: "error",
          errorCode: 1,
          error: { message: "Session ID is required. Provide it as an argument or via --session." }
        }, null, 2));
      } else {
        console.error(chalk.red("Session ID is required. Provide it as an argument or via --session."));
      }
      process.exit(1);
    }
    
    await withApp(globalOptions, async ({ auth, sessionManager }) => {
      const session = await auth.getAccessToken(globalOptions.forceLogin);
      
      if (!jsonMode) {
        console.log(
          chalk.green(
            `Authenticated as ${session.account.label} <${session.account.id}>`,
          ),
        );
      }
      
      const result = await deleteSession(sessionManager, targetSessionId, jsonMode);
      if ("error" in result) {
        if (jsonMode) {
          console.error(JSON.stringify({
            status: "error",
            errorCode: 1,
            error: { message: result.error }
          }, null, 2));
        } else {
          console.error(chalk.red(`\n✗ ${result.error}`));
        }
        process.exit(1);
      }
    });
  });

sessionsCmd
  .command("clean")
  .description("Remove stale sessions (runtimes no longer assigned)")
  .option("--json", "Output as JSON")
  .action(async (options, cmd) => {
    const globalOptions = (cmd.parent?.parent?.opts() as GlobalOptions) ?? {};
    const jsonMode = Boolean(options.json);
    
    await withApp(globalOptions, async ({ auth, sessionManager }) => {
      const session = await auth.getAccessToken(globalOptions.forceLogin);
      
      if (!jsonMode) {
        console.log(
          chalk.green(
            `Authenticated as ${session.account.label} <${session.account.id}>`,
          ),
        );
      }
      
      if (!jsonMode) {
        const spinner = ora("Cleaning stale sessions...").start();
        
        try {
          const removed = await sessionManager.cleanStaleSessions();
          
          if (removed.length === 0) {
            spinner.succeed("No stale sessions found");
          } else {
            spinner.succeed(`Removed ${removed.length} stale session(s)`);
            for (const id of removed) {
              console.log(chalk.gray(`  ${id.substring(0, 8)}`));
            }
          }
        } catch (error) {
          spinner.fail("Failed to clean sessions");
          const message = error instanceof Error ? error.message : String(error);
          console.error(chalk.red(`\n${message}`));
          process.exit(1);
        }
      } else {
        // JSON mode - use handler
        try {
          await cleanStaleSessions(sessionManager, jsonMode);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(JSON.stringify({
            status: "error",
            errorCode: 1,
            error: { message }
          }, null, 2));
          process.exit(1);
        }
      }
    });
  });

// ─────────────────────────────────────────────────────────────────────────────
// Debug Logs Management Commands
// ─────────────────────────────────────────────────────────────────────────────

const debugCmd = program
  .command("debug")
  .description("View and manage application debug logs");

debugCmd
  .command("show")
  .description("Display recent log entries")
  .option("-n, --lines <count>", "number of entries to show", "50")
  .option("-l, --level <level>", "minimum log level (debug, info, warn, error)", "info")
  .option("-c, --category <category>", "filter by category (CLI, API, SESSION, RUNTIME, etc.)")
  .option("-s, --search <text>", "search for text in logs")
  .option("--json", "output as JSON")
  .action(async (options, cmd) => {
    const globalOptions = (cmd.parent?.parent?.opts() as GlobalOptions) ?? {};
    
    await withApp(globalOptions, async ({ logger }) => {
      const levelMap: Record<string, number> = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
      };
      
      const entries = await logger.searchLogs({
        level: levelMap[options.level.toLowerCase()] ?? 1,
        category: options.category?.toUpperCase(),
        searchText: options.search,
        limit: Number.parseInt(options.lines, 10),
      });
      
      if (options.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }
      
      if (entries.length === 0) {
        console.log(chalk.gray("No log entries found."));
        return;
      }
      
      for (const entry of entries) {
        const levelColors: Record<string, typeof chalk.gray> = {
          DEBUG: chalk.gray,
          INFO: chalk.blue,
          WARN: chalk.yellow,
          ERROR: chalk.red,
        };
        const levelColor = levelColors[entry.levelName] ?? chalk.white;
        
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const categoryTag = chalk.cyan("[" + entry.category + "]");
        console.log(
          `${chalk.gray(time)} ${levelColor(entry.levelName.padEnd(5))} ${categoryTag} ${entry.message}`
        );
        if (entry.data) {
          console.log(chalk.gray(`  ${JSON.stringify(entry.data)}`));
        }
        if (entry.error) {
          console.log(chalk.red(`  Error: ${entry.error.message}`));
        }
      }
    });
  });

debugCmd
  .command("list")
  .description("List available log files")
  .action(async (cmd: { parent?: { parent?: { opts: () => GlobalOptions } } }) => {
    const globalOptions = (cmd.parent?.parent?.opts() as GlobalOptions) ?? {};
    
    await withApp(globalOptions, async ({ logger }) => {
      const files = await logger.listLogFiles();
      
      if (files.length === 0) {
        console.log(chalk.gray("No log files found."));
        return;
      }
      
      console.log(chalk.bold("Log files:"));
      console.log(chalk.gray(`Location: ${logger.getLogsDir()}\n`));
      
      for (const file of files) {
        console.log(`  ${file}`);
      }
    });
  });

debugCmd
  .command("path")
  .description("Show the logs directory path")
  .action(async (cmd: { parent?: { parent?: { opts: () => GlobalOptions } } }) => {
    const globalOptions = (cmd.parent?.parent?.opts() as GlobalOptions) ?? {};
    
    await withApp(globalOptions, async ({ logger }) => {
      console.log(logger.getLogsDir());
    });
  });

debugCmd
  .command("tail")
  .description("Show the most recent log entries (like tail -f)")
  .option("-n, --lines <count>", "number of entries to show", "20")
  .action(async (options: { lines: string }, cmd: { parent?: { parent?: { opts: () => GlobalOptions } } }) => {
    const globalOptions = (cmd.parent?.parent?.opts() as GlobalOptions) ?? {};
    
    await withApp(globalOptions, async ({ logger }) => {
      const entries = await logger.searchLogs({
        limit: Number.parseInt(options.lines, 10),
      });
      
      if (entries.length === 0) {
        console.log(chalk.gray("No log entries yet."));
        return;
      }
      
      // Show in chronological order (reverse since searchLogs returns newest first)
      const chronologicalEntries = [...entries].reverse();
      for (const entry of chronologicalEntries) {
        const levelColors: Record<string, typeof chalk.gray> = {
          DEBUG: chalk.gray,
          INFO: chalk.blue,
          WARN: chalk.yellow,
          ERROR: chalk.red,
        };
        const levelColor = levelColors[entry.levelName] ?? chalk.white;
        
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const categoryTag = chalk.cyan("[" + entry.category + "]");
        console.log(
          `${chalk.gray(time)} ${levelColor(entry.levelName.padEnd(5))} ${categoryTag} ${entry.message}`
        );
      }
    });
  });

// Upgrade command for easy updates
program
  .command("upgrade")
  .description("Check for updates and upgrade to the latest version")
  .option("--check", "Only check for updates without installing")
  .option("--beta", "Install the beta version instead of stable")
  .action(async (options) => {
    const currentVersion = packageJson.version;
    const spinner = ora("Checking for updates...").start();
    
    try {
      // Get latest version from npm
      const tag = options.beta ? "beta" : "latest";
      const npmInfo = execSync(`npm view lecoder-cgpu dist-tags --json`, { encoding: "utf-8" });
      const distTags = JSON.parse(npmInfo);
      const latestVersion = distTags[tag];
      
      if (!latestVersion) {
        spinner.fail(`No ${tag} version found`);
        return;
      }
      
      if (currentVersion === latestVersion) {
        spinner.succeed(chalk.green(`You're on the latest ${tag} version: ${currentVersion}`));
        return;
      }
      
      spinner.info(`Current: ${chalk.yellow(currentVersion)} → Latest ${tag}: ${chalk.green(latestVersion)}`);
      
      if (options.check) {
        console.log(chalk.gray(`\nTo upgrade, run: lecoder-cgpu upgrade`));
        return;
      }
      
      // Perform upgrade
      const upgradeSpinner = ora(`Upgrading to ${latestVersion}...`).start();
      try {
        execSync(`npm install -g lecoder-cgpu@${tag}`, { stdio: "pipe" });
        upgradeSpinner.succeed(chalk.green(`Successfully upgraded to ${latestVersion}!`));
        console.log(chalk.gray("\nRestart your terminal or run 'lecoder-cgpu --version' to verify."));
      } catch (installErr) {
        upgradeSpinner.fail("Upgrade failed");
        console.error(chalk.red("Try running manually: npm install -g lecoder-cgpu@latest"));
        if (process.env.LECODER_CGPU_DEBUG) {
          console.error(installErr);
        }
      }
    } catch (err) {
      spinner.fail("Failed to check for updates");
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(message));
      console.log(chalk.gray("\nTry running manually: npm view lecoder-cgpu version"));
    }
  });

try {
  await program.parseAsync();
} catch (err) {
  if (isAlreadyReportedError(err)) {
    process.exit(1);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(chalk.red(message));
  if (process.env.LECODER_CGPU_DEBUG && err instanceof Error && err.stack) {
    console.error(chalk.gray(err.stack));
  }
  process.exit(1);
}

async function withApp(
  options: GlobalOptions,
  fn: (deps: Awaited<ReturnType<typeof createApp>>) => Promise<void>,
) {
  const deps = await createApp(options.config);
  await fn(deps);
}

/**
 * Fetch and update the subscription tier in the connection pool.
 * This should be called after authentication to ensure accurate tier detection.
 * 
 * Detection logic:
 * 1. Try to use eligibleGpus from CCU info - A100/L4 access indicates Pro tier
 * 2. If that fails, default to free tier
 */
async function updateSubscriptionTier(
  colabClient: ColabClient,
  connectionPool: ConnectionPool
): Promise<number> {
  try {
    // Use CCU info to determine tier based on eligible GPUs
    // Pro users have access to A100, L4; Free users only get T4
    const ccuInfo = await colabClient.getCcuInfo();
    const eligibleGpus = ccuInfo.eligibleGpus.map(g => g.toUpperCase());
    
    // Pro tier indicators: A100, L4, V100 access
    const proGpus = ["A100", "L4", "V100"];
    const hasPro = proGpus.some(gpu => eligibleGpus.includes(gpu));
    
    // SubscriptionTier: 0 = NONE/Free, 1 = PRO, 2 = PRO_PLUS
    const tier = hasPro ? 1 : 0;
    connectionPool.setSubscriptionTier(tier);
    return tier;
  } catch (error) {
    // If we can't fetch tier, default to free (0)
    if (process.env.LECODER_CGPU_DEBUG) {
      console.warn("Could not determine subscription tier, defaulting to free tier:", error);
    }
    return 0;
  }
}

function resolveVariant({ tpu, cpu }: { tpu?: boolean; cpu?: boolean }): Variant {
  if (tpu && cpu) {
    throw new Error("Choose either --cpu or --tpu, not both.");
  }
  if (tpu) {
    return Variant.TPU;
  }
  if (cpu) {
    return Variant.DEFAULT;
  }
  return Variant.GPU;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  
  if (diffDay > 0) {
    return `${diffDay}d ago`;
  }
  if (diffHour > 0) {
    return `${diffHour}h ago`;
  }
  if (diffMin > 0) {
    return `${diffMin}m ago`;
  }
  return `${diffSec}s ago`;
}

function isAlreadyReportedError(err: unknown): err is { alreadyReported: true } {
  return Boolean(
    err && typeof err === "object" && (err as { alreadyReported?: boolean }).alreadyReported,
  );
}

/**
 * Display setup reminder for first-time users after authentication.
 */
function displaySetupReminder(): void {
  console.log();
  console.log(chalk.cyan.bold("📋 Setup Reminder:"));
  console.log(chalk.gray("   To use notebook features (list, create, delete), you need Google Drive API enabled:"));
  console.log(chalk.white("   → https://console.cloud.google.com/apis/api/drive.googleapis.com"));
  console.log(chalk.gray("   Click 'ENABLE' if not already enabled."));
  console.log();
}

/**
 * Validate credentials with a test API call.
 */
async function validateCredentials(colabClient: ColabClient): Promise<void> {
  const spinner = ora("Validating credentials...").start();
  try {
    const ccu = await colabClient.getCcuInfo();
    spinner.succeed("Credentials validated");
    console.log(
      chalk.green(
        `  Eligible GPUs: ${ccu.eligibleGpus.join(", ") || "None"}`
      )
    );
    if (ccu.assignmentsCount > 0) {
      console.log(
        chalk.blue(`  Active assignments: ${ccu.assignmentsCount}`)
      );
    }
  } catch (err) {
    spinner.fail("Validation failed");
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      chalk.red(`  Error: ${message}`)
    );
    console.log(
      chalk.gray(
        "  Your credentials may still work. Try running a command like 'lecoder-cgpu status'."
      )
    );
  }
}

/**
 * Parse relative date string (e.g., "1h", "2d", "30m") or ISO 8601
 */
function parseRelativeDate(dateStr: string): Date {
  // Try parsing as ISO 8601 first
  const isoDate = new Date(dateStr);
  if (!Number.isNaN(isoDate.getTime())) {
    return isoDate;
  }

  // Parse relative format
  const match = /^(\d+)([smhd])$/.exec(dateStr);
  if (!match) {
    throw new Error(`Invalid date format: ${dateStr}. Use ISO 8601 or relative format like '1h', '2d', '30m'`);
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2];
  const now = new Date();

  switch (unit) {
    case "s":
      return new Date(now.getTime() - value * 1000);
    case "m":
      return new Date(now.getTime() - value * 60 * 1000);
    case "h":
      return new Date(now.getTime() - value * 60 * 60 * 1000);
    case "d":
      return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
    default:
      throw new Error(`Unknown time unit: ${unit}`);
  }
}

async function runKernelMode(
  runtimeManager: RuntimeManager,
  colabClient: ColabClient,
  runtime: Awaited<ReturnType<RuntimeManager["assignRuntime"]>>,
  options: ConnectCommandOptions
): Promise<void> {
  const spinner = ora("Connecting to Jupyter kernel...").start();

  let connection: ColabConnection;
  try {
    connection = await runtimeManager.createKernelConnection(runtime);
    spinner.succeed("Connected to Jupyter kernel");
  } catch (error) {
    spinner.fail("Failed to connect to Jupyter kernel");
    throw error;
  }

  // Handle connection errors (WebSocket failures, reconnection issues, etc.)
  connection.on("error", (error: Error) => {
    console.error(chalk.red("\nConnection error:"), error.message);
    if (process.env.LECODER_CGPU_DEBUG) {
      console.error(error.stack);
    }
  });

  // Display connection info
  console.log(chalk.gray(`Kernel ID: ${connection.getKernelId()}`));
  console.log(chalk.gray(`Runtime: ${runtime.label}`));
  console.log(chalk.gray(`Accelerator: ${runtime.accelerator}`));
  console.log("");

  // Setup keep-alive
  const keepAliveTimer = setInterval(() => {
    void colabClient.sendKeepAlive(runtime.endpoint).catch((err) => {
      console.warn(chalk.yellow("Failed to send keep-alive:", err));
    });
  }, 60_000);

  // Execute startup code if provided
  if (options.startupCode) {
    console.log(chalk.gray("Executing startup code..."));
    const result = await connection.executeCode(options.startupCode);
    displayExecutionResult(result, true);
  }

  // Setup readline for REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.green("Jupyter kernel REPL ready."));
  console.log(chalk.gray("Enter Python code to execute. Use Ctrl+C or type 'exit' to quit."));
  console.log(chalk.gray(String.raw`For multi-line input, end a line with \ to continue.`));
  console.log("");

  let multiLineBuffer = "";
  let executionCount = 0;

  const promptText = () => `In [${executionCount + 1}]: `;
  const continuationPrompt = "   ...: ";

  const handleInterrupt = async () => {
    console.log(chalk.yellow("\nInterrupting kernel..."));
    try {
      await connection.interrupt();
      console.log(chalk.yellow("Kernel interrupted."));
    } catch (error) {
      console.error(chalk.red("Failed to interrupt kernel:"), error);
    }
  };

  // Handle Ctrl+C
  let lastCtrlC = 0;
  process.on("SIGINT", () => {
    const now = Date.now();
    if (now - lastCtrlC < 1000) {
      console.log(chalk.yellow("\nExiting..."));
      cleanup();
      process.exit(0);
    }
    lastCtrlC = now;
    void handleInterrupt();
  });

  const cleanup = () => {
    clearInterval(keepAliveTimer);
    rl.close();
    void connection.shutdown();
  };

  const executeCode = async (code: string) => {
    if (!code.trim()) return;

    try {
      const result = await connection.executeCode(code);
      executionCount++;
      displayExecutionResult(result, false);

      if (result.timing) {
        console.log(chalk.gray(`  (${result.timing.duration_ms}ms)`));
      }
    } catch (error) {
      console.error(chalk.red("Execution error:"), error);
    }
  };

  const promptUser = () => {
    const prompt = multiLineBuffer ? continuationPrompt : promptText();
    rl.question(prompt, async (line) => {
      try {
        if (line === undefined) {
          // EOF
          cleanup();
          return;
        }

        // Handle exit
        if (!multiLineBuffer && (line.trim() === "exit" || line.trim() === "quit")) {
          console.log(chalk.yellow("Exiting..."));
          cleanup();
          return;
        }

        // Handle multi-line continuation
        if (line.endsWith("\\")) {
          multiLineBuffer += line.slice(0, -1) + "\n";
          promptUser();
          return;
        }

        const code = multiLineBuffer + line;
        multiLineBuffer = "";

        await executeCode(code);
        promptUser();
      } catch (error: unknown) {
        const err = error as { code?: string };
        if (err.code === "ERR_USE_AFTER_CLOSE") {
          return;
        }
        console.error(chalk.red("REPL error:"), error);
        cleanup();
      }
    });
  };

  promptUser();
}

function displayExecutionResult(result: ExecutionResult, _isStartup: boolean): void {
  // Display stdout
  if (result.stdout) {
    process.stdout.write(chalk.white(result.stdout));
  }

  // Display stderr
  if (result.stderr) {
    process.stderr.write(chalk.yellow(result.stderr));
  }

  // Display error with traceback
  if (result.error) {
    const errorOutput = formatError(result.error);
    console.error(errorOutput);
  }

  // Display display_data (text/plain representations)
  for (const data of result.display_data) {
    if (data.data["text/plain"]) {
      const textData = data.data["text/plain"];
      const textOutput = typeof textData === "string" ? textData : JSON.stringify(textData);
      console.log(chalk.cyan(textOutput));
    } else if (data.data["text/html"]) {
      console.log(chalk.gray("[HTML output - see notebook for rendered view]"));
    } else if (data.data["image/png"]) {
      console.log(chalk.gray("[Image output - see notebook for rendered view]"));
    }
  }

  // Show output line number for non-startup execution
  if (!_isStartup && result.execution_count !== null) {
    if (result.display_data.length > 0 || result.status === ReplyStatus.OK) {
      // Output indicator shown via display_data
    }
  }
}
