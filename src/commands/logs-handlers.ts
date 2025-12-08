/**
 * Logs Command Handlers Module
 * 
 * This module provides the handler functions for the `logs` command.
 * The `logs` command retrieves and displays execution history from previous runs.
 * 
 * ## Features
 * 
 * - **List History** - Show previous command executions with status, timing, output
 * - **Filter History** - Filter by status, category, mode, date range
 * - **Statistics** - Show aggregated stats (success rate, errors by category)
 * - **Clear History** - Remove all stored history entries
 * 
 * ## Flow Overview
 * 
 * ```
 * logs command
 *   ├── Handle --clear (clear and exit)
 *   ├── Handle --stats (show stats and exit)
 *   ├── Parse filter options
 *   ├── Query history storage
 *   └── Output results (human or JSON)
 * ```
 * 
 * @module commands/logs-handlers
 */

import chalk from "chalk";
import { ExecutionHistoryStorage, type HistoryEntry, type HistoryQueryFilters, type HistoryStats } from "../runtime/execution-history.js";
import { ReplyStatus } from "../jupyter/protocol.js";
import { ErrorCategory } from "../jupyter/error-handler.js";
import { OutputFormatter } from "../utils/output-formatter.js";

// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the logs command.
 * Parsed from CLI flags.
 */
export interface LogsCommandOptions {
  /** Maximum entries to show */
  limit?: string;
  /** Filter by status: ok, error, abort */
  status?: string;
  /** Filter by error category */
  category?: string;
  /** Show entries since date */
  since?: string;
  /** Filter by execution mode */
  mode?: string;
  /** Output as JSON */
  json?: boolean;
  /** Clear all history */
  clear?: boolean;
  /** Show statistics instead of entries */
  stats?: boolean;
}

/**
 * Result of processing the logs command.
 */
