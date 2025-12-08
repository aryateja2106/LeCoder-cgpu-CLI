import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ConnectionPool,
} from "../../src/jupyter/connection-pool.js";
import { ConnectionState } from "../../src/jupyter/colab-connection.js";
import type { AssignedRuntime } from "../../src/runtime/runtime-manager.js";
import type { ColabClient } from "../../src/colab/client.js";

// Mock ColabConnection
vi.mock("../../src/jupyter/colab-connection.js", async () => {
  const actual = await vi.importActual("../../src/jupyter/colab-connection.js") as any;
  return {
    ...actual,
    ColabConnection: vi.fn().mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockReturnValue(actual.ConnectionState.CONNECTED),
      getKernelClient: vi.fn().mockResolvedValue({
        getKernelInfo: vi.fn().mockResolvedValue({}),
        connected: true,
      }),
      connected: true,
      on: vi.fn(),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
    })),
  };
});

describe("ConnectionPool", () => {
  let pool: ConnectionPool;
  let mockRuntime: AssignedRuntime;
  let mockColabClient: ColabClient;

  beforeEach(() => {
    // Reset singleton for each test
    ConnectionPool.resetInstance();

    mockRuntime = {
      label: "Colab GPU T4",
      accelerator: "T4",
      endpoint: "test-endpoint-1",
      proxy: {
        url: "https://example.com",
        token: "test-token",
        tokenExpiresInSeconds: 3600,
      },
    };

    mockColabClient = {} as ColabClient;

    pool = ConnectionPool.getInstance();
  });

  afterEach(() => {
    ConnectionPool.resetInstance();
    vi.clearAllMocks();
  });

  describe("getInstance", () => {
    it("should return singleton instance", () => {
      const instance1 = ConnectionPool.getInstance();
      const instance2 = ConnectionPool.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe("resetInstance", () => {
    it("should reset the singleton", async () => {
      const instance1 = ConnectionPool.getInstance();
      await instance1.getOrCreateConnection(mockRuntime, mockColabClient);

      ConnectionPool.resetInstance();

      const instance2 = ConnectionPool.getInstance();
      expect(instance1).not.toBe(instance2);
      expect(instance2.listConnections()).toHaveLength(0);
    });
  });

  describe("getOrCreateConnection", () => {
    it("should create a new connection", async () => {
      const connection = await pool.getOrCreateConnection(
        mockRuntime,
        mockColabClient
      );

      expect(connection).toBeDefined();
      expect(pool.listConnections()).toHaveLength(1);
    });

    it("should reuse existing connection for same endpoint", async () => {
      const connection1 = await pool.getOrCreateConnection(
        mockRuntime,
        mockColabClient
      );
      const connection2 = await pool.getOrCreateConnection(
        mockRuntime,
        mockColabClient
      );

      expect(connection1).toBe(connection2);
      expect(pool.listConnections()).toHaveLength(1);
    });

    it("should create separate connections for different endpoints with pro tier", async () => {
      // Need pro tier to have more than 1 connection
      pool.setSubscriptionTier(1); // PRO tier

      const runtime2: AssignedRuntime = {
        ...mockRuntime,
        endpoint: "test-endpoint-2",
      };

      const connection1 = await pool.getOrCreateConnection(
        mockRuntime,
        mockColabClient
      );
      const connection2 = await pool.getOrCreateConnection(
        runtime2,
        mockColabClient
      );

      expect(connection1).not.toBe(connection2);
      expect(pool.listConnections()).toHaveLength(2);
    });
  });

  describe("listConnections", () => {
    it("should return empty array when no connections", () => {
      expect(pool.listConnections()).toHaveLength(0);
    });

    it("should return all connections", async () => {
      await pool.getOrCreateConnection(mockRuntime, mockColabClient);

      const connections = pool.listConnections();
      expect(connections).toHaveLength(1);
    });
  });

  describe("getConnection", () => {
    it("should return connection by endpoint", async () => {
      await pool.getOrCreateConnection(mockRuntime, mockColabClient);

      const connection = pool.getConnection("test-endpoint-1");
      expect(connection).toBeDefined();
    });

    it("should return undefined for unknown endpoint", () => {
      const connection = pool.getConnection("unknown-endpoint");
      expect(connection).toBeUndefined();
    });
  });

  describe("closeConnection", () => {
    it("should close and remove connection", async () => {
      await pool.getOrCreateConnection(mockRuntime, mockColabClient);
      expect(pool.listConnections()).toHaveLength(1);

      await pool.closeConnection("test-endpoint-1");
      expect(pool.listConnections()).toHaveLength(0);
    });

    it("should handle closing non-existent connection", async () => {
      await expect(
        pool.closeConnection("non-existent")
      ).resolves.not.toThrow();
    });
  });

  describe("closeAll", () => {
    it("should close all connections", async () => {
      // Need pro tier to have more than 1 connection
      pool.setSubscriptionTier(1); // PRO tier

      await pool.getOrCreateConnection(mockRuntime, mockColabClient);

      const runtime2: AssignedRuntime = {
        ...mockRuntime,
        endpoint: "test-endpoint-2",
      };
      await pool.getOrCreateConnection(runtime2, mockColabClient);

      expect(pool.listConnections()).toHaveLength(2);

      await pool.closeAll();
      expect(pool.listConnections()).toHaveLength(0);
    });
  });

  describe("getStats", () => {
    it("should return correct stats for empty pool", () => {
      const stats = pool.getStats();

      expect(stats.total).toBe(0);
      expect(stats.connected).toBe(0);
      expect(stats.reconnecting).toBe(0);
      expect(stats.failed).toBe(0);
    });

    it("should return correct stats with connections", async () => {
      await pool.getOrCreateConnection(mockRuntime, mockColabClient);

      const stats = pool.getStats();

      expect(stats.total).toBe(1);
      expect(stats.connected).toBe(1);
    });
  });

  describe("setSubscriptionTier", () => {
    it("should update connection limit based on tier", async () => {
      // Free tier should have limit of 1
      pool.setSubscriptionTier(0);
      const stats1 = pool.getStats();
      expect(stats1.limit).toBe(1);

      // Pro tier should have limit of 5
      pool.setSubscriptionTier(1);
      const stats2 = pool.getStats();
      expect(stats2.limit).toBe(5);
    });
  });

  describe("connection limits", () => {
    it("should throw when free tier limit is exceeded", async () => {
      pool.setSubscriptionTier(0); // Free tier, limit of 1

      await pool.getOrCreateConnection(mockRuntime, mockColabClient);

      const runtime2: AssignedRuntime = {
        ...mockRuntime,
        endpoint: "test-endpoint-2",
      };

      await expect(
        pool.getOrCreateConnection(runtime2, mockColabClient)
      ).rejects.toThrow("Connection limit reached");
    });
  });
});
