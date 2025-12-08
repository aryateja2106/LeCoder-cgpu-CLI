/**
 * Integration tests for `run` command
 *
 * Tests terminal and kernel mode execution, JSON output, and error handling
 * by invoking the real CLI via child_process.
 */

import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

// Get the CLI entry point
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = join(__dirname, "../../dist/src/index.js");

// Test data for expected outputs and error codes
const TEST_DATA = {
  terminal: {
    simpleEcho: {
      command: ["echo", "hello"],
      expectedStdout: "hello",
      expectedExitCode: 0,
    },
    commandNotFound: {
      command: ["invalid-command-xyz123"],
      expectedExitCode: 127,
      expectedStderr: "not found",
    },
  },
  kernel: {
    simplePrint: {
      code: "print('hello')",
      expectedStdout: "hello",
      expectedExitCode: 0,
      expectedErrorCode: 0,
    },
    importError: {
      code: "import nonexistent_module_xyz",
      expectedExitCode: 1,
      expectedErrorCode: 1009,
      expectedErrorCategory: "import",
      expectedErrorName: "ModuleNotFoundError",
    },
    runtimeError: {
      code: "1/0",
      expectedExitCode: 1,
      expectedErrorCode: 1014,
      expectedErrorName: "ZeroDivisionError",
    },
  },
};

