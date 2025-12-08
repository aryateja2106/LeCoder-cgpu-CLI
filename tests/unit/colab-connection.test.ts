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
      on: vi.fn(),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
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
});
