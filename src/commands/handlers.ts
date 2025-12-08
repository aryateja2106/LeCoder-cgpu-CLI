/**
 * Command Handlers Module
 * 
 * This module provides the core command handler functions for the LeCoder cGPU CLI.
 * Each handler is extracted from the main index.ts to reduce cognitive complexity
 * and improve maintainability.
 * 
 * ## Architecture Overview
 * 
 * The CLI uses a dependency injection pattern where handlers receive an `AppContext`
 * containing all necessary services (auth, colabClient, sessionManager, etc.).
 * This makes the handlers testable and decoupled from the application bootstrap.
 * 
 * ## Handler Categories
 * 
 * 1. **Status Handlers** - Display runtime, session, and GPU status information
 * 2. **Session Lookup** - Find and validate session IDs with prefix matching
 * 3. **Runtime Info Collection** - Gather GPU, kernel, and connection details
 * 4. **Output Formatting** - Format results for human-readable or JSON output
 * 
 * @module commands/handlers
 */

import chalk from "chalk";
import type { ColabClient } from "../colab/client.js";
import type { SessionManager, EnrichedSession, SessionStats } from "../session/session-manager.js";
import { RemoteCommandRunner } from "../runtime/remote-command-runner.js";
import { queryGpuInfo, formatMemory, calculateMemoryUsage } from "../runtime/gpu-info.js";
import type { StatusInfo, RuntimeInfo } from "../utils/output-formatter.js";

// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Active session details for display purposes.
 * Contains the minimal information needed to identify and display a session.
 */
export interface ActiveSessionDetails {
  /** Unique session identifier */
  id: string;
  /** Human-readable session label */
  label: string;
  /** Runtime label (e.g., "Colab GPU T4") */
  runtime: string;
}

/**
 * Result of looking up a session by ID.
 * Supports both exact matches and prefix-based lookups.
 */
export interface SessionLookupResult {
  /** The found session, if any */
  session: EnrichedSession | undefined;
  /** Error message if lookup failed */
  error?: string;
}

/**
 * Collected session statistics and active session info.
 * Used by the status command to display session overview.
 */
