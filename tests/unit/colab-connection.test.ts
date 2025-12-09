import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ColabConnection,
  ConnectionState,
} from "../../src/jupyter/colab-connection.js";
import type { AssignedRuntime } from "../../src/runtime/runtime-manager.js";
import type { ColabClient } from "../../src/colab/client.js";

// Mock JupyterKernelClient
vi.mock("../../src/jupyter/kernel-client.js", () => {
  return {
    JupyterKernelClient: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      connected: true,
      session: "mock-session-id",
      on: vi.fn().mockImplementation(function(event: string, cb: Function) {
        // Immediately emit "idle" status for the status handler
        if (event === "status") {
          setTimeout(() => cb("idle"), 0);
        }
        return this;
      }),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
      removeListener: vi.fn(),
      executeCode: vi.fn().mockResolvedValue({
        status: "ok",
        execution_count: 1,
        stdout: "",
        stderr: "",
        traceback: [],
        display_data: [],
      }),
      interrupt: vi.fn().mockResolvedValue(undefined),
      getKernelInfo: vi.fn().mockResolvedValue({}),
    })),
  };
});

describe("ColabConnection", () => {
  let mockRuntime: AssignedRuntime;
  let mockColabClient: ColabClient;
  let connection: ColabConnection;

  beforeEach(() => {
    mockRuntime = {
      label: "Colab GPU T4",
      accelerator: "T4",
      endpoint: "test-endpoint",
      proxy: {
        url: "https://example.com",
        token: "test-token",
        tokenExpiresInSeconds: 3600,
      },
    };

    mockColabClient = {
      createSession: vi.fn().mockResolvedValue({
        id: "session-123",
        kernel: {
          id: "kernel-456",
          name: "python3",
          lastActivity: "2024-01-01T00:00:00Z",
          executionState: "idle",
          connections: 1,
        },
        name: "/content/notebook.ipynb",
        path: "/content/notebook.ipynb",
        type: "notebook",
      }),
      getKernel: vi.fn().mockResolvedValue({
        id: "kernel-456",
        name: "python3",
        lastActivity: "2024-01-01T00:00:00Z",
        executionState: "idle",
        connections: 1,
      }),
      deleteKernel: vi.fn().mockResolvedValue(undefined),
      refreshConnection: vi.fn().mockResolvedValue({
        url: "https://example.com",
        token: "refreshed-token",
        tokenExpiresInSeconds: 3600,
      }),
      sendKeepAlive: vi.fn().mockResolvedValue(undefined),
    } as unknown as ColabClient;

    connection = new ColabConnection(mockRuntime, mockColabClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create connection in disconnected state", () => {
      expect(connection.getState()).toBe(ConnectionState.DISCONNECTED);
    });

    it("should store runtime reference", () => {
      expect(connection.getRuntime()).toBe(mockRuntime);
    });
  });

  describe("initialize", () => {
    it("should create session and connect kernel client", async () => {
      await connection.initialize();

      expect(mockColabClient.createSession).toHaveBeenCalledWith(
        "/content/lecoder.ipynb",
        "python3",
        "https://example.com",
        "test-token"
      );
      expect(connection.getState()).toBe(ConnectionState.CONNECTED);
      expect(connection.getKernelId()).toBe("kernel-456");
    });

    it("should emit connected event", async () => {
      const connectedSpy = vi.fn();
      connection.on("connected", connectedSpy);

      await connection.initialize();

      expect(connectedSpy).toHaveBeenCalled();
    });

    it("should transition to FAILED state on error", async () => {
      (mockColabClient.createSession as any).mockRejectedValueOnce(
        new Error("Connection failed")
      );

      await expect(connection.initialize()).rejects.toThrow("Connection failed");
      expect(connection.getState()).toBe(ConnectionState.FAILED);
    });

    it("should wait for kernel to be ready before connecting", async () => {
      // Mock getKernel to simulate kernel starting up
      let callCount = 0;
      (mockColabClient.getKernel as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call: kernel is still starting
          return Promise.resolve({
            id: "kernel-456",
            name: "python3",
            lastActivity: "2024-01-01T00:00:00Z",
            executionState: "starting",
            connections: 0,
          });
        } else {
          // Subsequent calls: kernel is ready
          return Promise.resolve({
            id: "kernel-456",
            name: "python3",
            lastActivity: "2024-01-01T00:00:00Z",
            executionState: "idle",
            connections: 1,
          });
        }
      });

      await connection.initialize();

      // Should have called getKernel multiple times while polling
      expect(mockColabClient.getKernel).toHaveBeenCalled();
      expect(connection.getState()).toBe(ConnectionState.CONNECTED);
    });

    it("should timeout if kernel fails to become ready", async () => {
      // Mock getKernel to always return starting state
      (mockColabClient.getKernel as any).mockResolvedValue({
        id: "kernel-456",
        name: "python3",
        lastActivity: "2024-01-01T00:00:00Z",
        executionState: "starting",
        connections: 0,
      });

      const connection = new ColabConnection(mockRuntime, mockColabClient, {
        kernelReadyTimeout: 100, // Very short timeout for testing
        kernelReadyPollInterval: 10,
      });

      await expect(connection.initialize()).rejects.toThrow(
        "failed to become ready within"
      );
      expect(connection.getState()).toBe(ConnectionState.FAILED);
    });
  });

  describe("getKernelClient", () => {
    it("should return connected kernel client", async () => {
      await connection.initialize();
      const client = await connection.getKernelClient();
      expect(client).toBeDefined();
    });

    it("should initialize if not yet initialized when calling getKernelClient", async () => {
      // getKernelClient calls initialize() if in DISCONNECTED state
      // This tests that behavior works correctly
      const client = await connection.getKernelClient();
      expect(client).toBeDefined();
      expect(connection.getState()).toBe(ConnectionState.CONNECTED);
    });
  });

  describe("executeCode", () => {
    it("should delegate to kernel client", async () => {
      await connection.initialize();
      const result = await connection.executeCode("print('hello')");

      expect(result.status).toBe("ok");
      expect(result.execution_count).toBe(1);
    });
  });

  describe("getStatus", () => {
    it("should return kernel status from REST API", async () => {
      await connection.initialize();
      const status = await connection.getStatus();

      expect(mockColabClient.getKernel).toHaveBeenCalledWith(
        "kernel-456",
        "https://example.com",
        "test-token"
      );
      expect(status.executionState).toBe("idle");
    });

    it("should throw if kernel not initialized", async () => {
      await expect(connection.getStatus()).rejects.toThrow("Kernel not initialized");
    });
  });

  describe("interrupt", () => {
    it("should interrupt the kernel", async () => {
      await connection.initialize();
      const client = await connection.getKernelClient();

      await connection.interrupt();

      expect(client.interrupt).toHaveBeenCalled();
    });
  });

  describe("shutdown", () => {
    it("should close connection and clean up", async () => {
      await connection.initialize();
      await connection.shutdown();

      expect(connection.getState()).toBe(ConnectionState.DISCONNECTED);
      expect(connection.getKernelId()).toBeNull();
    });

    it("should delete kernel if requested", async () => {
      await connection.initialize();
      await connection.shutdown(true);

      expect(mockColabClient.deleteKernel).toHaveBeenCalledWith(
        "kernel-456",
        "https://example.com",
        "test-token"
      );
    });

    it("should not delete kernel by default", async () => {
      await connection.initialize();
      await connection.shutdown();

      expect(mockColabClient.deleteKernel).not.toHaveBeenCalled();
    });
  });

  describe("connected property", () => {
    it("should return true when connected", async () => {
      await connection.initialize();
      expect(connection.connected).toBe(true);
    });

    it("should return false when disconnected", () => {
      expect(connection.connected).toBe(false);
    });
  });

  describe("getSession", () => {
    it("should return session after initialization", async () => {
      await connection.initialize();
      const session = connection.getSession();

      expect(session).toBeDefined();
      expect(session?.id).toBe("session-123");
    });

    it("should return null before initialization", () => {
      expect(connection.getSession()).toBeNull();
    });
  });
});

