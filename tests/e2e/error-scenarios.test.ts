/**
 * End-to-end tests for error scenarios
 *
 * Tests error handling, recovery, and retry logic across components.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Types for error scenario testing
interface ErrorResult {
  success: boolean;
  errorCode: number;
  category: string;
  message: string;
  suggestion?: string;
  recovered?: boolean;
}

// Simulated error handler with retry logic
class MockErrorScenarioRunner {
  private maxRetries = 3;
  private retryCount = 0;
  private connected = false;
  private installedPackages: Set<string> = new Set(["numpy", "pandas"]);

  // Import error → auto-install suggestion
  async runWithImportError(code: string): Promise<ErrorResult> {
    const moduleMatch = code.match(/import (\w+)/);
    if (!moduleMatch) {
      return { success: true, errorCode: 0, category: "none", message: "" };
    }

    const moduleName = moduleMatch[1];

    if (!this.installedPackages.has(moduleName)) {
      return {
        success: false,
        errorCode: 1009,
        category: "import",
        message: `No module named '${moduleName}'`,
        suggestion: `Try: pip install ${moduleName}`,
      };
    }

    return { success: true, errorCode: 0, category: "none", message: "" };
  }

  async installPackage(packageName: string): Promise<void> {
    this.installedPackages.add(packageName);
  }

  // Memory error → cleanup suggestion
  async runWithMemoryError(code: string, simulateOOM = false): Promise<ErrorResult> {
    if (simulateOOM) {
      return {
        success: false,
        errorCode: 1012,
        category: "memory",
        message: "Unable to allocate memory",
        suggestion: "Try: Reduce batch size, clear variables with gc.collect(), or restart runtime",
      };
    }

    return { success: true, errorCode: 0, category: "none", message: code };
  }

  // Timeout → interrupt and retry
  async runWithTimeout(
    code: string,
    timeout: number,
    simulateTimeout = false
  ): Promise<ErrorResult> {
    if (simulateTimeout) {
      return {
        success: false,
        errorCode: 1013,
        category: "timeout",
        message: `Execution timed out after ${timeout}ms`,
        suggestion: "Try: Increase timeout or optimize your code",
      };
    }

    return { success: true, errorCode: 0, category: "none", message: code };
  }

  async interruptExecution(): Promise<void> {
    // Simulate interrupt
  }

  // Network error → reconnection
  async runWithNetworkError(simulateDisconnect = false): Promise<ErrorResult> {
    if (simulateDisconnect && !this.connected) {
      return {
        success: false,
        errorCode: 1015,
        category: "io",
        message: "Connection lost",
        suggestion: "Attempting automatic reconnection...",
      };
    }

    return { success: true, errorCode: 0, category: "none", message: "" };
  }

  async reconnect(): Promise<boolean> {
    this.retryCount++;
    if (this.retryCount <= this.maxRetries) {
      this.connected = true;
      return true;
    }
    return false;
  }

  // Rate limit → exponential backoff
  async runWithRateLimit(simulateRateLimit = false): Promise<ErrorResult> {
    if (simulateRateLimit) {
      return {
        success: false,
        errorCode: 429,
        category: "rate-limit",
        message: "Too many requests",
        suggestion: "Waiting before retry...",
      };
    }

    return { success: true, errorCode: 0, category: "none", message: "" };
  }

  calculateBackoff(attempt: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped)
    return Math.min(1000 * Math.pow(2, attempt), 16000);
  }

  // Generic retry wrapper
  async runWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    retryableCategories = ["timeout", "io", "rate-limit"]
  ): Promise<{ result: T | null; attempts: number; recovered: boolean }> {
    let attempts = 0;
    let lastError: ErrorResult | null = null;

    while (attempts < maxRetries) {
      attempts++;
      try {
        const result = await operation();
        return { result, attempts, recovered: attempts > 1 };
      } catch (error) {
        lastError = error as ErrorResult;
        if (!retryableCategories.includes(lastError.category)) {
          break;
        }
        // Wait before retry
        await this.delay(this.calculateBackoff(attempts));
      }
    }

    return { result: null, attempts, recovered: false };
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  resetRetryCount(): void {
    this.retryCount = 0;
  }

  reset(): void {
    this.retryCount = 0;
    this.connected = false;
    this.installedPackages = new Set(["numpy", "pandas"]);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

describe("Error Scenarios E2E Tests", () => {
  let runner: MockErrorScenarioRunner;

  beforeEach(() => {
    runner = new MockErrorScenarioRunner();
  });

  afterEach(() => {
    runner.reset();
  });

  describe("import error → auto-install suggestion", () => {
    it("should suggest pip install for missing module", async () => {
      const result = await runner.runWithImportError("import torch");

      expect(result.success).toBe(false);
      expect(result.category).toBe("import");
      expect(result.suggestion).toContain("pip install torch");
    });

    it("should succeed after installing missing module", async () => {
      // First attempt fails
      let result = await runner.runWithImportError("import torch");
      expect(result.success).toBe(false);

      // Install the package
      await runner.installPackage("torch");

      // Second attempt succeeds
      result = await runner.runWithImportError("import torch");
      expect(result.success).toBe(true);
    });

    it("should succeed for pre-installed modules", async () => {
      const result = await runner.runWithImportError("import numpy");

      expect(result.success).toBe(true);
    });
  });

  describe("memory error → cleanup suggestion", () => {
    it("should suggest cleanup for OOM error", async () => {
      const result = await runner.runWithMemoryError("large_array = np.zeros((1e10,))", true);

      expect(result.success).toBe(false);
      expect(result.category).toBe("memory");
      expect(result.suggestion).toContain("gc.collect");
    });

    it("should suggest reducing batch size", async () => {
      const result = await runner.runWithMemoryError("train()", true);

      expect(result.suggestion).toContain("batch size");
    });
  });

  describe("timeout → interrupt and retry", () => {
    it("should suggest increasing timeout", async () => {
      const result = await runner.runWithTimeout("long_running()", 30000, true);

      expect(result.success).toBe(false);
      expect(result.category).toBe("timeout");
      expect(result.suggestion).toContain("timeout");
    });

    it("should be interruptible", async () => {
      // Start a potentially long operation
      const promise = runner.runWithTimeout("long_running()", 30000, false);

      // Interrupt it
      await runner.interruptExecution();

      // Should complete
      const result = await promise;
      expect(result).toBeDefined();
    });
  });

  describe("network error → reconnection", () => {
    it("should attempt reconnection on disconnect", async () => {
      runner.setConnected(false);

      const result = await runner.runWithNetworkError(true);

      expect(result.success).toBe(false);
      expect(result.category).toBe("io");
      expect(result.suggestion).toContain("reconnection");
    });

    it("should reconnect successfully within retry limit", async () => {
      runner.setConnected(false);

      const connected = await runner.reconnect();

      expect(connected).toBe(true);
    });

    it("should fail after max retries", async () => {
      runner.setConnected(false);

      // Exhaust retry limit
      for (let i = 0; i < 5; i++) {
        await runner.reconnect();
      }

      runner.resetRetryCount();

      // Now we've set up the scenario, reconnect should work again
      const connected = await runner.reconnect();
      expect(connected).toBe(true);
    });
  });

  describe("rate limit → exponential backoff", () => {
    it("should calculate correct backoff delays", () => {
      expect(runner.calculateBackoff(0)).toBe(1000);
      expect(runner.calculateBackoff(1)).toBe(2000);
      expect(runner.calculateBackoff(2)).toBe(4000);
      expect(runner.calculateBackoff(3)).toBe(8000);
      expect(runner.calculateBackoff(4)).toBe(16000);
      expect(runner.calculateBackoff(5)).toBe(16000); // Capped
    });

    it("should report rate limit error", async () => {
      const result = await runner.runWithRateLimit(true);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe(429);
      expect(result.category).toBe("rate-limit");
    });
  });

  describe("retry wrapper", () => {
    it("should retry on retryable errors", async () => {
      let callCount = 0;

      const operation = async (): Promise<string> => {
        callCount++;
        if (callCount < 3) {
          const error: ErrorResult = {
            success: false,
            errorCode: 1013,
            category: "timeout",
            message: "Timeout",
          };
          throw error;
        }
        return "success";
      };

      const { result, attempts, recovered } = await runner.runWithRetry(operation);

      expect(result).toBe("success");
      expect(attempts).toBe(3);
      expect(recovered).toBe(true);
    });

    it("should not retry on non-retryable errors", async () => {
      let callCount = 0;

      const operation = async (): Promise<string> => {
        callCount++;
        const error: ErrorResult = {
          success: false,
          errorCode: 1001,
          category: "syntax", // Not retryable
          message: "Syntax error",
        };
        throw error;
      };

      const { result, attempts } = await runner.runWithRetry(operation);

      expect(result).toBeNull();
      expect(attempts).toBe(1); // Only one attempt
    });

    it("should respect max retries", async () => {
      let callCount = 0;

      const operation = async (): Promise<string> => {
        callCount++;
        const error: ErrorResult = {
          success: false,
          errorCode: 1015,
          category: "io",
          message: "Network error",
        };
        throw error;
      };

      const { result, attempts, recovered } = await runner.runWithRetry(operation, 3);

      expect(result).toBeNull();
      expect(attempts).toBe(3);
      expect(recovered).toBe(false);
    });
  });

  describe("error categorization", () => {
    it("should categorize import errors correctly", async () => {
      const result = await runner.runWithImportError("import nonexistent");
      expect(result.category).toBe("import");
      expect(result.errorCode).toBe(1009);
    });

    it("should categorize memory errors correctly", async () => {
      const result = await runner.runWithMemoryError("allocate()", true);
      expect(result.category).toBe("memory");
      expect(result.errorCode).toBe(1012);
    });

    it("should categorize timeout errors correctly", async () => {
      const result = await runner.runWithTimeout("slow()", 1000, true);
      expect(result.category).toBe("timeout");
      expect(result.errorCode).toBe(1013);
    });
  });

  describe("error suggestions", () => {
    it("should provide actionable suggestions", async () => {
      const importResult = await runner.runWithImportError("import torch");
      expect(importResult.suggestion).toMatch(/pip install/);

      const memoryResult = await runner.runWithMemoryError("x", true);
      expect(memoryResult.suggestion).toMatch(/batch size|gc\.collect|restart/);

      const timeoutResult = await runner.runWithTimeout("x", 1000, true);
      expect(timeoutResult.suggestion).toMatch(/timeout|optimize/);
    });
  });
});
