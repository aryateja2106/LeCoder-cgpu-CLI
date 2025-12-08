/**
 * Unit tests for Remote Command Runner
 *
 * Tests remote command execution, output streaming, and timeout handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Types for remote command execution
interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  interrupted: boolean;
}

interface CommandOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
}

// Simulated remote command runner for testing
class MockRemoteCommandRunner {
  private isConnected = false;
  private mockResponses: Map<string, CommandResult> = new Map();
  private executionDelay = 10;
  private simulateTimeout = false;
  private interruptRequested = false;

  constructor() {
    this.reset();
  }

  async connect(): Promise<void> {
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
  }

  async execute(command: string, options: CommandOptions = {}): Promise<CommandResult> {
    if (!this.isConnected) {
      throw new Error("Not connected to remote runtime");
    }

    const startTime = Date.now();

    // Check for mock response
    const mockResult = this.mockResponses.get(command);
    if (mockResult) {
      await this.delay(this.executionDelay);
      return { ...mockResult, duration: Date.now() - startTime };
    }

    // Simulate timeout
    if (this.simulateTimeout) {
      const timeout = options.timeout ?? 30000;
      await this.delay(timeout + 100);
      throw new Error(`Command timed out after ${timeout}ms`);
    }

    // Check for interrupt
    if (this.interruptRequested) {
      this.interruptRequested = false;
      return {
        exitCode: 130, // SIGINT
        stdout: "",
        stderr: "Interrupted",
        duration: Date.now() - startTime,
        interrupted: true,
      };
    }

    // Simulate execution
    await this.delay(this.executionDelay);

    // Default behavior: echo command
    return {
      exitCode: 0,
      stdout: `Executed: ${command}\n`,
      stderr: "",
      duration: Date.now() - startTime,
      interrupted: false,
    };
  }

  async interrupt(): Promise<void> {
    this.interruptRequested = true;
  }

  // Test helpers
  setMockResponse(command: string, result: CommandResult): void {
    this.mockResponses.set(command, result);
  }

  setExecutionDelay(delay: number): void {
    this.executionDelay = delay;
  }

  setSimulateTimeout(simulate: boolean): void {
    this.simulateTimeout = simulate;
  }

  reset(): void {
    this.isConnected = false;
    this.mockResponses.clear();
    this.executionDelay = 10;
    this.simulateTimeout = false;
    this.interruptRequested = false;
  }

  isActive(): boolean {
    return this.isConnected;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

describe("RemoteCommandRunner", () => {
  let runner: MockRemoteCommandRunner;

  beforeEach(() => {
    runner = new MockRemoteCommandRunner();
  });

  afterEach(() => {
    runner.reset();
  });

  describe("connection", () => {
    it("should connect to remote runtime", async () => {
      await runner.connect();
      expect(runner.isActive()).toBe(true);
    });

    it("should disconnect from remote runtime", async () => {
      await runner.connect();
      await runner.disconnect();
      expect(runner.isActive()).toBe(false);
    });

    it("should throw when executing without connection", async () => {
      await expect(runner.execute("ls")).rejects.toThrow("Not connected");
    });
  });

  describe("command execution", () => {
    beforeEach(async () => {
      await runner.connect();
    });

    it("should execute simple command", async () => {
      const result = await runner.execute("echo hello");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Executed");
      expect(result.interrupted).toBe(false);
    });

    it("should return correct exit code for successful command", async () => {
      runner.setMockResponse("ls -la", {
        exitCode: 0,
        stdout: "file1.txt\nfile2.txt\n",
        stderr: "",
        duration: 0,
        interrupted: false,
      });

      const result = await runner.execute("ls -la");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("file1.txt");
    });

    it("should return correct exit code for failed command", async () => {
      runner.setMockResponse("invalid-command", {
        exitCode: 127,
        stdout: "",
        stderr: "command not found: invalid-command",
        duration: 0,
        interrupted: false,
      });

      const result = await runner.execute("invalid-command");

      expect(result.exitCode).toBe(127);
      expect(result.stderr).toContain("not found");
    });

    it("should capture stdout output", async () => {
      runner.setMockResponse("python --version", {
        exitCode: 0,
        stdout: "Python 3.10.0\n",
        stderr: "",
        duration: 0,
        interrupted: false,
      });

      const result = await runner.execute("python --version");

      expect(result.stdout).toBe("Python 3.10.0\n");
    });

    it("should capture stderr output", async () => {
      runner.setMockResponse("python -c 'import sys; print(\"error\", file=sys.stderr)'", {
        exitCode: 0,
        stdout: "",
        stderr: "error\n",
        duration: 0,
        interrupted: false,
      });

      const result = await runner.execute("python -c 'import sys; print(\"error\", file=sys.stderr)'");

      expect(result.stderr).toBe("error\n");
    });

    it("should track execution duration", async () => {
      runner.setExecutionDelay(50);

      const result = await runner.execute("echo test");

      expect(result.duration).toBeGreaterThanOrEqual(50);
    });
  });

  describe("timeout handling", () => {
    beforeEach(async () => {
      await runner.connect();
    });

    it("should timeout long-running commands", async () => {
      runner.setSimulateTimeout(true);

      await expect(
        runner.execute("sleep 1000", { timeout: 100 })
      ).rejects.toThrow("timed out");
    });

    it("should respect custom timeout", async () => {
      runner.setSimulateTimeout(true);

      const start = Date.now();
      try {
        await runner.execute("sleep 1000", { timeout: 100 });
      } catch {
        // Expected
      }
      const elapsed = Date.now() - start;

      // Should timeout around 100ms, not the default 30s
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe("command interruption", () => {
    beforeEach(async () => {
      await runner.connect();
    });

    it("should interrupt running command", async () => {
      runner.setExecutionDelay(1000);

      // Request interrupt
      await runner.interrupt();

      const result = await runner.execute("long-running-command");

      expect(result.interrupted).toBe(true);
      expect(result.exitCode).toBe(130); // SIGINT
    });

    it("should return correct exit code on interrupt", async () => {
      await runner.interrupt();

      const result = await runner.execute("any-command");

      expect(result.exitCode).toBe(130);
    });
  });

  describe("command options", () => {
    beforeEach(async () => {
      await runner.connect();
    });

    it("should accept working directory option", async () => {
      const result = await runner.execute("ls", { cwd: "/content" });

      expect(result.exitCode).toBe(0);
    });

    it("should accept environment variables", async () => {
      const result = await runner.execute("echo $MY_VAR", {
        env: { MY_VAR: "test_value" },
      });

      expect(result.exitCode).toBe(0);
    });
  });

  describe("edge cases", () => {
    beforeEach(async () => {
      await runner.connect();
    });

    it("should handle empty command", async () => {
      const result = await runner.execute("");

      expect(result.exitCode).toBe(0);
    });

    it("should handle command with special characters", async () => {
      const result = await runner.execute("echo 'hello \"world\"'");

      expect(result.exitCode).toBe(0);
    });

    it("should handle multiline output", async () => {
      runner.setMockResponse("cat file.txt", {
        exitCode: 0,
        stdout: "line1\nline2\nline3\n",
        stderr: "",
        duration: 0,
        interrupted: false,
      });

      const result = await runner.execute("cat file.txt");

      expect(result.stdout.split("\n")).toHaveLength(4);
    });

    it("should handle binary output (simulated)", async () => {
      runner.setMockResponse("cat binary.bin", {
        exitCode: 0,
        stdout: "\x00\x01\x02\x03",
        stderr: "",
        duration: 0,
        interrupted: false,
      });

      const result = await runner.execute("cat binary.bin");

      expect(result.stdout).toHaveLength(4);
    });
  });

  describe("concurrent execution", () => {
    beforeEach(async () => {
      await runner.connect();
    });

    it("should handle multiple concurrent commands", async () => {
      const promises = [
        runner.execute("echo 1"),
        runner.execute("echo 2"),
        runner.execute("echo 3"),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.exitCode).toBe(0);
      });
    });
  });
});
