import { describe, it, expect } from "vitest";
import { OutputFormatter } from "../../src/utils/output-formatter.js";
import { ReplyStatus } from "../../src/jupyter/protocol.js";
import { ErrorCode } from "../../src/jupyter/error-handler.js";
import type { ExecutionResult } from "../../src/jupyter/protocol.js";

describe("OutputFormatter", () => {
  describe("stripAnsiCodes", () => {
    it("should remove ANSI color codes from text", () => {
      const textWithAnsi = "\x1b[31mError\x1b[0m: Something went wrong";
      const stripped = OutputFormatter.stripAnsiCodes(textWithAnsi);
      expect(stripped).toBe("Error: Something went wrong");
    });

    it("should handle text without ANSI codes", () => {
      const plainText = "Plain text output";
      const stripped = OutputFormatter.stripAnsiCodes(plainText);
      expect(stripped).toBe(plainText);
    });

    it("should handle multiple ANSI codes", () => {
      const text = "\x1b[32m\x1b[1mBold Green\x1b[0m\x1b[31m Red\x1b[0m";
      const stripped = OutputFormatter.stripAnsiCodes(text);
      expect(stripped).toBe("Bold Green Red");
    });
  });

  describe("formatExecutionResult - JSON mode", () => {
    it("should format successful execution as JSON", () => {
      const result: ExecutionResult = {
        status: ReplyStatus.OK,
        stdout: "Hello, World!\n",
        stderr: "",
        traceback: [],
        display_data: [],
        execution_count: 1,
      };

      const json = OutputFormatter.formatExecutionResult(result, { json: true });
      const parsed = JSON.parse(json);

      expect(parsed.status).toBe("ok");
      expect(parsed.errorCode).toBe(ErrorCode.SUCCESS);
      expect(parsed.stdout).toBe("Hello, World!\n");
    });

    it("should format execution with error as JSON", () => {
      const result: ExecutionResult = {
        status: ReplyStatus.ERROR,
        stdout: "",
        stderr: "",
        traceback: ["Traceback (most recent call last):", "  Line 1", "SyntaxError: invalid syntax"],
        display_data: [],
        execution_count: 1,
        error: {
          ename: "SyntaxError",
          evalue: "invalid syntax",
          traceback: ["Traceback (most recent call last):", "  Line 1", "SyntaxError: invalid syntax"],
        },
      };

      const json = OutputFormatter.formatExecutionResult(result, { json: true });
      const parsed = JSON.parse(json);

      expect(parsed.status).toBe("error");
      expect(parsed.error).toBeDefined();
      expect(parsed.error.name).toBe("SyntaxError");
      expect(parsed.error.category).toBe("syntax");
      expect(parsed.errorCode).toBe(ErrorCode.SYNTAX_ERROR);
    });

    it("should strip ANSI codes in JSON output", () => {
      const result: ExecutionResult = {
        status: ReplyStatus.OK,
        stdout: "\x1b[32mGreen text\x1b[0m",
        stderr: "\x1b[31mRed warning\x1b[0m",
        traceback: [],
        display_data: [],
        execution_count: 1,
      };

      const json = OutputFormatter.formatExecutionResult(result, { json: true });
      const parsed = JSON.parse(json);

      expect(parsed.stdout).toBe("Green text");
      expect(parsed.stderr).toBe("Red warning");
      expect(parsed.stdout).not.toContain("\x1b");
      expect(parsed.stderr).not.toContain("\x1b");
    });

    it("should include timing information when present", () => {
      const result: ExecutionResult = {
        status: ReplyStatus.OK,
        stdout: "Done",
        stderr: "",
        traceback: [],
        display_data: [],
        execution_count: 1,
        timing: {
          started: "2024-01-01T00:00:00.000Z",
          completed: "2024-01-01T00:00:01.500Z",
          duration_ms: 1500,
        },
      };

      const json = OutputFormatter.formatExecutionResult(result, { json: true });
      const parsed = JSON.parse(json);

      expect(parsed.timing).toBeDefined();
      expect(parsed.timing.duration_ms).toBe(1500);
    });

    it("should exclude metadata when includeMetadata is false", () => {
      const result: ExecutionResult = {
        status: ReplyStatus.OK,
        stdout: "Output",
        stderr: "",
        traceback: [],
        display_data: [],
        execution_count: 5,
        timing: {
          started: "2024-01-01T00:00:00.000Z",
          completed: "2024-01-01T00:00:01.000Z",
          duration_ms: 1000,
        },
      };

      const json = OutputFormatter.formatExecutionResult(result, {
        json: true,
        includeMetadata: false,
      });
      const parsed = JSON.parse(json);

      expect(parsed.timing).toBeUndefined();
      expect(parsed.execution_count).toBeUndefined();
    });

    it("should include error suggestions in JSON output", () => {
      const result: ExecutionResult = {
        status: ReplyStatus.ERROR,
        stdout: "",
        stderr: "",
        traceback: [],
        display_data: [],
        execution_count: 1,
        error: {
          ename: "ImportError",
          evalue: "No module named 'pandas'",
          traceback: ["ImportError: No module named 'pandas'"],
        },
      };

      const json = OutputFormatter.formatExecutionResult(result, { json: true });
      const parsed = JSON.parse(json);

      expect(parsed.error.suggestion).toBeDefined();
      expect(parsed.error.suggestion).toContain("pip install pandas");
    });
  });

  describe("formatHistoryList", () => {
    it("should format empty history as JSON", () => {
      const json = OutputFormatter.formatHistoryList([], true);
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(0);
    });

    it("should format history entries as JSON array", () => {
      const entries = [
        {
          id: "test-1",
          timestamp: new Date("2024-01-01T00:00:00Z"),
          command: 'print("hello")',
          mode: "kernel" as const,
          runtime: { label: "Test Runtime", accelerator: "T4" },
          status: ReplyStatus.OK,
          stdout: "hello\n",
          stderr: "",
          traceback: [],
          display_data: [],
          execution_count: 1,
          errorCode: 0,
        },
      ];

      const json = OutputFormatter.formatHistoryList(entries, true);
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe("test-1");
      expect(parsed[0].command).toBe('print("hello")');
      expect(parsed[0].timestamp).toBe("2024-01-01T00:00:00.000Z");
    });

    it("should strip ANSI codes from history entries", () => {
      const entries = [
        {
          id: "test-1",
          timestamp: new Date(),
          command: "test",
          mode: "kernel" as const,
          runtime: { label: "Test", accelerator: "T4" },
          status: ReplyStatus.OK,
          stdout: "\x1b[32mSuccess\x1b[0m",
          stderr: "",
          traceback: [],
          display_data: [],
          execution_count: 1,
          errorCode: 0,
        },
      ];

      const json = OutputFormatter.formatHistoryList(entries, true);
      const parsed = JSON.parse(json);

      expect(parsed[0].stdout).toBe("Success");
      expect(parsed[0].stdout).not.toContain("\x1b");
    });
  });

  describe("isJsonMode", () => {
    it("should detect --json flag in argv", () => {
      const originalArgv = process.argv;
      
      try {
        process.argv = ["node", "script.js", "--json"];
        expect(OutputFormatter.isJsonMode()).toBe(true);
      } finally {
        process.argv = originalArgv;
      }
    });

    it("should return false when --json flag not present", () => {
      const originalArgv = process.argv;
      
      try {
        process.argv = ["node", "script.js"];
        expect(OutputFormatter.isJsonMode()).toBe(false);
      } finally {
        process.argv = originalArgv;
      }
    });
  });
});
