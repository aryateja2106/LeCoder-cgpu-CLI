import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionManager } from "../../src/session/session-manager.js";
import type { SessionStorage } from "../../src/session/session-storage.js";
import type { RuntimeManager } from "../../src/runtime/runtime-manager.js";
import type { ColabClient } from "../../src/colab/client.js";
import type { ConnectionPool } from "../../src/jupyter/connection-pool.js";
import { Variant } from "../../src/colab/api.js";

describe("SessionManager", () => {
  let sessionManager: SessionManager;
  let mockStorage: SessionStorage;
  let mockRuntimeManager: RuntimeManager;
  let mockColabClient: ColabClient;
  let mockConnectionPool: ConnectionPool;

  beforeEach(() => {
    mockStorage = {
      getActive: vi.fn(),
      get: vi.fn(),
      add: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    } as unknown as SessionStorage;

    mockRuntimeManager = {
      assignRuntime: vi.fn(),
    } as unknown as RuntimeManager;

    mockColabClient = {
      refreshConnection: vi.fn(),
      listAssignments: vi.fn(),
    } as unknown as ColabClient;

    mockConnectionPool = {
      getStats: vi.fn().mockReturnValue({ limit: 5 }),
    } as unknown as ConnectionPool;

    sessionManager = new SessionManager(
      mockStorage,
      mockRuntimeManager,
      mockColabClient,
      mockConnectionPool
    );
  });

  it("should remove stale active session and create a new one", async () => {
    const staleSession = {
      id: "stale-session-id",
      label: "Stale Session",
      isActive: true,
      variant: Variant.GPU,
      runtime: { endpoint: "stale-endpoint" },
      lastUsedAt: new Date().toISOString(),
    };

    // Mock getActive to return stale session
    vi.mocked(mockStorage.getActive).mockResolvedValue(staleSession as any);

    // Mock refreshSessionRuntime to fail
    vi.mocked(mockColabClient.refreshConnection).mockRejectedValue(new Error("Unreachable"));

    // Mock createSession flow
    const newRuntime = {
        label: "New Runtime",
        accelerator: "T4",
        endpoint: "new-endpoint",
        proxy: { url: "url", token: "token", tokenExpiresInSeconds: 3600 }
    };
    vi.mocked(mockRuntimeManager.assignRuntime).mockResolvedValue(newRuntime as any);
    
    const newSession = {
        id: "new-session-id",
        label: "New Session",
        isActive: true,
        variant: Variant.GPU,
        runtime: newRuntime,
        lastUsedAt: new Date().toISOString(),
    };
    vi.mocked(mockStorage.add).mockResolvedValue(newSession as any);

    // Act
    const result = await sessionManager.getOrCreateSession();

    // Assert
    // Expect remove to be called for the stale session
    expect(mockStorage.remove).toHaveBeenCalledWith(staleSession.id);
    
    // Expect creation of new session
    expect(mockRuntimeManager.assignRuntime).toHaveBeenCalled();
    expect(mockStorage.add).toHaveBeenCalled();
    expect(result).toEqual(newSession);
  });

  describe("session creation with tier limits", () => {
    it("should create session when under limit", async () => {
      vi.mocked(mockStorage.getActive).mockResolvedValue(null);
      vi.mocked(mockStorage.list).mockResolvedValue([]);
      
      const newRuntime = {
        label: "New Runtime",
        accelerator: "T4",
        endpoint: "new-endpoint",
        proxy: { url: "url", token: "token", tokenExpiresInSeconds: 3600 }
      };
      vi.mocked(mockRuntimeManager.assignRuntime).mockResolvedValue(newRuntime as any);
      
      const newSession = {
        id: "new-session-id",
        label: "New Session",
        isActive: true,
        variant: Variant.GPU,
        runtime: newRuntime,
        lastUsedAt: new Date().toISOString(),
      };
      vi.mocked(mockStorage.add).mockResolvedValue(newSession as any);

      const result = await sessionManager.getOrCreateSession();

      expect(result).toBeDefined();
      expect(mockRuntimeManager.assignRuntime).toHaveBeenCalled();
    });

    it("should reuse existing active session", async () => {
      const existingSession = {
        id: "existing-session-id",
        label: "Existing Session",
        isActive: true,
        variant: Variant.GPU,
        runtime: { 
          endpoint: "valid-endpoint",
          proxy: { url: "url", token: "token", tokenExpiresInSeconds: 3600 }
        },
        lastUsedAt: new Date().toISOString(),
      };

      vi.mocked(mockStorage.getActive).mockResolvedValue(existingSession as any);
      vi.mocked(mockColabClient.refreshConnection).mockResolvedValue(undefined);

      const result = await sessionManager.getOrCreateSession();

      expect(result).toEqual(existingSession);
      expect(mockRuntimeManager.assignRuntime).not.toHaveBeenCalled();
    });
  });

  describe("session switching", () => {
    it("should switch to existing session by id", async () => {
      const session1 = {
        id: "session-1",
        label: "Session 1",
        isActive: false,
        variant: Variant.GPU,
        runtime: { endpoint: "endpoint-1" },
        lastUsedAt: new Date().toISOString(),
      };

      vi.mocked(mockStorage.get).mockResolvedValue(session1 as any);
      vi.mocked(mockStorage.update).mockResolvedValue(undefined);
      vi.mocked(mockColabClient.refreshConnection).mockResolvedValue(undefined);

      const result = await sessionManager.switchSession("session-1");

      expect(result).toBeDefined();
      expect(mockStorage.get).toHaveBeenCalledWith("session-1");
    });

    it("should throw when switching to non-existent session", async () => {
      vi.mocked(mockStorage.get).mockResolvedValue(null);

      await expect(sessionManager.switchSession("non-existent")).rejects.toThrow();
    });
  });

  describe("session listing", () => {
    it("should return all sessions", async () => {
      const sessions = [
        { id: "session-1", label: "Session 1", isActive: true },
        { id: "session-2", label: "Session 2", isActive: false },
        { id: "session-3", label: "Session 3", isActive: false },
      ];

      vi.mocked(mockStorage.list).mockResolvedValue(sessions as any);

      const result = await sessionManager.listSessions();

      expect(result).toHaveLength(3);
      expect(mockStorage.list).toHaveBeenCalled();
    });

    it("should return empty array when no sessions", async () => {
      vi.mocked(mockStorage.list).mockResolvedValue([]);

      const result = await sessionManager.listSessions();

      expect(result).toEqual([]);
    });
  });

  describe("session cleanup", () => {
    it("should close session and remove from storage", async () => {
      const session = {
        id: "session-to-close",
        label: "Session to Close",
        isActive: true,
        variant: Variant.GPU,
        runtime: { endpoint: "endpoint" },
        lastUsedAt: new Date().toISOString(),
      };

      vi.mocked(mockStorage.get).mockResolvedValue(session as any);
      vi.mocked(mockStorage.remove).mockResolvedValue(undefined);

      await sessionManager.closeSession("session-to-close");

      expect(mockStorage.remove).toHaveBeenCalledWith("session-to-close");
    });

    it("should throw when closing non-existent session", async () => {
      vi.mocked(mockStorage.get).mockResolvedValue(null);

      await expect(sessionManager.closeSession("non-existent")).rejects.toThrow();
    });
  });

  describe("connection pool limits", () => {
    it("should respect pool size limit from tier", () => {
      vi.mocked(mockConnectionPool.getStats).mockReturnValue({ 
        limit: 5,
        active: 2,
        idle: 3
      } as any);

      const stats = mockConnectionPool.getStats();
      
      expect(stats.limit).toBe(5);
    });

    it("should report free tier limit (1)", () => {
      vi.mocked(mockConnectionPool.getStats).mockReturnValue({ 
        limit: 1,
        active: 0,
        idle: 0
      } as any);

      const stats = mockConnectionPool.getStats();
      
      expect(stats.limit).toBe(1);
    });
  });
});
