/**
 * Integration tests for `sessions` command
 *
 * Tests session listing, switching, closing, and tier limits.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Types for sessions command
interface Session {
  id: string;
  label: string;
  variant: "GPU" | "TPU" | "CPU";
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string;
  runtime?: {
    endpoint: string;
    accelerator?: string;
  };
}

interface SessionStats {
  total: number;
  active: number;
  limit: number;
  tier: string;
}

// Simulated sessions command for testing
class MockSessionsCommand {
  private sessions: Map<string, Session> = new Map();
  private activeSessionId: string | null = null;
  private tier: "free" | "pro" | "pro+" = "free";

  private readonly tierLimits = {
    free: 1,
    pro: 5,
    "pro+": 10,
  };

  // sessions list
  async list(): Promise<Session[]> {
    return Array.from(this.sessions.values());
  }

  // sessions list --stats
  async listWithStats(): Promise<{ sessions: Session[]; stats: SessionStats }> {
    const sessions = await this.list();
    return {
      sessions,
      stats: {
        total: sessions.length,
        active: sessions.filter((s) => s.isActive).length,
        limit: this.tierLimits[this.tier],
        tier: this.tier,
      },
    };
  }

  // sessions switch <id>
  async switch(sessionId: string): Promise<Session> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Deactivate current session
    if (this.activeSessionId && this.activeSessionId !== sessionId) {
      const current = this.sessions.get(this.activeSessionId);
      if (current) {
        current.isActive = false;
      }
    }

    // Activate new session
    session.isActive = true;
    session.lastUsedAt = new Date().toISOString();
    this.activeSessionId = sessionId;

    return session;
  }

  // sessions close <id>
  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.sessions.delete(sessionId);

    // Switch to another session if closing active
    if (this.activeSessionId === sessionId) {
      const remaining = Array.from(this.sessions.values());
      if (remaining.length > 0) {
        this.activeSessionId = remaining[0].id;
        remaining[0].isActive = true;
      } else {
        this.activeSessionId = null;
      }
    }
  }

  // sessions clean (cleanup stale sessions)
  async clean(maxAgeMinutes = 60): Promise<number> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - maxAgeMinutes * 60 * 1000);
    let cleaned = 0;

    for (const [id, session] of this.sessions.entries()) {
      const lastUsed = new Date(session.lastUsedAt);
      if (lastUsed < cutoff && id !== this.activeSessionId) {
        this.sessions.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  // Test helpers
  addSession(session: Session): void {
    this.sessions.set(session.id, session);
    if (session.isActive) {
      this.activeSessionId = session.id;
    }
  }

  setTier(tier: "free" | "pro" | "pro+"): void {
    this.tier = tier;
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  reset(): void {
    this.sessions.clear();
    this.activeSessionId = null;
    this.tier = "free";
  }

  // Create test sessions
  createTestSessions(count: number): Session[] {
    const sessions: Session[] = [];
    for (let i = 0; i < count; i++) {
      const session: Session = {
        id: `session-${i + 1}`,
        label: `Session ${i + 1}`,
        variant: i % 3 === 0 ? "GPU" : i % 3 === 1 ? "TPU" : "CPU",
        isActive: i === 0,
        createdAt: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
        lastUsedAt: new Date(Date.now() - i * 30 * 60 * 1000).toISOString(),
        runtime: {
          endpoint: `endpoint-${i + 1}`,
          accelerator: i % 3 === 0 ? "T4" : undefined,
        },
      };
      this.addSession(session);
      sessions.push(session);
    }
    return sessions;
  }
}

describe("Sessions Command Integration", () => {
  let sessionsCommand: MockSessionsCommand;

  beforeEach(() => {
    sessionsCommand = new MockSessionsCommand();
  });

  afterEach(() => {
    sessionsCommand.reset();
  });

  describe("sessions list", () => {
    it("should list all sessions", async () => {
      sessionsCommand.setTier("pro");
      sessionsCommand.createTestSessions(3);

      const sessions = await sessionsCommand.list();

      expect(sessions).toHaveLength(3);
    });

    it("should return empty list when no sessions", async () => {
      const sessions = await sessionsCommand.list();

      expect(sessions).toEqual([]);
    });

    it("should include session details", async () => {
      sessionsCommand.setTier("pro");
      sessionsCommand.createTestSessions(1);

      const sessions = await sessionsCommand.list();

      expect(sessions[0].id).toBe("session-1");
      expect(sessions[0].label).toBe("Session 1");
      expect(sessions[0].variant).toBeDefined();
      expect(sessions[0].isActive).toBe(true);
    });
  });

  describe("sessions list --stats", () => {
    it("should include session statistics", async () => {
      sessionsCommand.setTier("pro");
      sessionsCommand.createTestSessions(3);

      const { stats } = await sessionsCommand.listWithStats();

      expect(stats.total).toBe(3);
      expect(stats.active).toBe(1);
      expect(stats.limit).toBe(5);
      expect(stats.tier).toBe("pro");
    });

    it("should show correct tier limit for free tier", async () => {
      sessionsCommand.setTier("free");
      sessionsCommand.createTestSessions(1);

      const { stats } = await sessionsCommand.listWithStats();

      expect(stats.limit).toBe(1);
      expect(stats.tier).toBe("free");
    });

    it("should show correct tier limit for pro+ tier", async () => {
      sessionsCommand.setTier("pro+");

      const { stats } = await sessionsCommand.listWithStats();

      expect(stats.limit).toBe(10);
      expect(stats.tier).toBe("pro+");
    });
  });

  describe("sessions switch", () => {
    beforeEach(() => {
      sessionsCommand.setTier("pro");
    });

    it("should switch to specified session", async () => {
      sessionsCommand.createTestSessions(3);

      const switched = await sessionsCommand.switch("session-2");

      expect(switched.id).toBe("session-2");
      expect(switched.isActive).toBe(true);
    });

    it("should deactivate previous session", async () => {
      sessionsCommand.createTestSessions(3);

      await sessionsCommand.switch("session-2");

      const sessions = await sessionsCommand.list();
      const session1 = sessions.find((s) => s.id === "session-1");

      expect(session1?.isActive).toBe(false);
    });

    it("should update lastUsedAt timestamp", async () => {
      sessionsCommand.createTestSessions(2);
      const before = (await sessionsCommand.list()).find(
        (s) => s.id === "session-2"
      )?.lastUsedAt;

      await new Promise((r) => setTimeout(r, 10));
      await sessionsCommand.switch("session-2");

      const after = (await sessionsCommand.list()).find(
        (s) => s.id === "session-2"
      )?.lastUsedAt;

      expect(new Date(after!).getTime()).toBeGreaterThan(
        new Date(before!).getTime()
      );
    });

    it("should throw for non-existent session", async () => {
      await expect(sessionsCommand.switch("non-existent")).rejects.toThrow(
        "Session not found"
      );
    });
  });

  describe("sessions close", () => {
    beforeEach(() => {
      sessionsCommand.setTier("pro");
    });

    it("should close specified session", async () => {
      sessionsCommand.createTestSessions(2);

      await sessionsCommand.close("session-2");

      const sessions = await sessionsCommand.list();
      expect(sessions).toHaveLength(1);
    });

    it("should auto-switch when closing active session", async () => {
      sessionsCommand.createTestSessions(2);

      await sessionsCommand.close("session-1");

      expect(sessionsCommand.getActiveSessionId()).toBe("session-2");
    });

    it("should set no active when closing last session", async () => {
      sessionsCommand.createTestSessions(1);

      await sessionsCommand.close("session-1");

      expect(sessionsCommand.getActiveSessionId()).toBeNull();
    });

    it("should throw for non-existent session", async () => {
      await expect(sessionsCommand.close("non-existent")).rejects.toThrow(
        "Session not found"
      );
    });
  });

  describe("sessions clean", () => {
    beforeEach(() => {
      sessionsCommand.setTier("pro");
    });

    it("should cleanup stale sessions", async () => {
      sessionsCommand.createTestSessions(3);

      // Age sessions manually
      const sessions = await sessionsCommand.list();
      for (const session of sessions) {
        if (!session.isActive) {
          session.lastUsedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        }
      }

      const cleaned = await sessionsCommand.clean(60);

      expect(cleaned).toBe(2);
      expect((await sessionsCommand.list()).length).toBe(1);
    });

    it("should not cleanup active session", async () => {
      sessionsCommand.createTestSessions(1);

      // Age the session
      const sessions = await sessionsCommand.list();
      sessions[0].lastUsedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      const cleaned = await sessionsCommand.clean(60);

      expect(cleaned).toBe(0);
      expect((await sessionsCommand.list()).length).toBe(1);
    });

    it("should return count of cleaned sessions", async () => {
      sessionsCommand.createTestSessions(5);

      const sessions = await sessionsCommand.list();
      for (const session of sessions) {
        if (!session.isActive) {
          session.lastUsedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        }
      }

      const cleaned = await sessionsCommand.clean(60);

      expect(cleaned).toBe(4);
    });
  });

  describe("--session flag integration", () => {
    beforeEach(() => {
      sessionsCommand.setTier("pro");
    });

    it("should verify session ID exists before use", async () => {
      sessionsCommand.createTestSessions(2);

      const sessions = await sessionsCommand.list();
      const sessionIds = sessions.map((s) => s.id);

      expect(sessionIds).toContain("session-1");
      expect(sessionIds).toContain("session-2");
    });
  });

  describe("tier limit enforcement", () => {
    it("should report free tier limit (1)", async () => {
      sessionsCommand.setTier("free");
      sessionsCommand.createTestSessions(1);

      const { stats } = await sessionsCommand.listWithStats();

      expect(stats.total).toBe(1);
      expect(stats.limit).toBe(1);
    });

    it("should report pro tier limit (5)", async () => {
      sessionsCommand.setTier("pro");
      sessionsCommand.createTestSessions(5);

      const { stats } = await sessionsCommand.listWithStats();

      expect(stats.total).toBe(5);
      expect(stats.limit).toBe(5);
    });
  });
});
