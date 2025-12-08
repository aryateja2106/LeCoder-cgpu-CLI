import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AssignedRuntime } from "../runtime/runtime-manager.js";
import { Variant } from "../colab/api.js";

/**
 * Schema for runtime proxy information
 */
const ProxySchema = z.object({
  url: z.string().url(),
  token: z.string(),
  tokenExpiresInSeconds: z.number(),
});

/**
 * Schema for assigned runtime details
 */
const AssignedRuntimeSchema = z.object({
  label: z.string(),
  accelerator: z.string(),
  endpoint: z.string(),
  proxy: ProxySchema,
});

/**
 * Schema for session metadata validation
 */
export const SessionMetadataSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  runtime: AssignedRuntimeSchema,
  variant: z.nativeEnum(Variant),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime(),
  isActive: z.boolean(),
});

export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

/**
 * Options for creating a new session
 */
export interface CreateSessionOptions {
  label: string;
  runtime: AssignedRuntime;
  variant: Variant;
}

/**
 * Manages persistent storage of Colab runtime sessions
 */
export class SessionStorage {
  private readonly sessionsFile: string;

  constructor(storageDir: string) {
    // storageDir already includes "state" (e.g., ~/.config/lecoder-cgpu/state)
    this.sessionsFile = path.join(storageDir, "sessions.json");
  }

  /**
   * Initialize storage directory and file if they don't exist
   */
  private async ensureStorage(): Promise<void> {
    const stateDir = path.dirname(this.sessionsFile);
    await fs.mkdir(stateDir, { recursive: true });

    try {
      await fs.access(this.sessionsFile);
    } catch {
      // File doesn't exist, create with empty array directly (don't call writeSessionsAtomic to avoid recursion)
      const tempFile = `${this.sessionsFile}.tmp`;
      await fs.writeFile(tempFile, "[]", "utf-8");
      await fs.rename(tempFile, this.sessionsFile);
    }
  }

  /**
   * Read all sessions from storage
   */
  private async readSessions(): Promise<SessionMetadata[]> {
    await this.ensureStorage();

    try {
      const content = await fs.readFile(this.sessionsFile, "utf-8");
      const data = JSON.parse(content);

      if (!Array.isArray(data)) {
        throw new TypeError("Invalid sessions file format: expected array");
      }

      // Validate each session
      return data.map((item) => SessionMetadataSchema.parse(item));
    } catch (error) {
      if (error instanceof SyntaxError) {
        // Corrupted JSON, reset to empty array
        await this.writeSessionsAtomic([]);
        return [];
      }
      throw error;
    }
  }

  /**
   * Write sessions to storage atomically (write to temp file, then rename)
   */
  private async writeSessionsAtomic(sessions: SessionMetadata[]): Promise<void> {
    await this.ensureStorage();

    const tempFile = `${this.sessionsFile}.tmp`;
    const content = JSON.stringify(sessions, null, 2);

    await fs.writeFile(tempFile, content, "utf-8");
    await fs.rename(tempFile, this.sessionsFile);
  }

  /**
   * List all sessions sorted by lastUsedAt descending
   */
  async list(): Promise<SessionMetadata[]> {
    const sessions = await this.readSessions();
    return sessions.sort((a, b) => 
      new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
    );
  }

  /**
   * Get a specific session by ID (supports full UUID or partial prefix)
   */
  async get(id: string): Promise<SessionMetadata | undefined> {
    const sessions = await this.readSessions();
    
    // First try exact match
    const exactMatch = sessions.find((s) => s.id === id);
    if (exactMatch) {
      return exactMatch;
    }

    // Try prefix match (only if id is at least 4 chars to avoid too much ambiguity)
    if (id.length >= 4) {
      const matches = sessions.filter((s) => s.id.startsWith(id));
      if (matches.length === 1) {
        return matches[0];
      }
      if (matches.length > 1) {
        const matchIds = matches.map(s => s.id.substring(0, 8)).join(", ");
        throw new Error(`Ambiguous session ID "${id}". Matches: ${matchIds}`);
      }
    }

    return undefined;
  }