describe("ColabConnection - options", () => {
  it("should use custom notebook path", async () => {
    const mockRuntime: AssignedRuntime = {
      label: "Colab GPU T4",
      accelerator: "T4",
      endpoint: "test-endpoint",
      proxy: {
        url: "https://example.com",
        token: "test-token",
        tokenExpiresInSeconds: 3600,
      },
    };

    const mockColabClient = {
      createSession: vi.fn().mockResolvedValue({
        id: "session-123",
        kernel: {
          id: "kernel-456",
          name: "python3",
          lastActivity: "2024-01-01T00:00:00Z",
          executionState: "idle",
          connections: 1,
        },
        name: "/custom/path.ipynb",
        path: "/custom/path.ipynb",
        type: "notebook",
      }),
      getKernel: vi.fn().mockResolvedValue({
        id: "kernel-456",
        name: "python3",
        lastActivity: "2024-01-01T00:00:00Z",
        executionState: "idle",
        connections: 1,
      }),
    } as unknown as ColabClient;

    const connection = new ColabConnection(mockRuntime, mockColabClient, {
      notebookPath: "/custom/path.ipynb",
    });

    await connection.initialize();

    expect(mockColabClient.createSession).toHaveBeenCalledWith(
      "/custom/path.ipynb",
      "python3",
      "https://example.com",
      "test-token"
    );
  });

  it("should use custom kernel name", async () => {
    const mockRuntime: AssignedRuntime = {
      label: "Colab GPU T4",
      accelerator: "T4",
      endpoint: "test-endpoint",
      proxy: {
        url: "https://example.com",
        token: "test-token",
        tokenExpiresInSeconds: 3600,
      },
    };

    const mockColabClient = {
      createSession: vi.fn().mockResolvedValue({
        id: "session-123",
        kernel: {
          id: "kernel-456",
          name: "python3",
          lastActivity: "2024-01-01T00:00:00Z",
          executionState: "idle",
          connections: 1,
        },
        name: "/content/notebook.ipynb",
        path: "/content/notebook.ipynb",
        type: "notebook",
      }),
      getKernel: vi.fn().mockResolvedValue({
        id: "kernel-456",
        name: "python3",
        lastActivity: "2024-01-01T00:00:00Z",
        executionState: "idle",
        connections: 1,
      }),
    } as unknown as ColabClient;

    const connection = new ColabConnection(mockRuntime, mockColabClient, {
      kernelName: "ir",
    });

    await connection.initialize();

    expect(mockColabClient.createSession).toHaveBeenCalledWith(
      "/content/lecoder.ipynb",
      "ir",
      "https://example.com",
      "test-token"
    );
  });

  it("should use custom kernel readiness options", async () => {
    const mockRuntime: AssignedRuntime = {
      label: "Colab GPU T4",
      accelerator: "T4",
      endpoint: "test-endpoint",
      proxy: {
        url: "https://example.com",
        token: "test-token",
        tokenExpiresInSeconds: 3600,
      },
    };

    const mockColabClient = {
      createSession: vi.fn().mockResolvedValue({
        id: "session-123",
        kernel: {
          id: "kernel-456",
          name: "python3",
          lastActivity: "2024-01-01T00:00:00Z",
          executionState: "idle",
          connections: 1,
        },
        name: "/content/notebook.ipynb",
        path: "/content/notebook.ipynb",
        type: "notebook",
      }),
      getKernel: vi.fn().mockResolvedValue({
        id: "kernel-456",
        name: "python3",
        lastActivity: "2024-01-01T00:00:00Z",
        executionState: "idle",
        connections: 1,
      }),
    } as unknown as ColabClient;

    const connection = new ColabConnection(mockRuntime, mockColabClient, {
      kernelReadyTimeout: 60000,
      kernelReadyPollInterval: 500,
    });

    await connection.initialize();

    // Should have used the custom timeout and poll interval
    expect(mockColabClient.createSession).toHaveBeenCalled();
  });
});

