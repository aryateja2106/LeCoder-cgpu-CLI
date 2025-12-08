import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { ExecutionHistoryStorage } from "../../src/runtime/execution-history.js";
import { ReplyStatus } from "../../src/jupyter/protocol.js";
import { ErrorCategory } from "../../src/jupyter/error-handler.js";

describe("ExecutionHistoryStorage", () => {
  let storage: ExecutionHistoryStorage;
  let testHistoryPath: string;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "history-test-"));
    testHistoryPath = path.join(tempDir, "history.jsonl");
    storage = new ExecutionHistoryStorage({ historyPath: testHistoryPath });
    await storage.clear();
  });

  afterEach(async () => {
    await storage.clear();
    // Remove temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("append", () => {
    it("should append entry to history file", async () => {
      const entry = ExecutionHistoryStorage.createEntry(
        {
          status: ReplyStatus.OK,
          stdout: "Hello World",
          stderr: "",
          traceback: [],
          display_data: [],
          execution_count: 1,
        },
        'print("Hello World")',
        "kernel",
        { label: "Colab GPU T4", accelerator: "T4" },
        0
      );

      await storage.append(entry);

      const entries = await storage.query({ limit: 10 });
      expect(entries).toHaveLength(1);
      expect(entries[0].command).toBe('print("Hello World")');
      expect(entries[0].status).toBe(ReplyStatus.OK);
      expect(entries[0].mode).toBe("kernel");
    });

    it("should append multiple entries", async () => {
      for (let i = 0; i < 5; i++) {
        const entry = ExecutionHistoryStorage.createEntry(
          {
            status: ReplyStatus.OK,
            stdout: `Output ${i}`,
            stderr: "",
            traceback: [],
            display_data: [],
            execution_count: i + 1,
          },
          `print(${i})`,
          "kernel",
          { label: "Colab GPU", accelerator: "T4" },
          0
        );
        await storage.append(entry);
      }

      const entries = await storage.query({ limit: 10 });
      expect(entries).toHaveLength(5);
    });
  });

  describe("query", () => {
    beforeEach(async () => {
      // Add test data
      const testEntries = [
        {
          status: ReplyStatus.OK,
          command: "ls -la",
          mode: "terminal" as const,
          errorCode: 0,
          error: undefined,
        },
        {
          status: ReplyStatus.ERROR,
          command: 'import missing_module',
          mode: "kernel" as const,
          errorCode: 1005,
          error: {
            ename: "ImportError",
            evalue: "No module named 'missing_module'",
            traceback: ["ImportError: No module named 'missing_module'"],
          },
        },
        {
          status: ReplyStatus.OK,
          command: 'print("test")',
          mode: "kernel" as const,
          errorCode: 0,
          error: undefined,
        },
        {
          status: ReplyStatus.ERROR,
          command: 'x = 1 / 0',
          mode: "kernel" as const,
          errorCode: 1002,
          error: {
            ename: "ZeroDivisionError",
            evalue: "division by zero",
            traceback: ["ZeroDivisionError: division by zero"],
          },
        },
      ];

      for (const data of testEntries) {
        const entry = ExecutionHistoryStorage.createEntry(
          {
            status: data.status,
            stdout: "",
            stderr: "",
            traceback: data.error ? data.error.traceback : [],
            display_data: [],
            execution_count: null,
            error: data.error,
          },
          data.command,
          data.mode,
          { label: "Test Runtime", accelerator: "T4" },
          data.errorCode
        );
        await storage.append(entry);
      }
    });

    it("should query all entries with default limit", async () => {
      const entries = await storage.query();
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.length).toBeLessThanOrEqual(50);
    });

    it("should filter by status", async () => {
      const okEntries = await storage.query({ status: ReplyStatus.OK });
      expect(okEntries).toHaveLength(2);
      expect(okEntries.every((e) => e.status === ReplyStatus.OK)).toBe(true);

      const errorEntries = await storage.query({ status: ReplyStatus.ERROR });
      expect(errorEntries).toHaveLength(2);
      expect(errorEntries.every((e) => e.status === ReplyStatus.ERROR)).toBe(true);
    });

    it("should filter by mode", async () => {
      const terminalEntries = await storage.query({ mode: "terminal" });
      expect(terminalEntries).toHaveLength(1);
      expect(terminalEntries[0].command).toBe("ls -la");

      const kernelEntries = await storage.query({ mode: "kernel" });
      expect(kernelEntries).toHaveLength(3);
    });

    it("should filter by category", async () => {
      const importErrors = await storage.query({ category: ErrorCategory.IMPORT });
      expect(importErrors).toHaveLength(1);
      expect(importErrors[0].command).toBe("import missing_module");

      const runtimeErrors = await storage.query({ category: ErrorCategory.RUNTIME });
      expect(runtimeErrors).toHaveLength(1);
      expect(runtimeErrors[0].command).toBe("x = 1 / 0");
    });

    it("should filter by since date", async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const entries = await storage.query({ since: oneHourAgo });
      expect(entries.length).toBeGreaterThan(0);
    });

    it("should respect limit", async () => {
      const entries = await storage.query({ limit: 2 });
      expect(entries).toHaveLength(2);
    });

    it("should return entries in reverse chronological order", async () => {
      const entries = await storage.query({ limit: 10 });
      for (let i = 0; i < entries.length - 1; i++) {
        expect(entries[i].timestamp.getTime()).toBeGreaterThanOrEqual(
          entries[i + 1].timestamp.getTime()
        );
      }
    });
  });

  describe("clear", () => {
    it("should clear all history", async () => {
      const entry = ExecutionHistoryStorage.createEntry(
        {
          status: ReplyStatus.OK,
          stdout: "test",
          stderr: "",
          traceback: [],
          display_data: [],
          execution_count: 1,
        },
        "test",
        "kernel",
        { label: "Test", accelerator: "T4" },
        0
      );
      await storage.append(entry);

      await storage.clear();

      const entries = await storage.query();
      expect(entries).toHaveLength(0);
    });
  });

  describe("getStats", () => {
    beforeEach(async () => {
      const testData = [
        { status: ReplyStatus.OK, mode: "terminal" as const, error: undefined },
        { status: ReplyStatus.OK, mode: "kernel" as const, error: undefined },
        { 
          status: ReplyStatus.ERROR, 
          mode: "kernel" as const, 
          error: { ename: "SyntaxError", evalue: "invalid syntax", traceback: ["SyntaxError: invalid syntax"] }
        },
        { 
          status: ReplyStatus.ERROR, 
          mode: "kernel" as const, 
          error: { ename: "TypeError", evalue: "type error", traceback: ["TypeError: type error"] }
        },
        { status: ReplyStatus.ABORT, mode: "kernel" as const, error: undefined },
      ];

      for (const data of testData) {
        const entry = ExecutionHistoryStorage.createEntry(
          {
            status: data.status,
            stdout: "",
            stderr: "",
            traceback: data.error ? data.error.traceback : [],
            display_data: [],
            execution_count: null,
            error: data.error,
          },
          "test",
          data.mode,
          { label: "Test", accelerator: "T4" },
          data.status === ReplyStatus.OK ? 0 : 1001
        );
        await storage.append(entry);
      }
    });

    it("should calculate correct statistics", async () => {
      const stats = await storage.getStats();

      expect(stats.totalExecutions).toBe(5);
      expect(stats.successfulExecutions).toBe(2);
      expect(stats.failedExecutions).toBe(2);
      expect(stats.abortedExecutions).toBe(1);
      expect(stats.successRate).toBe(40);
      expect(stats.executionsByMode.terminal).toBe(1);
      expect(stats.executionsByMode.kernel).toBe(4);
    });

    it("should count errors by category", async () => {
      const stats = await storage.getStats();

      expect(stats.errorsByCategory[ErrorCategory.SYNTAX]).toBe(1);
      expect(stats.errorsByCategory[ErrorCategory.RUNTIME]).toBe(1);
    });

    it("should include oldest and newest entry timestamps", async () => {
      const stats = await storage.getStats();

      expect(stats.oldestEntry).toBeDefined();
      expect(stats.newestEntry).toBeDefined();
      expect(stats.newestEntry!.getTime()).toBeGreaterThanOrEqual(
        stats.oldestEntry!.getTime()
      );
    });
  });

  describe("file rotation", () => {
    it("should handle corrupted JSONL entries gracefully", async () => {
      // Manually write a corrupted entry
      await fs.mkdir(path.dirname(testHistoryPath), { recursive: true });
      await fs.writeFile(testHistoryPath, "invalid json\n", "utf-8");

      // Should not throw error
      const entries = await storage.query();
      expect(entries).toHaveLength(0);
    });
  });
});