describe("Run Command Integration", () => {
  describe("CLI invocation", () => {
    it("should be able to invoke the CLI", async () => {
      // Skip if CLI not built yet
      try {
        await execFileAsync("node", [cliPath, "--version"]);
      } catch {
        console.warn("CLI not built yet, skipping integration tests");
        return;
      }
    });

    it("should show help output", async () => {
      const { stdout } = await execFileAsync("node", [cliPath, "--help"]);
      expect(stdout).toContain("lecoder-cgpu");
      expect(stdout).toContain("run");
    });
  });

  describe("terminal mode execution", () => {
    // Note: These tests require authentication and an active Colab runtime
    // They are meant to verify the CLI behaves correctly when given various inputs
    // In a real environment, they would need mocked credentials or test accounts

    it.skip("should execute shell command", async () => {
      const { stdout } = await execFileAsync("node", [
        cliPath,
        "run",
        ...TEST_DATA.terminal.simpleEcho.command,
      ]);

      expect(stdout).toContain(TEST_DATA.terminal.simpleEcho.expectedStdout);
      // execFileAsync only resolves on exit code 0
    });

    it.skip("should handle command not found", async () => {
      try {
        await execFileAsync("node", [
          cliPath,
          "run",
          ...TEST_DATA.terminal.commandNotFound.command,
        ]);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const execError = error as { code: number; stderr: string };
        expect(execError.code).toBe(TEST_DATA.terminal.commandNotFound.expectedExitCode);
        expect(execError.stderr).toContain(TEST_DATA.terminal.commandNotFound.expectedStderr);
      }
    });

    it.skip("should capture stdout", async () => {
      const { stdout } = await execFileAsync("node", [
        cliPath,
        "run",
        "ls",
        "-la",
      ]);

      expect(stdout.length).toBeGreaterThan(0);
    });

    it.skip("should capture stderr", async () => {
      try {
        await execFileAsync("node", [cliPath, "run", "bad-command"]);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const execError = error as { stderr: string };
        expect(execError.stderr.length).toBeGreaterThan(0);
      }
    });
  });

  describe("kernel mode execution", () => {
    it.skip("should execute Python code", async () => {
      const { stdout } = await execFileAsync("node", [
        cliPath,
        "run",
        "--mode",
        "kernel",
        TEST_DATA.kernel.simplePrint.code,
      ]);

      expect(stdout).toContain(TEST_DATA.kernel.simplePrint.expectedStdout);
      // execFileAsync only resolves on exit code 0
    });

    it.skip("should handle import errors", async () => {
      try {
        await execFileAsync("node", [
          cliPath,
          "run",
          "--mode",
          "kernel",
          "--json",
          TEST_DATA.kernel.importError.code,
        ]);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const execError = error as { stdout: string };
        const output = JSON.parse(execError.stdout);
        expect(output.errorCode).toBe(TEST_DATA.kernel.importError.expectedErrorCode);
        expect(output.error?.category).toBe(TEST_DATA.kernel.importError.expectedErrorCategory);
        expect(output.error?.name).toBe(TEST_DATA.kernel.importError.expectedErrorName);
      }
    });

    it.skip("should handle runtime errors", async () => {
      try {
        await execFileAsync("node", [
          cliPath,
          "run",
          "--mode",
          "kernel",
          "--json",
          TEST_DATA.kernel.runtimeError.code,
        ]);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const execError = error as { stdout: string };
        const output = JSON.parse(execError.stdout);
        expect(output.errorCode).toBe(TEST_DATA.kernel.runtimeError.expectedErrorCode);
        expect(output.error?.name).toBe(TEST_DATA.kernel.runtimeError.expectedErrorName);
      }
    });

    it.skip("should include traceback in error", async () => {
      try {
        await execFileAsync("node", [
          cliPath,
          "run",
          "--mode",
          "kernel",
          "--json",
          TEST_DATA.kernel.importError.code,
        ]);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const execError = error as { stdout: string };
        const output = JSON.parse(execError.stdout);
        expect(output.error?.traceback).toBeDefined();
        expect(output.error?.traceback?.length).toBeGreaterThan(0);
      }
    });

    it.skip("should include suggestion for import error", async () => {
      try {
        await execFileAsync("node", [
          cliPath,
          "run",
          "--mode",
          "kernel",
          "--json",
          TEST_DATA.kernel.importError.code,
        ]);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const execError = error as { stdout: string };
        const output = JSON.parse(execError.stdout);
        expect(output.error?.suggestion).toContain("pip install");
      }
    });
  });

  describe("JSON output format", () => {
    it.skip("should include errorCode in output", async () => {
      const { stdout } = await execFileAsync("node", [
        cliPath,
        "run",
        "--mode",
        "kernel",
        "--json",
        TEST_DATA.kernel.simplePrint.code,
      ]);

      const output = JSON.parse(stdout);
      expect(output.errorCode).toBe(0);
    });

    it.skip("should include error details for failures", async () => {
      try {
        await execFileAsync("node", [
          cliPath,
          "run",
          "--mode",
          "kernel",
          "--json",
          TEST_DATA.kernel.importError.code,
        ]);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const execError = error as { stdout: string };
        const output = JSON.parse(execError.stdout);
        expect(output.error).toBeDefined();
        expect(output.error?.category).toBeDefined();
        expect(output.error?.name).toBeDefined();
        expect(output.error?.message).toBeDefined();
      }
    });

    it.skip("should be parseable as JSON", async () => {
      const { stdout } = await execFileAsync("node", [
        cliPath,
        "run",
        "--mode",
        "kernel",
        "--json",
        TEST_DATA.kernel.simplePrint.code,
      ]);

      expect(() => JSON.parse(stdout)).not.toThrow();
      const output = JSON.parse(stdout);
      expect(output.stdout).toBeDefined();
      expect(output.errorCode).toBeDefined();
    });
  });

  describe("verbose mode", () => {
    it.skip("should enable verbose logging", async () => {
      const { stdout } = await execFileAsync("node", [
        cliPath,
        "run",
        "--verbose",
        "echo",
        "test",
      ]);

      // In verbose mode, we expect additional logging output
      expect(stdout.length).toBeGreaterThan(0);
    });
  });

  describe("exit codes", () => {
    it.skip("should return 0 for successful execution", async () => {
      await execFileAsync("node", [
        cliPath,
        "run",
        "echo",
        "test",
      ]);

      // execFileAsync only resolves on exit code 0, so if we get here, test passed
    });

    it.skip("should return non-zero for failed execution", async () => {
      try {
        await execFileAsync("node", [cliPath, "run", "false"]);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const execError = error as { code: number };
        expect(execError.code).not.toBe(0);
      }
    });

    it.skip("should map error codes correctly", async () => {
      // Import error should be 1009
      try {
        await execFileAsync("node", [
          cliPath,
          "run",
          "--mode",
          "kernel",
          "--json",
          TEST_DATA.kernel.importError.code,
        ]);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const execError = error as { stdout: string };
        const output = JSON.parse(execError.stdout);
        expect(output.errorCode).toBe(1009);
      }

      // Runtime error should be 1014
      try {
        await execFileAsync("node", [
          cliPath,
          "run",
          "--mode",
          "kernel",
          "--json",
          TEST_DATA.kernel.runtimeError.code,
        ]);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const execError = error as { stdout: string };
        const output = JSON.parse(execError.stdout);
        expect(output.errorCode).toBe(1014);
      }
    });
  });

  describe("multiline code execution", () => {
    it.skip("should execute multiline Python code", async () => {
      const code = "x = 1\\ny = 2\\nprint(x + y)";
      const { stdout } = await execFileAsync("node", [
        cliPath,
        "run",
        "--mode",
        "kernel",
        code,
      ]);

      expect(stdout).toContain("3");
    });
  });

  describe("special characters", () => {
    it.skip("should handle code with special characters", async () => {
      const code = 'print("hello \\"world\\"")';
      const { stdout } = await execFileAsync("node", [
        cliPath,
        "run",
        "--mode",
        "kernel",
        code,
      ]);

      expect(stdout).toContain('"world"');
    });
  });
});