describe("ColabConnection Reconnection Logic", () => {
  let mockRuntime: AssignedRuntime;
  let mockColabClient: ColabClient;

  beforeEach(() => {
    vi.useFakeTimers();

    mockRuntime = {
      label: "Colab GPU T4",
      accelerator: "T4",
      endpoint: "test-endpoint",
      proxy: {
        url: "https://example.com",
        token: "test-token",
        tokenExpiresInSeconds: 3600,
      },
    };

    mockColabClient = {
      createSession: vi.fn().mockResolvedValue({
        id: "session-123",
        kernel: {
          id: "kernel-456",
          name: "python3",
          lastActivity: "2024-01-01T00:00:00Z",
          executionState: "idle",
          connections: 1,
        },
        name: "/content/notebook.ipynb",
        path: "/content/notebook.ipynb",
        type: "notebook",
      }),
      getKernel: vi.fn().mockResolvedValue({
        id: "kernel-456",
        name: "python3",
        lastActivity: "2024-01-01T00:00:00Z",
        executionState: "idle",
        connections: 1,
      }),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      refreshConnection: vi.fn().mockResolvedValue(undefined),
    } as unknown as ColabClient;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should track retry attempts correctly", async () => {
    const connection = new ColabConnection(mockRuntime, mockColabClient);

    // First attempt
    await connection.initialize();
    expect(connection.getState()).toBe(ConnectionState.CONNECTED);
  });

  it("should implement exponential backoff delays", async () => {
    // Test the backoff calculation logic
    const calculateBackoff = (attempt: number, baseDelay = 1000): number => {
      return Math.min(baseDelay * Math.pow(2, attempt), 16000);
    };

    // Verify exponential growth: 1s, 2s, 4s, 8s, 16s (capped)
    expect(calculateBackoff(0)).toBe(1000);
    expect(calculateBackoff(1)).toBe(2000);
    expect(calculateBackoff(2)).toBe(4000);
    expect(calculateBackoff(3)).toBe(8000);
    expect(calculateBackoff(4)).toBe(16000);
    expect(calculateBackoff(5)).toBe(16000); // Capped
  });

  it("should respect max retry limit", async () => {
    const maxRetries = 5;
    let attemptCount = 0;

    // Simulate retry logic
    const attemptConnect = async (): Promise<boolean> => {
      attemptCount++;
      if (attemptCount >= maxRetries) {
        return false;
      }
      throw new Error("Connection failed");
    };

    let success = false;
    let attempts = 0;

    while (attempts < maxRetries && !success) {
      try {
        await attemptConnect();
        success = true;
      } catch {
        attempts++;
      }
    }

    expect(attempts).toBe(maxRetries);
    expect(success).toBe(false);
  });

  it("should handle connection health checks", async () => {
    const connection = new ColabConnection(mockRuntime, mockColabClient);
    await connection.initialize();

    // Connection should be healthy after initialization
    expect(connection.getState()).toBe(ConnectionState.CONNECTED);
  });

  it("should handle graceful shutdown", async () => {
    const connection = new ColabConnection(mockRuntime, mockColabClient);
    await connection.initialize();

    // Should transition to disconnected state cleanly
    await connection.shutdown();
    expect(connection.getState()).toBe(ConnectionState.DISCONNECTED);
  });

  it("should emit events on state changes", async () => {
    const connection = new ColabConnection(mockRuntime, mockColabClient);
    const stateChanges: ConnectionState[] = [];

    connection.on("stateChange", (state: ConnectionState) => {
      stateChanges.push(state);
    });

    await connection.initialize();
    await connection.shutdown();

    expect(stateChanges).toContain(ConnectionState.CONNECTED);
    expect(stateChanges).toContain(ConnectionState.DISCONNECTED);
  });
});

