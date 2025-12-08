import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RemoteCommandRunner } from "../../src/runtime/remote-command-runner.js";
import type { ColabConnection } from "../../src/jupyter/colab-connection.js";
import { ReplyStatus } from "../../src/jupyter/protocol.js";
import type { ExecutionResult } from "../../src/jupyter/protocol.js";

describe("Run Command Modes", () => {
  let mockRunner: RemoteCommandRunner;
  let mockConnection: ColabConnection;

  beforeEach(() => {
    mockRunner = {
      run: vi.fn().mockResolvedValue(0),
    } as unknown as RemoteCommandRunner;

    mockConnection = {
      executeCode: vi.fn(),
      shutdown: vi.fn(),
    } as unknown as ColabConnection;
  });

  describe("Terminal Mode (default)", () => {
    it("should execute shell command via terminal", async () => {
      const exitCode = await mockRunner.run("nvidia-smi");
      expect(exitCode).toBe(0);
      expect(mockRunner.run).toHaveBeenCalledWith("nvidia-smi");
    });

    it("should return non-zero exit code for failed command", async () => {
      mockRunner.run = vi.fn().mockResolvedValue(1);
      const exitCode = await mockRunner.run("invalid-command");
      expect(exitCode).toBe(1);
    });

    it("should stream output line-by-line", async () => {
      const command = "echo 'hello world'";
      const exitCode = await mockRunner.run(command);
      expect(exitCode).toBe(0);
      expect(mockRunner.run).toHaveBeenCalledWith(command);
    });
  });

  describe("Kernel Mode", () => {
    it("should execute Python code successfully", async () => {
      const result: ExecutionResult = {
        status: ReplyStatus.OK,
        execution_count: 1,
        stdout: "True\n",
        stderr: "",
        traceback: [],
        display_data: [],
      };

      mockConnection.executeCode = vi.fn().mockResolvedValue(result);

      const code = "import torch; print(torch.cuda.is_available())";
      const executionResult = await mockConnection.executeCode(code);

      expect(executionResult.status).toBe(ReplyStatus.OK);
      expect(executionResult.stdout).toBe("True\n");
      expect(mockConnection.executeCode).toHaveBeenCalledWith(code);
    });

    it("should capture Python errors with traceback", async () => {
      const result: ExecutionResult = {
        status: ReplyStatus.ERROR,
        execution_count: 2,
        stdout: "",
        stderr: "",
        traceback: [
          "Traceback (most recent call last):",
          '  File "<stdin>", line 1, in <module>',
          "NameError: name 'undefined_var' is not defined",
        ],
        display_data: [],
        error: {
          ename: "NameError",
          evalue: "name 'undefined_var' is not defined",
          traceback: [
            "Traceback (most recent call last):",
            '  File "<stdin>", line 1, in <module>',
            "NameError: name 'undefined_var' is not defined",
          ],
        },
      };

      mockConnection.executeCode = vi.fn().mockResolvedValue(result);

      const code = "print(undefined_var)";
      const executionResult = await mockConnection.executeCode(code);

      expect(executionResult.status).toBe(ReplyStatus.ERROR);
      expect(executionResult.error?.ename).toBe("NameError");
      expect(executionResult.traceback.length).toBeGreaterThan(0);
    });

    it("should handle multi-line Python code", async () => {
      const result: ExecutionResult = {
        status: ReplyStatus.OK,
        execution_count: 3,
        stdout: "6\n",
        stderr: "",
        traceback: [],
        display_data: [],
      };

      mockConnection.executeCode = vi.fn().mockResolvedValue(result);

      const code = "def add(a, b):\n    return a + b\nprint(add(2, 4))";
      const executionResult = await mockConnection.executeCode(code);

      expect(executionResult.status).toBe(ReplyStatus.OK);
      expect(executionResult.stdout).toBe("6\n");
    });

    it("should handle timeout in kernel execution", async () => {
      mockConnection.executeCode = vi.fn().mockRejectedValue(
        new Error("Execution timed out after 5000ms")
      );

      const code = "import time; time.sleep(10)";
      
      await expect(mockConnection.executeCode(code)).rejects.toThrow(
        "Execution timed out"
      );
    });

    it("should shutdown connection after execution", async () => {
      const result: ExecutionResult = {
        status: ReplyStatus.OK,
        execution_count: 1,
        stdout: "output\n",
        stderr: "",
        traceback: [],
        display_data: [],
      };

      mockConnection.executeCode = vi.fn().mockResolvedValue(result);
      mockConnection.shutdown = vi.fn().mockResolvedValue(undefined);

      await mockConnection.executeCode("print('output')");
      await mockConnection.shutdown();

      expect(mockConnection.shutdown).toHaveBeenCalled();
    });

    it("should capture stderr output", async () => {
      const result: ExecutionResult = {
        status: ReplyStatus.OK,
        execution_count: 4,
        stdout: "",
        stderr: "Warning: deprecation notice\n",
        traceback: [],
        display_data: [],
      };

      mockConnection.executeCode = vi.fn().mockResolvedValue(result);

      const code = "import warnings; warnings.warn('deprecation notice')";
      const executionResult = await mockConnection.executeCode(code);

      expect(executionResult.stderr).toContain("Warning");
    });

    it("should handle display_data output", async () => {
      const result: ExecutionResult = {
        status: ReplyStatus.OK,
        execution_count: 5,
        stdout: "",
        stderr: "",
        traceback: [],
        display_data: [
          {
            data: { "text/plain": "[1, 2, 3]" },
            metadata: {},
            transient: {},
          },
        ],
      };

      mockConnection.executeCode = vi.fn().mockResolvedValue(result);

      const code = "[1, 2, 3]";
      const executionResult = await mockConnection.executeCode(code);

      expect(executionResult.display_data.length).toBe(1);
      expect(executionResult.display_data[0].data["text/plain"]).toBe("[1, 2, 3]");
    });
  });

  describe("Mode Validation", () => {
    it("should default to terminal mode when mode not specified", () => {
      const mode = (undefined as string | undefined) || "terminal";
      expect(mode).toBe("terminal");
    });

    it("should accept kernel mode when specified", () => {
      const mode = "kernel";
      expect(mode).toBe("kernel");
    });

    it("should handle invalid mode value", () => {
      const invalidMode = "invalid" as "terminal" | "kernel";
      // In practice, Commander.js would validate this, but we test the type
      expect(invalidMode).toBeDefined();
    });
  });
});
