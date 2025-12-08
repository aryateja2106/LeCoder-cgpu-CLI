#!/usr/bin/env node
import path from "node:path";
import readline from "node:readline/promises";
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
import { ColabConnection } from "./jupyter/colab-connection.js";
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

interface GlobalOptions {
  config?: string;
  forceLogin?: boolean;
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
  const storage = new FileAuthStorage(config.storageDir);
  const oauthClient = new OAuth2Client(config.clientId, config.clientSecret);
  const auth = new GoogleOAuthManager(oauthClient, storage);
  const colabClient = new ColabClient(
    new URL(config.colabApiDomain),
    new URL(config.colabGapiDomain),
    async () => (await auth.getAccessToken()).accessToken,
  );
  const driveClient = new DriveClient(async () => (await auth.getAccessToken()).accessToken);
  const notebookManager = new NotebookManager(driveClient);
  return { auth, colabClient, driveClient, notebookManager, config };
}

const program = new Command();
program
  .name("lecoder-cgpu")
  .description("LeCoder cGPU - Robust CLI for Google Colab GPU access")
  .option("-c, --config <path>", "path to config file")
  .option("--force-login", "ignore cached session");

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
    await withApp(globalOptions, async ({ auth, colabClient }) => {
      const session = await auth.getAccessToken(globalOptions.forceLogin);
      console.log(
        chalk.green(
          `Authenticated as ${session.account.label} <${session.account.id}>`,
        ),
      );
      const runtimeManager = new RuntimeManager(colabClient);
      const runtime = await runtimeManager.assignRuntime({
        forceNew: Boolean(connectOptions.newRuntime),
        variant: resolveVariant(connectOptions),
      });

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
    
    await withApp(globalOptions, async ({ auth, colabClient }) => {
      const session = await auth.getAccessToken(globalOptions.forceLogin);
      const jsonMode = Boolean(runOptions.json);
      
      if (!jsonMode) {
        console.log(
          chalk.green(
            `Authenticated as ${session.account.label} <${session.account.id}>`,
          ),
        );
      }
      
      const runtimeManager = new RuntimeManager(colabClient);
      const runtime = await runtimeManager.assignRuntime({
        forceNew: Boolean(runOptions.newRuntime),
        variant: resolveVariant(runOptions),
        quiet: !runOptions.verbose || jsonMode,
      });
      
      const historyStorage = new ExecutionHistoryStorage();
      
      if (mode === "kernel") {
        // Kernel mode: Execute Python code via Jupyter kernel
        const connection = await runtimeManager.createKernelConnection(runtime);
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
            console.log(jsonOutput);
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
    await withApp(globalOptions, async ({ auth, colabClient }) => {
      const session = await auth.getAccessToken(globalOptions.forceLogin);
      console.log(
        chalk.green(
          `Authenticated as ${session.account.label} <${session.account.id}>`,
        ),
      );
      const runtimeManager = new RuntimeManager(colabClient);
      const runtime = await runtimeManager.assignRuntime({
        forceNew: Boolean(copyOptions.newRuntime),
        variant: resolveVariant(copyOptions),
        quiet: true,
      });
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
  .description("Show authentication status and active runtime details")
  .option("--json", "Output status as JSON for machine parsing")
  .action(async (cmdOptions, cmd) => {
    const globalOptions = (cmd.parent?.opts() as GlobalOptions) ?? {};
    const jsonMode = Boolean(cmdOptions.json);
    await withApp(globalOptions, async ({ auth, colabClient }) => {
      const session = await auth.getAccessToken(globalOptions.forceLogin);
      const ccu = await colabClient.getCcuInfo();
      
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
      
      // Check for active runtimes
      try {
        const assignments = await colabClient.listAssignments();
        
        for (const assignment of assignments) {
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

          statusInfo.runtimes.push(runtimeInfo);
        }
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
      }
    });
  });

program
  .command("auth")
  .description("Authenticate or re-authenticate with Google Colab")
  .option("-f, --force", "Skip confirmation if already authenticated")
  .option("--validate", "Verify credentials with a test API call")
  .action(async (options, cmd) => {
    const globalOptions = (cmd.parent?.opts() as GlobalOptions) ?? {};
    await withApp(globalOptions, async ({ auth, colabClient }) => {
      let existingSession;
      
      // Check if already authenticated
      try {
        existingSession = await auth.getAccessToken();
      } catch {
        // No existing session, proceed with fresh authentication
        existingSession = undefined;
      }

      // If session exists and --force not set, prompt for confirmation
      if (existingSession && !options.force) {
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
          
          const answer = await rl.question(
            "Re-authenticate? This will clear your current session. (y/N): "
          );
          rl.close();
          
          if (!answer.toLowerCase().match(/^y(es)?$/)) {
            console.log(chalk.gray("Authentication cancelled."));
            return;
          }
        }
      }

      // Clear existing session if any
      if (existingSession) {
        await auth.signOut();
      }

      // Perform authentication
      const session = await auth.getAccessToken(true);
      console.log(
        chalk.green(
          `✓ Authenticated as ${session.account.label} <${session.account.id}>`
        )
      );

      // Validate credentials if requested
      if (options.validate) {
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
    });
  });

program
  .command("logout")
  .description("Forget cached credentials")
  .action(async (_args, cmd) => {
    const options = (cmd.parent?.opts() as GlobalOptions) ?? {};
    await withApp(options, async ({ auth }) => {
      await auth.signOut();
      console.log(chalk.yellow("Signed out and cleared session cache."));
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
      if (!options.json) {
        console.log(chalk.green("✓ Execution history cleared"));
      } else {
        console.log(JSON.stringify({ cleared: true }));
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
        const statusIcon = entry.status === ReplyStatus.OK ? chalk.green("✓") : entry.status === ReplyStatus.ERROR ? chalk.red("✗") : chalk.yellow("⚠");
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
        throw error;
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
        throw error;
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
        
        const answer = await rl.question(
          chalk.yellow(`Delete notebook "${notebook.name}"? (y/N): `)
        );
        rl.close();
        
        if (!answer.toLowerCase().match(/^y(es)?$/)) {
          console.log(chalk.gray("Deletion cancelled"));
          return;
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
        throw error;
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
    
    await withApp(globalOptions, async ({ auth, notebookManager, colabClient }) => {
      const session = await auth.getAccessToken(globalOptions.forceLogin);
      console.log(
        chalk.green(
          `Authenticated as ${session.account.label} <${session.account.id}>`,
        ),
      );
      
      const spinner = ora("Opening notebook...").start();
      
      try {
        const runtimeManager = new RuntimeManager(colabClient);
        
        const { notebook, runtime } = await notebookManager.openNotebook(
          id,
          runtimeManager,
          {
            forceNew: Boolean(options.newRuntime),
            variant: options.tpu ? "tpu" : options.cpu ? "cpu" : "gpu",
          }
        );
        
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
        throw error;
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

    const port = parseInt(options.port, 10);
    const timeout = parseInt(options.timeout, 10);

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

program.parseAsync().catch((err) => {
  if (isAlreadyReportedError(err)) {
    process.exit(1);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(chalk.red(message));
  if (process.env.LECODER_CGPU_DEBUG && err instanceof Error && err.stack) {
    console.error(chalk.gray(err.stack));
  }
  process.exit(1);
});

async function withApp(
  options: GlobalOptions,
  fn: (deps: Awaited<ReturnType<typeof createApp>>) => Promise<void>,
) {
  const deps = await createApp(options.config);
  await fn(deps);
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

function isAlreadyReportedError(err: unknown): err is { alreadyReported: true } {
  return Boolean(
    err && typeof err === "object" && (err as { alreadyReported?: boolean }).alreadyReported,
  );
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
  console.log(chalk.gray("For multi-line input, end a line with \\ to continue."));
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
    rl.question(prompt).then(async (line) => {
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
    }).catch((error) => {
      if (error.code === "ERR_USE_AFTER_CLOSE") {
        return;
      }
      console.error(chalk.red("REPL error:"), error);
      cleanup();
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
      console.log(chalk.cyan(String(data.data["text/plain"])));
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