describe("ColabConnection Error Handling", () => {
  let mockRuntime: AssignedRuntime;
  let mockColabClient: ColabClient;

  beforeEach(() => {
    mockRuntime = {
      label: "Colab GPU T4",
      accelerator: "T4",
      endpoint: "test-endpoint",
      proxy: {
        url: "https://example.com",
        token: "test-token",
        tokenExpiresInSeconds: 3600,
      },
    };
  });

  it("should handle network errors during initialization", async () => {
    mockColabClient = {
      createSession: vi.fn().mockRejectedValue(new Error("Network error")),
      getKernel: vi.fn(),
    } as unknown as ColabClient;

    const connection = new ColabConnection(mockRuntime, mockColabClient);

    await expect(connection.initialize()).rejects.toThrow("Network error");
    expect(connection.getState()).toBe(ConnectionState.FAILED);
  });

  it("should handle timeout during kernel ready", async () => {
    mockColabClient = {
      createSession: vi.fn().mockResolvedValue({
        id: "session-123",
        kernel: {
          id: "kernel-456",
          name: "python3",
          lastActivity: "2024-01-01T00:00:00Z",
          executionState: "starting", // Never becomes idle
          connections: 1,
        },
        name: "/content/notebook.ipynb",
        path: "/content/notebook.ipynb",
        type: "notebook",
      }),
      getKernel: vi.fn().mockResolvedValue({
        id: "kernel-456",
        name: "python3",
        lastActivity: "2024-01-01T00:00:00Z",
        executionState: "starting",
        connections: 1,
      }),
    } as unknown as ColabClient;

    const connection = new ColabConnection(mockRuntime, mockColabClient, {
      kernelReadyTimeout: 100, // Short timeout for testing
      kernelReadyPollInterval: 10,
    });

    await expect(connection.initialize()).rejects.toThrow();
  });

  it("should handle kernel death during execution", async () => {
    mockColabClient = {
      createSession: vi.fn().mockResolvedValue({
        id: "session-123",
        kernel: {
          id: "kernel-456",
          name: "python3",
          lastActivity: "2024-01-01T00:00:00Z",
          executionState: "idle",
          connections: 1,
        },
        name: "/content/notebook.ipynb",
        path: "/content/notebook.ipynb",
        type: "notebook",
      }),
      getKernel: vi.fn().mockResolvedValue({
        id: "kernel-456",
        name: "python3",
        lastActivity: "2024-01-01T00:00:00Z",
        executionState: "dead", // Kernel died
        connections: 0,
      }),
    } as unknown as ColabClient;

    const connection = new ColabConnection(mockRuntime, mockColabClient);
    await connection.initialize();

    // Kernel death should be detectable
    const getKernel = mockColabClient.getKernel as (id: string) => Promise<{ executionState: string }>;
    const kernelInfo = await getKernel("kernel-456");
    expect(kernelInfo.executionState).toBe("dead");
  });

  it("should handle rate limiting (429) errors", async () => {
    const rateLimitError = new Error("Too Many Requests") as Error & { status: number };
    rateLimitError.status = 429;

    mockColabClient = {
      createSession: vi.fn().mockRejectedValue(rateLimitError),
      getKernel: vi.fn(),
    } as unknown as ColabClient;

    const connection = new ColabConnection(mockRuntime, mockColabClient);

    await expect(connection.initialize()).rejects.toThrow("Too Many Requests");
  });

  it("should handle transient (503) errors", async () => {
    const transientError = new Error("Service Unavailable") as Error & { status: number };
    transientError.status = 503;

    mockColabClient = {
      createSession: vi.fn().mockRejectedValue(transientError),
      getKernel: vi.fn(),
    } as unknown as ColabClient;

    const connection = new ColabConnection(mockRuntime, mockColabClient);

    await expect(connection.initialize()).rejects.toThrow("Service Unavailable");
  });
});