  /**
   * Get the currently active session
   */
  async getActive(): Promise<SessionMetadata | undefined> {
    const sessions = await this.readSessions();
    return sessions.find((s) => s.isActive);
  }

  /**
   * Execute an operation with an exclusive lock
   */
  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockFile = `${this.sessionsFile}.lock`;
    // Try for 5 seconds (100ms * 50)
    let retries = 50;
    
    while (retries > 0) {
      let fileHandle;
      try {
        // Try to create lock file exclusively
        fileHandle = await fs.open(lockFile, "wx");
        await fileHandle.close();
        
        // Lock acquired, execute operation
        try {
          return await operation();
        } finally {
          // Release lock
          await fs.unlink(lockFile).catch(() => {});
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          // Locked by another process, wait and retry
          await new Promise((resolve) => setTimeout(resolve, 100));
          retries--;
          continue;
        }
        throw error;
      }
    }
    throw new Error("Could not acquire session lock: Operation timed out");
  }

  /**
   * Add a new session and set it as active
   */
  async add(options: CreateSessionOptions): Promise<SessionMetadata> {
    return this.withLock(async () => {
      const sessions = await this.readSessions();
      const now = new Date().toISOString();

      const newSession: SessionMetadata = {
        id: crypto.randomUUID(),
        label: options.label,
        runtime: options.runtime,
        variant: options.variant,
        createdAt: now,
        lastUsedAt: now,
        isActive: true,
      };

      // Deactivate all other sessions
      const updatedSessions = sessions.map((s) => ({ ...s, isActive: false }));
      updatedSessions.push(newSession);

      await this.writeSessionsAtomic(updatedSessions);
      return newSession;
    });
  }

  /**
   * Update a session with partial fields
   */
  async update(id: string, partial: Partial<Omit<SessionMetadata, "id">>): Promise<SessionMetadata> {
    return this.withLock(async () => {
      const sessions = await this.readSessions();
      const index = sessions.findIndex((s) => s.id === id);

      if (index === -1) {
        throw new Error(`Session not found: ${id}`);
      }

      const updated = { ...sessions[index], ...partial };
      sessions[index] = updated;

      await this.writeSessionsAtomic(sessions);
      return updated;
    });
  }

  /**
   * Remove a session by ID
   */
  async remove(id: string): Promise<void> {
    return this.withLock(async () => {
      const sessions = await this.readSessions();
      const filtered = sessions.filter((s) => s.id !== id);

      if (filtered.length === sessions.length) {
        throw new Error(`Session not found: ${id}`);
      }

      const removedSession = sessions.find((s) => s.id === id);

      // If removed session was active, promote the most recently used remaining session
      if (removedSession?.isActive && filtered.length > 0) {
        const mostRecent = filtered.reduce((latest, current) => {
          return new Date(current.lastUsedAt).getTime() > new Date(latest.lastUsedAt).getTime()
            ? current
            : latest;
        });
        
        // Manually activate most recent within this lock context
        const mostRecentIndex = filtered.findIndex(s => s.id === mostRecent.id);
        if (mostRecentIndex !== -1) {
            filtered[mostRecentIndex].isActive = true;
        }
      }

      await this.writeSessionsAtomic(filtered);
    });
  }

  /**
   * Set a session as active, deactivating all others
   */
  async setActive(id: string): Promise<SessionMetadata> {
    return this.withLock(async () => {
      const sessions = await this.readSessions();
      const targetSession = sessions.find((s) => s.id === id);

      if (!targetSession) {
        throw new Error(`Session not found: ${id}`);
      }

      const updated = sessions.map((s) => ({
        ...s,
        isActive: s.id === id,
      }));

      await this.writeSessionsAtomic(updated);
      return { ...targetSession, isActive: true };
    });
  }

  /**
   * Clear all sessions
   */
  async clear(): Promise<void> {
    return this.withLock(async () => {
      await this.writeSessionsAtomic([]);
    });
  }

  /**
   * Get count of sessions
   */
  async count(): Promise<number> {
    const sessions = await this.readSessions();
    return sessions.length;
  }
}
