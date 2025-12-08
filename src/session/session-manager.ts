import type { ColabClient } from "../colab/client.js";
import { Variant } from "../colab/api.js";
import type { RuntimeManager } from "../runtime/runtime-manager.js";
import type { ConnectionPool } from "../jupyter/connection-pool.js";
import type { SessionStorage, SessionMetadata } from "./session-storage.js";
import { getFileLogger } from "../utils/file-logger.js";

/**
 * Options for creating a new session
 */
export interface CreateSessionParams {
  variant: Variant;
  forceNew?: boolean;
  label?: string;
}

export interface GetOrCreateSessionParams extends Partial<CreateSessionParams> {
  /**
   * When true and a targeted session is stale/unreachable, create a fresh session instead of throwing.
   */
  allowStaleRecovery?: boolean;
}

/**
 * Enriched session information with live status
 */
export interface EnrichedSession extends SessionMetadata {
  status: "active" | "connected" | "idle" | "unreachable" | "stale";
  kernelState?: string;
  connectionCount?: number;
}

/**
 * Session statistics
 */
export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  connectedSessions: number;
  staleSessions: number;
  maxSessions: number;
  tier: "free" | "pro";
}

/**
 * Manages Colab runtime sessions with persistence and connection tracking
 */
export class SessionManager {
  private readonly storage: SessionStorage;
  private readonly runtimeManager: RuntimeManager;
  private readonly colabClient: ColabClient;
  private readonly connectionPool: ConnectionPool;

  constructor(
    storage: SessionStorage,
    runtimeManager: RuntimeManager,
    colabClient: ColabClient,
    connectionPool: ConnectionPool,
  ) {
    this.storage = storage;
    this.runtimeManager = runtimeManager;
    this.colabClient = colabClient;
    this.connectionPool = connectionPool;
  }

  /**
   * Create a new session by assigning a runtime
   */
  async createSession(params: CreateSessionParams): Promise<SessionMetadata> {
    const logger = getFileLogger();
    logger?.debug("SESSION", "Creating new session", { variant: params.variant, forceNew: params.forceNew });
    
    // Check session limits
    await this.enforceSessionLimits();

    const runtime = await this.runtimeManager.assignRuntime({
      forceNew: params.forceNew ?? false,
      variant: params.variant,
      quiet: false,
    });

    const label = params.label ?? `Colab ${params.variant.toUpperCase()} ${runtime.accelerator}`;

    const session = await this.storage.add({
      label,
      runtime,
      variant: params.variant,
    });

    logger?.logSession("create", session.id, { label, variant: params.variant, accelerator: runtime.accelerator });

    return session;
  }

  /**
   * Get or create a session based on session ID
   * If sessionId is provided, validates and returns that session
   * If no sessionId, returns active session or creates new one
   */
  async getOrCreateSession(sessionId?: string, params?: GetOrCreateSessionParams): Promise<SessionMetadata> {
    if (sessionId) {
      // Retrieve specific session
      const session = await this.storage.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      // Validate runtime connectivity
      try {
        await this.refreshSessionRuntime(session);
        // Update last used time
        await this.storage.update(session.id, {
          lastUsedAt: new Date().toISOString(),
        });
        return session;
      } catch {
        // Runtime no longer valid
        let removed = false;
        try {
          await this.storage.remove(session.id);
          removed = true;
        } catch {
          // Ignore removal errors
        }

        if (params?.allowStaleRecovery) {
          return this.createSession({
            variant: params.variant ?? session.variant,
            forceNew: true,
            label: params.label,
          });
        }

        const cleanupHint = removed
          ? "The stale session record was removed automatically. If issues persist, run 'lecoder-cgpu sessions clean' or 'lecoder-cgpu sessions close ${sessionId}' to remove stale sessions."
          : `Run 'lecoder-cgpu sessions clean' or 'lecoder-cgpu sessions close ${sessionId}' to remove stale sessions.`;
        throw new Error(
          `Session ${sessionId} runtime is unreachable or stale. ${cleanupHint} ` +
          "Re-run without --session to create a new session."
        );
      }
    }

    // No session ID provided, use active session or create new
    const activeSession = await this.storage.getActive();
    if (activeSession) {
      try {
        await this.refreshSessionRuntime(activeSession);
        await this.storage.update(activeSession.id, {
          lastUsedAt: new Date().toISOString(),
        });
        return activeSession;
      } catch {
        // Active session runtime is stale, create new
        await this.storage.remove(activeSession.id);
        return this.createSession({
          variant: params?.variant ?? Variant.GPU,
          forceNew: true,
          label: params?.label,
        });
      }
    }

    // No active session, create new
    return this.createSession({
      variant: params?.variant ?? Variant.GPU,
      forceNew: false,
      label: params?.label,
    });
  }

  /**
   * List all sessions with enriched status information
   */
  async listSessions(): Promise<EnrichedSession[]> {
    const sessions = await this.storage.list();
    
    // Return early if no sessions
    if (sessions.length === 0) {
      return [];
    }
    
    const assignments = await this.colabClient.listAssignments();

    const enriched: EnrichedSession[] = [];

    for (const session of sessions) {
      // Check if runtime is still assigned in Colab
      const isAssigned = assignments.some((a) => a.endpoint === session.runtime.endpoint);

      let status: EnrichedSession["status"] = "idle";
      let kernelState: string | undefined;
      let connectionCount: number | undefined;

      if (isAssigned) {
        // Check connection pool for active connections
        const connection = this.connectionPool.getConnection(session.runtime.endpoint);

        if (connection) {
          status = "connected";
          kernelState = connection.getState();
          connectionCount = 1; // Each runtime has at most one connection
        } else if (session.isActive) {
          status = "active";
        }
      } else {
        status = "stale";
      }

      enriched.push({
        ...session,
        status,
        kernelState,
        connectionCount,
      });
    }

    return enriched;
  }

