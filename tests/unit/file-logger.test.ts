import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { FileLogger, LogLevel, initFileLogger, getFileLogger } from "../../src/utils/file-logger.js";

describe("FileLogger", () => {
  let testLogsDir: string;
  let logger: FileLogger;

  beforeEach(async () => {
    // Create temporary directory for test logs
    testLogsDir = path.join(os.tmpdir(), `cgpu-test-logs-${Date.now()}`);
    await fs.mkdir(testLogsDir, { recursive: true });
    
    logger = new FileLogger({
      logsDir: testLogsDir,
      minLevel: LogLevel.DEBUG,
      maxFileSize: 1024 * 1024, // 1MB for tests
      retentionDays: 1,
      consoleOutput: false,
    });
    
    await logger.initialize();
  });

  afterEach(async () => {
    // Clean up
    if (logger) {
      await logger.close();
    }
    try {
      await fs.rm(testLogsDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Basic Logging", () => {
    it("should create log directory", async () => {
      const stats = await fs.stat(testLogsDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it("should write INFO level logs", async () => {
      logger.info("TEST", "Test message", { key: "value" });
      
      // Wait for async write
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const files = await fs.readdir(testLogsDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files[0]).toMatch(/cgpu-\d{4}-\d{2}-\d{2}\.log/);
    });

    it("should write DEBUG level logs", async () => {
      logger.debug("TEST", "Debug message", { debug: true });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const logFile = await logger.getCurrentLogFile();
      expect(logFile).toBeTruthy();
      
      if (logFile) {
        const content = await fs.readFile(logFile, "utf-8");
        expect(content).toContain('"levelName":"DEBUG"');
        expect(content).toContain('"category":"TEST"');
        expect(content).toContain("Debug message");
      }
    });

    it("should write WARN level logs", async () => {
      logger.warn("TEST", "Warning message");
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const logFile = await logger.getCurrentLogFile();
      if (logFile) {
        const content = await fs.readFile(logFile, "utf-8");
        expect(content).toContain('"levelName":"WARN"');
      }
    });

    it("should write ERROR level logs with error object", async () => {
      const error = new Error("Test error");
      error.stack = "Error: Test error\n  at test.ts:123";
      
      logger.error("TEST", "Error occurred", error, { context: "test" });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const logFile = await logger.getCurrentLogFile();
      if (logFile) {
        const content = await fs.readFile(logFile, "utf-8");
        expect(content).toContain('"levelName":"ERROR"');
        expect(content).toContain("Test error");
        expect(content).toContain("test.ts:123");
      }
    });
  });

  describe("Log Level Filtering", () => {
    it("should respect minLevel setting", async () => {
      const infoLogger = new FileLogger({
        logsDir: testLogsDir,
        minLevel: LogLevel.INFO,
        consoleOutput: false,
      });
      await infoLogger.initialize();
      
      infoLogger.debug("TEST", "Should not appear");
      infoLogger.info("TEST", "Should appear");
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const logFile = await infoLogger.getCurrentLogFile();
      if (logFile) {
        const content = await fs.readFile(logFile, "utf-8");
        expect(content).not.toContain("Should not appear");
        expect(content).toContain("Should appear");
      }
      
      await infoLogger.close();
    });
  });

  describe("Specialized Logging Methods", () => {
    it("should log API calls", async () => {
      logger.logApi("POST", "/api/endpoint", 200, 145);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const logFile = await logger.getCurrentLogFile();
      if (logFile) {
        const content = await fs.readFile(logFile, "utf-8");
        const lines = content.trim().split("\n");
        const lastEntry = JSON.parse(lines[lines.length - 1]);
        
        expect(lastEntry.category).toBe("API");
        expect(lastEntry.message).toContain("POST");
        expect(lastEntry.message).toContain("/api/endpoint");
        expect(lastEntry.data.statusCode).toBe(200);
        expect(lastEntry.data.durationMs).toBe(145);
      }
    });

    it("should log session events", async () => {
      logger.logSession("create", "session-123", { label: "Test Session" });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const logFile = await logger.getCurrentLogFile();
      if (logFile) {
        const content = await fs.readFile(logFile, "utf-8");
        const lines = content.trim().split("\n");
        const lastEntry = JSON.parse(lines[lines.length - 1]);
        
        expect(lastEntry.category).toBe("SESSION");
        expect(lastEntry.message).toContain("create");
        expect(lastEntry.message).toContain("session-123");
        expect(lastEntry.data.label).toBe("Test Session");
      }
    });

    it("should log runtime events", async () => {
      logger.logRuntime("assign", { variant: "GPU", accelerator: "A100" });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const logFile = await logger.getCurrentLogFile();
      if (logFile) {
        const content = await fs.readFile(logFile, "utf-8");
        expect(content).toContain('"category":"RUNTIME"');
        expect(content).toContain("assign");
        expect(content).toContain("A100");
      }
    });

    it("should log command execution", async () => {
      logger.logCommand("python", ["script.py", "--flag"], 1234, 0);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const logFile = await logger.getCurrentLogFile();
      if (logFile) {
        const content = await fs.readFile(logFile, "utf-8");
        const lines = content.trim().split("\n");
        const lastEntry = JSON.parse(lines[lines.length - 1]);
        
        expect(lastEntry.category).toBe("COMMAND");
        expect(lastEntry.data.args).toEqual(["script.py", "--flag"]);
        expect(lastEntry.data.durationMs).toBe(1234);
        expect(lastEntry.data.exitCode).toBe(0);
      }
    });

    it("should log WebSocket events", async () => {
      logger.logWebSocket("open", { endpoint: "wss://test" });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const logFile = await logger.getCurrentLogFile();
      if (logFile) {
        const content = await fs.readFile(logFile, "utf-8");
        expect(content).toContain('"category":"WEBSOCKET"');
        expect(content).toContain("open");
      }
    });

    it("should log kernel messages", async () => {
      logger.logKernel("execute_request", { code: "print('hello')" });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const logFile = await logger.getCurrentLogFile();
      if (logFile) {
        const content = await fs.readFile(logFile, "utf-8");
        expect(content).toContain('"category":"KERNEL"');
        expect(content).toContain("execute_request");
      }
    });
  });

  describe("File Management", () => {
    it("should list log files", async () => {
      logger.info("TEST", "Message 1");
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const files = await logger.listLogFiles();
      expect(files.length).toBeGreaterThan(0);
      expect(files[0]).toMatch(/cgpu-\d{4}-\d{2}-\d{2}\.log/);
    });

    it("should return current log file path", async () => {
      const currentFile = logger.getCurrentLogFile();
      expect(currentFile).toBeTruthy();
      expect(currentFile).toContain(testLogsDir);
    });

    it("should return logs directory", () => {
      const logsDir = logger.getLogsDir();
      expect(logsDir).toBe(testLogsDir);
    });

    it("should read log file entries", async () => {
      logger.info("TEST", "Message 1");
      logger.info("TEST", "Message 2");
      logger.warn("TEST", "Warning");
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const files = await logger.listLogFiles();
      const entries = await logger.readLogFile(files[0]);
      
      expect(entries.length).toBeGreaterThanOrEqual(3);
      expect(entries.some(e => e.message === "Message 1")).toBe(true);
      expect(entries.some(e => e.message === "Message 2")).toBe(true);
      expect(entries.some(e => e.message === "Warning")).toBe(true);
    });
  });

  describe("Search Functionality", () => {
    beforeEach(async () => {
      // Add various log entries
      logger.debug("API", "GET /endpoint");
      logger.info("SESSION", "Session created");
      logger.warn("RUNTIME", "Runtime warning");
      logger.error("API", "API error", new Error("Failed"));
      
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it("should search by log level", async () => {
      const entries = await logger.searchLogs({ level: LogLevel.ERROR });
      
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every(e => e.level >= LogLevel.ERROR)).toBe(true);
    });

    it("should search by category", async () => {
      const entries = await logger.searchLogs({ category: "API" });
      
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every(e => e.category === "API")).toBe(true);
    });

    it("should search by text", async () => {
      const entries = await logger.searchLogs({ searchText: "created" });
      
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some(e => e.message.toLowerCase().includes("created"))).toBe(true);
    });

    it("should limit search results", async () => {
      const entries = await logger.searchLogs({ limit: 2 });
      
      expect(entries.length).toBeLessThanOrEqual(2);
    });

    it("should combine multiple filters", async () => {
      const entries = await logger.searchLogs({
        level: LogLevel.INFO,
        category: "SESSION",
        searchText: "created",
      });
      
      expect(entries.every(e => e.level >= LogLevel.INFO)).toBe(true);
      expect(entries.every(e => e.category === "SESSION")).toBe(true);
    });
  });

  describe("Global Logger Functions", () => {
    it("should initialize global logger", () => {
      const globalLogger = initFileLogger(testLogsDir, { minLevel: LogLevel.DEBUG });
      
      expect(globalLogger).toBeTruthy();
      expect(globalLogger.getLogsDir()).toBe(testLogsDir);
    });

    it("should return global logger instance", () => {
      const logger = getFileLogger();
      
      // getFileLogger returns the singleton, which may have been initialized by a previous test
      expect(logger).toBeTruthy();
      expect(logger?.getLogsDir()).toContain("cgpu-test-logs");
    });

    it("should not re-initialize global logger", () => {
      const logger1 = initFileLogger(testLogsDir);
      const logger2 = initFileLogger(testLogsDir);
      
      expect(logger1).toBe(logger2);
    });
  });

  describe("JSON Format", () => {
    it("should write valid JSON lines", async () => {
      logger.info("TEST", "Test message", { key: "value" });
      logger.warn("TEST", "Warning message");
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const logFile = await logger.getCurrentLogFile();
      if (logFile) {
        const content = await fs.readFile(logFile, "utf-8");
        const lines = content.trim().split("\n");
        
        for (const line of lines) {
          expect(() => JSON.parse(line)).not.toThrow();
          const entry = JSON.parse(line);
          expect(entry).toHaveProperty("timestamp");
          expect(entry).toHaveProperty("level");
          expect(entry).toHaveProperty("levelName");
          expect(entry).toHaveProperty("category");
          expect(entry).toHaveProperty("message");
        }
      }
    });

    it("should include all required fields", async () => {
      logger.info("TEST", "Test message", { data: "value" });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const logFile = await logger.getCurrentLogFile();
      if (logFile) {
        const content = await fs.readFile(logFile, "utf-8");
        const entry = JSON.parse(content.trim());
        
        expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(entry.level).toBe(LogLevel.INFO);
        expect(entry.levelName).toBe("INFO");
        expect(entry.category).toBe("TEST");
        expect(entry.message).toBe("Test message");
        expect(entry.data).toEqual({ data: "value" });
      }
    });
  });

  describe("Error Handling", () => {
    it("should handle write errors gracefully", async () => {
      // Close the logger to simulate write failure
      await logger.close();
      
      // This should not throw
      expect(() => logger.info("TEST", "After close")).not.toThrow();
    });

    it("should handle invalid log file read", async () => {
      const entries = await logger.readLogFile("non-existent.log");
      expect(entries).toEqual([]);
    });

    it("should handle search on empty logs", async () => {
      const emptyLogger = new FileLogger({
        logsDir: path.join(testLogsDir, "empty"),
        minLevel: LogLevel.DEBUG,
      });
      await emptyLogger.initialize();
      
      const entries = await emptyLogger.searchLogs({ level: LogLevel.INFO });
      expect(entries).toEqual([]);
      
      await emptyLogger.close();
    });
  });
});