export interface LogsCommandResult {
  /** Whether the command completed successfully */
  success: boolean;
  /** Number of entries displayed (if applicable) */
  entriesDisplayed?: number;
  /** Whether history was cleared */
  cleared?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// History Clearing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clear all execution history.
 * 
 * Removes all stored history entries. This action is irreversible.
 * 
 * @param jsonMode - Output result as JSON
 * @returns Result indicating success
 */
export async function clearHistory(jsonMode: boolean): Promise<LogsCommandResult> {
  const historyStorage = new ExecutionHistoryStorage();
  await historyStorage.clear();
  
  if (jsonMode) {
    console.log(JSON.stringify({ cleared: true }));
  } else {
    console.log(chalk.green("✓ Execution history cleared"));
  }
  
  return { success: true, cleared: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Statistics Display
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Display execution history statistics.
 * 
 * Shows aggregated information:
 * - Total executions count
 * - Success/failure/abort breakdown
 * - Success rate percentage
 * - Breakdown by execution mode
 * - Errors grouped by category
 * - Date range of entries
 * 
 * @param jsonMode - Output as JSON instead of formatted text
 * @returns Result indicating success
 */
export async function displayStats(jsonMode: boolean): Promise<LogsCommandResult> {
  const historyStorage = new ExecutionHistoryStorage();
  const stats = await historyStorage.getStats();
  
  if (jsonMode) {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    displayStatsHuman(stats);
  }
  
  return { success: true };
}

/**
 * Format and display statistics in human-readable format.
 * 
 * @param stats - The statistics to display
 */
function displayStatsHuman(stats: HistoryStats): void {
  console.log(chalk.bold("Execution History Statistics"));
  console.log(chalk.gray("─".repeat(50)));
  console.log(`Total executions: ${stats.totalExecutions}`);
  console.log(`${chalk.green("✓")} Successful: ${stats.successfulExecutions}`);
  console.log(`${chalk.red("✗")} Failed: ${stats.failedExecutions}`);
  console.log(`${chalk.yellow("⚠")} Aborted: ${stats.abortedExecutions}`);
  console.log(`Success rate: ${stats.successRate.toFixed(1)}%`);
  
  console.log(`\nBy mode:`);
  console.log(`  Terminal: ${stats.executionsByMode.terminal}`);
  console.log(`  Kernel: ${stats.executionsByMode.kernel}`);
  
  if (Object.keys(stats.errorsByCategory).length > 0) {
    console.log(`\nErrors by category:`);
    for (const [category, count] of Object.entries(stats.errorsByCategory)) {
      console.log(`  ${category}: ${count}`);
    }
  }
  
  if (stats.oldestEntry) {
    console.log(`\nOldest entry: ${stats.oldestEntry.toISOString()}`);
  }
  if (stats.newestEntry) {
    console.log(`Newest entry: ${stats.newestEntry.toISOString()}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valid error category names for filtering.
 */
const VALID_CATEGORIES: Record<string, ErrorCategory> = {
  'syntax': ErrorCategory.SYNTAX,
  'runtime': ErrorCategory.RUNTIME,
  'timeout': ErrorCategory.TIMEOUT,
  'memory': ErrorCategory.MEMORY,
  'import': ErrorCategory.IMPORT,
  'io': ErrorCategory.IO,
  'unknown': ErrorCategory.UNKNOWN,
};

/**
 * Parse and validate filter options for history query.
 * 
 * Converts CLI option strings to properly typed filter values.
 * Validates that category names are valid.
 * 
 * @param options - Raw CLI options
 * @param parseDate - Function to parse relative dates (e.g., "1h", "1d")
 * @returns Parsed filters or error
 */
export function parseHistoryFilters(
  options: LogsCommandOptions,
  parseDate: (dateStr: string) => Date
): { filters: HistoryQueryFilters } | { error: string } {
  const filters: HistoryQueryFilters = {};
  
  if (options.limit) {
    filters.limit = Number.parseInt(options.limit, 10);
  }
  
  if (options.status) {
    filters.status = options.status as ReplyStatus;
  }
  
  if (options.category) {
    const categoryInput = options.category.toLowerCase();
    if (categoryInput in VALID_CATEGORIES) {
      filters.category = VALID_CATEGORIES[categoryInput];
    } else {
      return {
        error: `Invalid category: ${options.category}. Valid categories: ${Object.keys(VALID_CATEGORIES).join(', ')}`
      };
    }
  }
  
  if (options.mode) {
    filters.mode = options.mode as "terminal" | "kernel";
  }
  
  if (options.since) {
    filters.since = parseDate(options.since);
  }
  
  return { filters };
}

// ─────────────────────────────────────────────────────────────────────────────
// History Display
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Query and display history entries.
 * 
 * @param filters - Filters to apply to query
 * @param jsonMode - Output as JSON
 * @returns Result with number of entries displayed
 */
export async function displayHistory(
  filters: HistoryQueryFilters,
  jsonMode: boolean
): Promise<LogsCommandResult> {
  const historyStorage = new ExecutionHistoryStorage();
  const entries = await historyStorage.query(filters);
  
  if (jsonMode) {
    console.log(OutputFormatter.formatHistoryList(entries, true));
  } else {
    displayHistoryHuman(entries);
  }
  
  return { success: true, entriesDisplayed: entries.length };
}

/**
 * Display history entries in human-readable format.
 * 
 * Each entry shows:
 * - Status icon (✓ success, ✗ error, ⚠ aborted)
 * - Timestamp
 * - Mode (T=terminal, K=kernel)
 * - Command (truncated to 50 chars)
 * - Error details if failed
 * - Runtime and duration
 * 
 * @param entries - History entries to display
 */
function displayHistoryHuman(entries: HistoryEntry[]): void {
  if (entries.length === 0) {
    console.log(chalk.gray("No execution history found"));
    return;
  }

  console.log(chalk.bold(`Execution History (${entries.length} entries)`));
  console.log(chalk.gray("─".repeat(80)));

  for (const entry of entries) {
    displayHistoryEntry(entry);
  }
}

/**
 * Display a single history entry.
 * 
 * @param entry - The entry to display
 */
function displayHistoryEntry(entry: HistoryEntry): void {
  const timestamp = entry.timestamp.toISOString().replace("T", " ").substring(0, 19);
  const statusIcon = getStatusIcon(entry.status);
  const mode = entry.mode === "kernel" ? "K" : "T";
  const command = entry.command.length > 50 
    ? entry.command.substring(0, 47) + "..." 
    : entry.command;
  const duration = entry.timing ? `${entry.timing.duration_ms}ms` : "N/A";
  
  console.log(`${statusIcon} ${chalk.gray(timestamp)} [${mode}] ${command}`);
  
  if (entry.status === ReplyStatus.ERROR && entry.error) {
    console.log(chalk.red(`  Error: ${entry.error.ename}: ${entry.error.evalue}`));
  }
  
  console.log(chalk.gray(`  Runtime: ${entry.runtime.label} | Duration: ${duration}`));
  console.log("");
}

/**
 * Get the status icon for an entry.
 * 
 * @param status - The execution status
 * @returns Colored icon string
 */
function getStatusIcon(status: ReplyStatus): string {
  if (status === ReplyStatus.OK) {
    return chalk.green("✓");
  } else if (status === ReplyStatus.ERROR) {
    return chalk.red("✗");
  } else {
    return chalk.yellow("⚠");
  }
}