  /**
   * Switch to a different session
   */
  async switchSession(id: string): Promise<SessionMetadata> {
    const logger = getFileLogger();
    const session = await this.storage.get(id);
    if (!session) {
      logger?.warn("SESSION", "Switch failed - session not found", { sessionId: id });
      throw new Error(`Session not found: ${id}`);
    }

    // Validate runtime is still accessible
    try {
      await this.resolveSessionRuntime(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error("SESSION", "Switch failed - runtime unreachable", error instanceof Error ? error : undefined, { sessionId: id });
      throw new Error(
        `Session ${id} runtime is unreachable: ${message}. Use 'lecoder-cgpu sessions clean' to remove stale sessions.`
      );
    }

    logger?.logSession("switch", id, { label: session.label });
    return this.storage.setActive(id);
  }

  /**
   * Remove a session and close associated connections
   */
  async removeSession(id: string): Promise<void> {
    const logger = getFileLogger();
    const session = await this.storage.get(id);
    if (!session) {
      logger?.warn("SESSION", "Remove failed - session not found", { sessionId: id });
      throw new Error(`Session not found: ${id}`);
    }

    // Close any active connections for this session
    try {
      const connection = this.connectionPool.getConnection(session.runtime.endpoint);
      if (connection) {
        await connection.shutdown();
      }
    } catch {
      // Ignore errors closing connection
    }

    await this.storage.remove(id);
    logger?.logSession("close", id, { label: session.label });
  }

  /**
   * Refresh a session's runtime proxy token and update lastUsedAt
   */
  async refreshSession(id: string): Promise<SessionMetadata> {
    const session = await this.storage.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    await this.refreshSessionRuntime(session);

    return this.storage.update(id, {
      lastUsedAt: new Date().toISOString(),
    });
  }

  /**
   * Clean stale sessions (runtimes no longer assigned)
   */
  async cleanStaleSessions(): Promise<string[]> {
    const sessions = await this.storage.list();
    const assignments = await this.colabClient.listAssignments();
    const removed: string[] = [];

    for (const session of sessions) {
      const isAssigned = assignments.some((a) => a.endpoint === session.runtime.endpoint);
      if (!isAssigned) {
        await this.removeSession(session.id);
        removed.push(session.id);
      }
    }

    return removed;
  }

  /**
   * Get session statistics
   */
  async getStats(): Promise<SessionStats> {
    const sessions = await this.storage.list();
    const poolStats = this.connectionPool.getStats();

    // If no sessions, return quick stats without API calls
    if (sessions.length === 0) {
      return {
        totalSessions: 0,
        activeSessions: 0,
        connectedSessions: 0,
        staleSessions: 0,
        maxSessions: poolStats.limit,
        tier: poolStats.limit === 1 ? "free" : "pro",
      };
    }

    const enriched = await this.listSessions();

    const staleSessions = enriched.filter((s) => s.status === "stale").length;
    const connectedSessions = enriched.filter((s) => s.status === "connected").length;
    const activeSessions = enriched.filter((s) => s.isActive).length;

    return {
      totalSessions: sessions.length,
      activeSessions,
      connectedSessions,
      staleSessions,
      maxSessions: poolStats.limit,
      tier: poolStats.limit === 1 ? "free" : "pro",
    };
  }

  /**
   * Validate session runtime is still assigned and refresh proxy token
   */
  private async refreshSessionRuntime(session: SessionMetadata): Promise<void> {
    try {
      const proxy = await this.colabClient.refreshConnection(session.runtime.endpoint);
      
      // Update session with new proxy token
      await this.storage.update(session.id, {
        runtime: {
          ...session.runtime,
          proxy,
        },
      });
    } catch (error) {
      throw new Error(`Failed to refresh runtime for session ${session.id}: ${error}`);
    }
  }

  /**
   * Verify session runtime is still assigned in Colab
   */
  private async resolveSessionRuntime(session: SessionMetadata): Promise<void> {
    const assignments = await this.colabClient.listAssignments();
    const isAssigned = assignments.some((a) => a.endpoint === session.runtime.endpoint);

    if (!isAssigned) {
      throw new Error(`Runtime endpoint ${session.runtime.endpoint} is no longer assigned`);
    }

    // Refresh proxy token
    await this.refreshSessionRuntime(session);
  }

  /**
   * Enforce session limits based on subscription tier
   */
  private async enforceSessionLimits(): Promise<void> {
    const stats = await this.getStats();
    
    // Check limits against active or connected sessions, ignoring stale ones
    const liveSessions = stats.activeSessions + stats.connectedSessions;
    
    // We compare against maxSessions, which is derived from connection pool limit.
    // Note: connectedSessions are a subset of active sessions if we considered 'active' purely as 'in use',
    // but here 'active' means 'selected as current context' and 'connected' means 'has active WebSocket'.
    // A session can be connected but not the currently selected one in CLI.
    // However, listSessions logic is: if connected -> status='connected', else if isActive -> status='active'.
    // So these sets are disjoint in stats counts.
    
    if (liveSessions >= stats.maxSessions) {
      throw new Error(
        `Session limit reached (${stats.maxSessions} active/connected sessions for ${stats.tier} tier). ` +
        `Close existing sessions with:\n` +
        `  lecoder-cgpu sessions\n` +
        `  lecoder-cgpu sessions close <id>\n` +
        (stats.tier === "free" 
          ? `Or upgrade to Colab Pro for up to 5 concurrent sessions.`
          : ``)
      );
    }
  }
}
