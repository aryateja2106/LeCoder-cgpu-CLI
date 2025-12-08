import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ExecutionResult, ReplyStatus } from "../jupyter/protocol.js";
import { ErrorCategory, categorizeError } from "../jupyter/error-handler.js";

/**
 * History entry extending ExecutionResult with metadata
 */
export interface HistoryEntry extends ExecutionResult {
  id: string;
  timestamp: Date;
  command: string;
  mode: "terminal" | "kernel";
  runtime: {
    label: string;
    accelerator: string;
  };
  errorCode?: number;
  errorCategory?: ErrorCategory;
}

/**
 * Query filters for execution history
 */
export interface HistoryQueryFilters {
  limit?: number;
  status?: ReplyStatus;
  category?: ErrorCategory;
  since?: Date;
  mode?: "terminal" | "kernel";
}

/**
 * Summary statistics for execution history
 */
export interface HistoryStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  abortedExecutions: number;
  successRate: number;
  errorsByCategory: Record<string, number>;
  executionsByMode: {
    terminal: number;
    kernel: number;
  };
  oldestEntry?: Date;
  newestEntry?: Date;
}

/**
 * Manages persistent execution history storage
 */
export class ExecutionHistoryStorage {
  private readonly historyPath: string;
  private readonly maxFileSize = 10 * 1024 * 1024; // 10MB
  private readonly maxEntries = 1000;

  constructor() {
    const configDir = path.join(homedir(), ".config", "lecoder-cgpu", "state");
    this.historyPath = path.join(configDir, "history.jsonl");
  }

  /**
   * Append execution result to history
   */
  async append(entry: HistoryEntry): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.historyPath), { recursive: true });

      // Convert Date to ISO string for JSON serialization
      const serializedEntry = {
        ...entry,
        timestamp: entry.timestamp.toISOString(),
      };

      // Append to JSONL file
      const line = JSON.stringify(serializedEntry) + "\n";
      await fs.appendFile(this.historyPath, line, "utf-8");

      // Check if rotation is needed
      await this.rotateIfNeeded();
    } catch (error) {
      // Silent fail - history is non-critical
      if (process.env.LECODER_CGPU_DEBUG) {
        console.error("[DEBUG] Failed to append history:", error);
      }
    }
  }

  /**
   * Query history with filters
   */
  async query(filters: HistoryQueryFilters = {}): Promise<HistoryEntry[]> {
    try {
      const entries = await this.readAllEntries();
      let filtered = entries;

      // Apply filters
      if (filters.status) {
        filtered = filtered.filter((e) => e.status === filters.status);
      }

      if (filters.category) {
        filtered = filtered.filter((e) => e.errorCategory === filters.category);
      }

      if (filters.mode) {
        filtered = filtered.filter((e) => e.mode === filters.mode);
      }

      if (filters.since) {
        filtered = filtered.filter(
          (e) => new Date(e.timestamp) >= filters.since!
        );
      }

      // Sort by timestamp descending (newest first)
      filtered.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      // Apply limit
      const limit = filters.limit || 50;
      return filtered.slice(0, limit);
    } catch (error) {
      if (process.env.LECODER_CGPU_DEBUG) {
        console.error("[DEBUG] Failed to query history:", error);
      }
      return [];
    }
  }

  /**
   * Clear all history
   */
  async clear(): Promise<void> {
    try {
      await fs.unlink(this.historyPath);
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  /**
   * Get summary statistics
   */
  async getStats(): Promise<HistoryStats> {
    const entries = await this.readAllEntries();

    const stats: HistoryStats = {
      totalExecutions: entries.length,
      successfulExecutions: 0,
      failedExecutions: 0,
      abortedExecutions: 0,
      successRate: 0,
      errorsByCategory: {},
      executionsByMode: {
        terminal: 0,
        kernel: 0,
      },
    };

    for (const entry of entries) {
      // Count by status
      if (entry.status === "ok") {
        stats.successfulExecutions++;
      } else if (entry.status === "error") {
        stats.failedExecutions++;
        // Count by error category
        if (entry.errorCategory) {
          const category = entry.errorCategory;
          stats.errorsByCategory[category] =
            (stats.errorsByCategory[category] || 0) + 1;
        }
      } else if (entry.status === "abort") {
        stats.abortedExecutions++;
      }

      // Count by mode
      stats.executionsByMode[entry.mode]++;
    }

    // Calculate success rate
    if (stats.totalExecutions > 0) {
      stats.successRate =
        (stats.successfulExecutions / stats.totalExecutions) * 100;
    }

    // Get oldest and newest entries
    if (entries.length > 0) {
      const timestamps = entries.map((e) => new Date(e.timestamp).getTime());
      stats.oldestEntry = new Date(Math.min(...timestamps));
      stats.newestEntry = new Date(Math.max(...timestamps));
    }

    return stats;
  }

  /**
   * Read all entries from history file
   */
  private async readAllEntries(): Promise<HistoryEntry[]> {
    try {
      const content = await fs.readFile(this.historyPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      return lines
        .map((line) => {
          try {
            const parsed = JSON.parse(line);
            // Convert ISO string back to Date
            return {
              ...parsed,
              timestamp: new Date(parsed.timestamp),
            };
          } catch {
            return null; // Skip corrupted entries
          }
        })
        .filter((e): e is HistoryEntry => e !== null);
    } catch (error: any) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  /**
   * Rotate history file if size exceeds limit
   */
  private async rotateIfNeeded(): Promise<void> {
    try {
      const stats = await fs.stat(this.historyPath);

      if (stats.size > this.maxFileSize) {
        const entries = await this.readAllEntries();

        // Keep only last N entries
        const kept = entries
          .sort(
            (a, b) =>
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          )
          .slice(0, this.maxEntries);

        // Rewrite file with kept entries
        const lines = kept.map((e) => {
          const serialized = {
            ...e,
            timestamp: e.timestamp.toISOString(),
          };
          return JSON.stringify(serialized);
        });

        await fs.writeFile(this.historyPath, lines.join("\n") + "\n", "utf-8");
      }
    } catch (error) {
      if (process.env.LECODER_CGPU_DEBUG) {
        console.error("[DEBUG] Failed to rotate history:", error);
      }
    }
  }

  /**
   * Create a history entry from execution result
   */
  static createEntry(
    result: ExecutionResult,
    command: string,
    mode: "terminal" | "kernel",
    runtime: { label: string; accelerator: string },
    errorCode?: number
  ): HistoryEntry {
    // Derive error category from execution result if there's an error
    let errorCategory: ErrorCategory | undefined;
    if (result.error) {
      errorCategory = categorizeError({
        ename: result.error.ename,
        evalue: result.error.evalue,
        traceback: result.error.traceback,
      });
    }

    return {
      ...result,
      id: randomUUID(),
      timestamp: new Date(),
      command,
      mode,
      runtime,
      errorCode,
      errorCategory,
    };
  }
}
