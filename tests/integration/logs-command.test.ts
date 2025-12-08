/**
 * Integration tests for `logs` command
 *
 * Tests execution history, filters, stats, and clear operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Types for logs command
interface HistoryEntry {
  id: string;
  timestamp: string;
  command: string;
  mode: "terminal" | "kernel";
  status: "success" | "error" | "timeout";
  exitCode: number;
  errorCode?: number;
  category?: string;
  duration: number;
  sessionId?: string;
}

interface HistoryStats {
  total: number;
  success: number;
  error: number;
  timeout: number;
  averageDuration: number;
  byCategory: Record<string, number>;
  byMode: Record<string, number>;
}

interface LogsFilter {
  status?: "success" | "error" | "timeout";
  category?: string;
  mode?: "terminal" | "kernel";
  since?: Date;
  limit?: number;
}

// Simulated logs command for testing
class MockLogsCommand {
  private entries: HistoryEntry[] = [];
  private maxEntries = 1000;
  private maxSizeBytes = 10 * 1024 * 1024; // 10MB

  // logs [--status] [--category] [--mode] [--since]
  async list(filter: LogsFilter = {}): Promise<HistoryEntry[]> {
    let result = [...this.entries];

    if (filter.status) {
      result = result.filter((e) => e.status === filter.status);
    }

    if (filter.category) {
      result = result.filter((e) => e.category === filter.category);
    }

    if (filter.mode) {
      result = result.filter((e) => e.mode === filter.mode);
    }

    if (filter.since) {
      result = result.filter(
        (e) => new Date(e.timestamp) >= filter.since!
      );
    }

    if (filter.limit) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  // logs --stats
  async getStats(): Promise<HistoryStats> {
    const entries = this.entries;
    const success = entries.filter((e) => e.status === "success").length;
    const error = entries.filter((e) => e.status === "error").length;
    const timeout = entries.filter((e) => e.status === "timeout").length;

    const totalDuration = entries.reduce((sum, e) => sum + e.duration, 0);
    const averageDuration = entries.length > 0 ? totalDuration / entries.length : 0;

    const byCategory: Record<string, number> = {};
    const byMode: Record<string, number> = {};

    for (const entry of entries) {
      if (entry.category) {
        byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
      }
      byMode[entry.mode] = (byMode[entry.mode] ?? 0) + 1;
    }

    return {
      total: entries.length,
      success,
      error,
      timeout,
      averageDuration,
      byCategory,
      byMode,
    };
  }

  // logs --clear
  async clear(): Promise<number> {
    const count = this.entries.length;
    this.entries = [];
    return count;
  }

  // Add entry
  addEntry(entry: HistoryEntry): void {
    this.entries.unshift(entry); // Add to front (newest first)

    // Enforce max entries limit
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(0, this.maxEntries);
    }
  }

  // Get entry count
  getEntryCount(): number {
    return this.entries.length;
  }

  // Reset
  reset(): void {
    this.entries = [];
  }

  // Create test entries
  createTestEntries(count: number): HistoryEntry[] {
    const entries: HistoryEntry[] = [];
    const statuses: Array<"success" | "error" | "timeout"> = ["success", "error", "timeout"];
    const categories = ["syntax", "runtime", "import", "memory", "io"];
    const modes: Array<"terminal" | "kernel"> = ["terminal", "kernel"];

    for (let i = 0; i < count; i++) {
      const status = statuses[i % statuses.length];
      const entry: HistoryEntry = {
        id: `entry-${i + 1}`,
        timestamp: new Date(Date.now() - i * 60 * 1000).toISOString(),
        command: `command ${i + 1}`,
        mode: modes[i % modes.length],
        status,
        exitCode: status === "success" ? 0 : 1,
        errorCode: status === "error" ? 1000 + (i % 10) : undefined,
        category: status === "error" ? categories[i % categories.length] : undefined,
        duration: 100 + i * 10,
        sessionId: `session-${(i % 3) + 1}`,
      };
      this.addEntry(entry);
      entries.push(entry);
    }
    return entries;
  }
}

describe("Logs Command Integration", () => {
  let logsCommand: MockLogsCommand;

  beforeEach(() => {
    logsCommand = new MockLogsCommand();
  });

  afterEach(() => {
    logsCommand.reset();
  });

  describe("logs list", () => {
    it("should list all entries", async () => {
      logsCommand.createTestEntries(10);

      const entries = await logsCommand.list();

      expect(entries).toHaveLength(10);
    });

    it("should return empty list when no entries", async () => {
      const entries = await logsCommand.list();

      expect(entries).toEqual([]);
    });

    it("should include entry details", async () => {
      logsCommand.createTestEntries(1);

      const entries = await logsCommand.list();

      expect(entries[0].id).toBeDefined();
      expect(entries[0].timestamp).toBeDefined();
      expect(entries[0].command).toBeDefined();
      expect(entries[0].status).toBeDefined();
    });
  });

  describe("logs with --status filter", () => {
    it("should filter by success status", async () => {
      logsCommand.createTestEntries(9);

      const entries = await logsCommand.list({ status: "success" });

      expect(entries.every((e) => e.status === "success")).toBe(true);
    });

    it("should filter by error status", async () => {
      logsCommand.createTestEntries(9);

      const entries = await logsCommand.list({ status: "error" });

      expect(entries.every((e) => e.status === "error")).toBe(true);
    });

    it("should filter by timeout status", async () => {
      logsCommand.createTestEntries(9);

      const entries = await logsCommand.list({ status: "timeout" });

      expect(entries.every((e) => e.status === "timeout")).toBe(true);
    });
  });

  describe("logs with --category filter", () => {
    it("should filter by error category", async () => {
      logsCommand.createTestEntries(20);

      const entries = await logsCommand.list({ category: "syntax" });

      expect(entries.every((e) => e.category === "syntax")).toBe(true);
    });
  });

  describe("logs with --mode filter", () => {
    it("should filter by terminal mode", async () => {
      logsCommand.createTestEntries(10);

      const entries = await logsCommand.list({ mode: "terminal" });

      expect(entries.every((e) => e.mode === "terminal")).toBe(true);
    });

    it("should filter by kernel mode", async () => {
      logsCommand.createTestEntries(10);

      const entries = await logsCommand.list({ mode: "kernel" });

      expect(entries.every((e) => e.mode === "kernel")).toBe(true);
    });
  });

  describe("logs with --since filter", () => {
    it("should filter entries since timestamp", async () => {
      logsCommand.createTestEntries(10);

      const since = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
      const entries = await logsCommand.list({ since });

      for (const entry of entries) {
        expect(new Date(entry.timestamp).getTime()).toBeGreaterThanOrEqual(
          since.getTime()
        );
      }
    });
  });

  describe("logs --stats", () => {
    it("should return statistics summary", async () => {
      logsCommand.createTestEntries(9);

      const stats = await logsCommand.getStats();

      expect(stats.total).toBe(9);
      expect(stats.success).toBe(3);
      expect(stats.error).toBe(3);
      expect(stats.timeout).toBe(3);
    });

    it("should calculate average duration", async () => {
      logsCommand.createTestEntries(10);

      const stats = await logsCommand.getStats();

      expect(stats.averageDuration).toBeGreaterThan(0);
    });

    it("should group by category", async () => {
      logsCommand.createTestEntries(20);

      const stats = await logsCommand.getStats();

      expect(Object.keys(stats.byCategory).length).toBeGreaterThan(0);
    });

    it("should group by mode", async () => {
      logsCommand.createTestEntries(10);

      const stats = await logsCommand.getStats();

      expect(stats.byMode.terminal).toBeDefined();
      expect(stats.byMode.kernel).toBeDefined();
    });
  });

  describe("logs --clear", () => {
    it("should clear all entries", async () => {
      logsCommand.createTestEntries(10);
      expect(logsCommand.getEntryCount()).toBe(10);

      await logsCommand.clear();

      expect(logsCommand.getEntryCount()).toBe(0);
    });

    it("should return count of cleared entries", async () => {
      logsCommand.createTestEntries(10);

      const cleared = await logsCommand.clear();

      expect(cleared).toBe(10);
    });
  });

  describe("--json output", () => {
    it("should be parseable as JSON", async () => {
      logsCommand.createTestEntries(5);

      const entries = await logsCommand.list();
      const jsonStr = JSON.stringify(entries);
      const parsed = JSON.parse(jsonStr);

      expect(parsed).toHaveLength(5);
    });

    it("should include all entry fields in JSON", async () => {
      logsCommand.createTestEntries(1);

      const entries = await logsCommand.list();
      const entry = entries[0];

      expect(entry).toHaveProperty("id");
      expect(entry).toHaveProperty("timestamp");
      expect(entry).toHaveProperty("command");
      expect(entry).toHaveProperty("mode");
      expect(entry).toHaveProperty("status");
      expect(entry).toHaveProperty("exitCode");
      expect(entry).toHaveProperty("duration");
    });
  });

  describe("history rotation", () => {
    it("should enforce max entries limit", () => {
      // Create more than the default limit
      for (let i = 0; i < 1100; i++) {
        logsCommand.addEntry({
          id: `entry-${i}`,
          timestamp: new Date().toISOString(),
          command: `command ${i}`,
          mode: "kernel",
          status: "success",
          exitCode: 0,
          duration: 100,
        });
      }

      // Should be capped at 1000
      expect(logsCommand.getEntryCount()).toBe(1000);
    });

    it("should keep newest entries when rotating", async () => {
      // Create 1100 entries
      for (let i = 0; i < 1100; i++) {
        logsCommand.addEntry({
          id: `entry-${i}`,
          timestamp: new Date().toISOString(),
          command: `command ${i}`,
          mode: "kernel",
          status: "success",
          exitCode: 0,
          duration: 100,
        });
      }

      const entries = await logsCommand.list({ limit: 1 });

      // Newest should be entry-1099
      expect(entries[0].id).toBe("entry-1099");
    });
  });

  describe("combined filters", () => {
    it("should apply multiple filters", async () => {
      logsCommand.createTestEntries(20);

      const entries = await logsCommand.list({
        status: "error",
        mode: "kernel",
      });

      for (const entry of entries) {
        expect(entry.status).toBe("error");
        expect(entry.mode).toBe("kernel");
      }
    });
  });
});