export interface SessionInfo {
  /** Session statistics (counts, tier, limits) */
  stats: SessionStats | undefined;
  /** Details of the currently active session */
  activeSession: ActiveSessionDetails | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Lookup Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up a session by ID with support for prefix matching.
 * 
 * This function implements user-friendly session lookup:
 * 1. First tries an exact match on the full session ID
 * 2. If no exact match, tries prefix matching (minimum 4 characters)
 * 3. Reports ambiguous matches when multiple sessions share a prefix
 * 
 * @example
 * ```typescript
 * // Exact match
 * const result = await findSessionById(sessionManager, "abc123-full-uuid");
 * 
 * // Prefix match (user types short ID)
 * const result = await findSessionById(sessionManager, "abc1");
 * ```
 * 
 * @param sessionManager - The session manager instance
 * @param sessionId - Full or partial session ID to look up
 * @returns SessionLookupResult with found session or error message
 */
export async function findSessionById(
  sessionManager: SessionManager,
  sessionId: string
): Promise<SessionLookupResult> {
  try {
    const sessions = await sessionManager.listSessions();
    
    // Step 1: Try exact match first (fastest path)
    let targetSession = sessions.find((s) => s.id === sessionId);
    
    // Step 2: If no exact match, try prefix matching
    if (!targetSession && sessionId.length >= 4) {
      const matches = sessions.filter((s) => s.id.startsWith(sessionId));
      
      if (matches.length === 1) {
        // Unique prefix match
        targetSession = matches[0];
      } else if (matches.length > 1) {
        // Ambiguous prefix - multiple sessions match
        const matchIds = matches.map(s => s.id.substring(0, 8)).join(", ");
        return {
          session: undefined,
          error: `Ambiguous session ID "${sessionId}". Matches: ${matchIds}`
        };
      }
    }

    if (!targetSession) {
      return {
        session: undefined,
        error: `Session not found: ${sessionId}`
      };
    }
    
    return { session: targetSession };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      session: undefined,
      error: `Unable to load session ${sessionId}: ${message}`
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Statistics Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collect session statistics and active session details.
 * 
 * This function gathers:
 * - Total session counts (active, connected, stale)
 * - Tier information (free vs pro)
 * - Maximum allowed sessions
 * - Currently active session details
 * 
 * Errors are handled gracefully - if stats cannot be fetched,
 * the function returns undefined values rather than throwing.
 * 
 * @param sessionManager - The session manager instance
 * @param debug - Whether to log debug information
 * @returns SessionInfo with stats and active session, or undefined values on error
 */
export async function collectSessionInfo(
  sessionManager: SessionManager,
  debug: boolean = false
): Promise<SessionInfo> {
  try {
    const stats = await sessionManager.getStats();
    const sessions = await sessionManager.listSessions();
    const activeSess = sessions.find((s) => s.isActive);
    
    let activeSession: ActiveSessionDetails | undefined;
    if (activeSess) {
      activeSession = {
        id: activeSess.id,
        label: activeSess.label,
        runtime: activeSess.runtime.label,
      };
    }
    
    return { stats, activeSession };
  } catch (error) {
    if (debug) {
      console.error(chalk.yellow("Warning: Could not fetch session stats"), error);
    }
    return { stats: undefined, activeSession: undefined };
  }
}

/**
 * Populate StatusInfo with session statistics.
 * 
 * Transforms SessionInfo into the format expected by StatusInfo.sessions.
 * This is a pure transformation function with no side effects.
 * 
 * @param statusInfo - The status info object to populate (mutated in place)
 * @param sessionInfo - The session info to extract from
 */
export function populateStatusInfoSessions(
  statusInfo: StatusInfo,
  sessionInfo: SessionInfo
): void {
  if (!sessionInfo.stats) return;
  
  statusInfo.sessions = {
    total: sessionInfo.stats.totalSessions,
    active: sessionInfo.stats.activeSessions,
    connected: sessionInfo.stats.connectedSessions,
    stale: sessionInfo.stats.staleSessions,
    max: sessionInfo.stats.maxSessions,
    tier: sessionInfo.stats.tier,
  };
  
  if (sessionInfo.activeSession) {
    statusInfo.sessions.activeSession = sessionInfo.activeSession;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime Information Collectors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for runtime info collection.
 */
export interface RuntimeInfoConfig {
  /** The Colab client for API calls */
  colabClient: ColabClient;
  /** The runtime assignment from Colab */
  assignment: {
    variant: string;
    accelerator: string;
    endpoint: string;
  };
}

/**
 * Collect detailed runtime information including GPU and kernel status.
 * 
 * This function performs several API calls to gather:
 * 1. Runtime connectivity status (via proxy refresh)
 * 2. GPU information (name, memory, utilization) via nvidia-smi
 * 3. Kernel status (id, execution state, connections)
 * 
 * Each step handles errors gracefully - if GPU info or kernel info
 * cannot be fetched, the function continues with partial information.
 * 
 * @param config - Configuration containing client and assignment info
 * @returns RuntimeInfo with all available details
 */
export async function collectRuntimeInfo(
  config: RuntimeInfoConfig
): Promise<RuntimeInfo> {
  const { colabClient, assignment } = config;
  const runtimeLabel = `Colab ${assignment.variant} ${assignment.accelerator}`;
  
  // Initialize with base information
  const runtimeInfo: RuntimeInfo = {
    label: runtimeLabel,
    endpoint: assignment.endpoint,
    accelerator: assignment.accelerator,
    connected: false,
  };

  try {
    // Step 1: Verify connectivity by refreshing proxy connection
    const proxy = await colabClient.refreshConnection(assignment.endpoint);
    
    const runtime = {
      label: runtimeLabel,
      accelerator: assignment.accelerator,
      endpoint: assignment.endpoint,
      proxy,
    };

    runtimeInfo.connected = true;
    
    // Step 2: Try to get GPU info for GPU runtimes
    if (assignment.accelerator && assignment.accelerator.toLowerCase() !== "none") {
      await collectGpuInfo(runtimeInfo, colabClient, runtime);
    }

    // Step 3: Try to get kernel status
    await collectKernelInfo(runtimeInfo, colabClient, proxy);
    
  } catch {
    // Connection failed - runtimeInfo.connected remains false
  }
  
  return runtimeInfo;
}

/**
 * Collect GPU information for a runtime.
 * 
 * Queries nvidia-smi on the remote runtime to get:
 * - GPU name (e.g., "Tesla T4")
 * - Memory (total, used, free)
 * - Utilization percentages
 * 
 * @param runtimeInfo - RuntimeInfo to populate (mutated in place)
 * @param colabClient - Colab client for command execution
 * @param runtime - Runtime connection details
 */
async function collectGpuInfo(
  runtimeInfo: RuntimeInfo,
  colabClient: ColabClient,
  runtime: { label: string; accelerator: string; endpoint: string; proxy: { url: string; token: string; tokenExpiresInSeconds: number } }
): Promise<void> {
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
    // GPU info unavailable - continue without it
  }
}

/**
 * Collect kernel information for a runtime.
 * 
 * Lists active Jupyter kernels and extracts:
 * - Kernel ID
 * - Execution state (idle, busy, etc.)
 * - Connection count
 * 
 * @param runtimeInfo - RuntimeInfo to populate (mutated in place)
 * @param colabClient - Colab client for API calls
 * @param proxy - Proxy connection info
 */
async function collectKernelInfo(
  runtimeInfo: RuntimeInfo,
  colabClient: ColabClient,
  proxy: { url: string; token: string }
): Promise<void> {
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
    // Kernel info unavailable - continue without it
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Display Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Display a single runtime's information in human-readable format.
 * 
 * Outputs a formatted box with:
 * - Runtime label and endpoint
 * - GPU info with memory usage (color-coded for high usage)
 * - Kernel status
 * - Connection status
 * 
 * @param runtimeInfo - The runtime info to display
 */
export function displayRuntimeInfo(runtimeInfo: RuntimeInfo): void {
  console.log(chalk.bold(`\n┌─ Runtime: ${runtimeInfo.label}`));
  console.log(chalk.gray(`│  Endpoint: ${runtimeInfo.endpoint}`));
  console.log(chalk.gray(`│  Accelerator: ${runtimeInfo.accelerator}`));
  
  if (runtimeInfo.gpu) {
    console.log(chalk.gray(`│  GPU: ${runtimeInfo.gpu.name}`));
    const memUsagePercent = Number.parseInt(
      runtimeInfo.gpu.utilization.memory.replace("%", ""), 
      10
    );
    const memColor = memUsagePercent > 80 ? chalk.yellow : chalk.gray;
    console.log(memColor(
      `│  GPU Memory: ${runtimeInfo.gpu.memory.used} / ${runtimeInfo.gpu.memory.total} (${runtimeInfo.gpu.utilization.memory})`
    ));
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

/**
 * Display session statistics in human-readable format.
 * 
 * Shows:
 * - Total sessions vs maximum allowed
 * - Active session highlight
 * - Status breakdown (active, connected, stale)
 * 
 * @param sessionInfo - Session statistics and active session
 */
export function displaySessionStats(sessionInfo: SessionInfo): void {
  if (!sessionInfo.stats) return;
  
  const { stats, activeSession } = sessionInfo;
  
  console.log(chalk.bold("\nSessions:"));
  console.log(`  Total: ${stats.totalSessions} / ${stats.maxSessions} (${stats.tier} tier)`);
  
  if (activeSession) {
    console.log(`  Active Session: ${chalk.bold(activeSession.id.substring(0, 8))} (${activeSession.label})`);
  }

  if (stats.totalSessions > 0) {
    console.log(`  ${chalk.green("●")} Active: ${stats.activeSessions}`);
    console.log(`  ${chalk.blue("●")} Connected: ${stats.connectedSessions}`);
    if (stats.staleSessions > 0) {
      console.log(`  ${chalk.red("●")} Stale: ${stats.staleSessions} (run 'lecoder-cgpu sessions clean' to remove)`);
    }
  }
}
