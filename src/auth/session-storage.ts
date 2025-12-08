import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { REQUIRED_SCOPES } from "./constants.js";

const SessionSchema = z.object({
  id: z.string(),
  refreshToken: z.string(),
  scopes: z.array(z.string()),
  account: z.object({
    id: z.string(),
    label: z.string(),
  }),
});

/**
 * Validate that stored session contains all required scopes.
 * Returns true if all required scopes are present in stored scopes.
 */
function validateScopes(stored: string[], required: readonly string[]): boolean {
  return required.every((scope) => stored.includes(scope));
}

export type StoredSession = z.infer<typeof SessionSchema>;

export class FileAuthStorage {
  private readonly sessionFile: string;
  private lastInvalidScopeLogKey?: string;

  constructor(stateDir: string) {
    this.sessionFile = path.join(stateDir, "session.json");
  }

  async getSession(): Promise<StoredSession | undefined> {
    try {
      const raw = await fs.readFile(this.sessionFile, "utf-8");
      const session = SessionSchema.parse(JSON.parse(raw));
      
      // Validate that session has all required scopes
      if (!validateScopes(session.scopes, REQUIRED_SCOPES)) {
        // Scope mismatch - force re-authentication
        const invalidSessionKey = `${session.id}:${[...session.scopes].sort().join(",")}`;
        if (this.lastInvalidScopeLogKey !== invalidSessionKey) {
          console.warn("Existing credentials are missing Drive access; please re-authenticate.");
          this.lastInvalidScopeLogKey = invalidSessionKey;
        }
        return undefined;
      }
      
      this.lastInvalidScopeLogKey = undefined;
      return session;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw err;
    }
  }

  async storeSession(session: StoredSession): Promise<void> {
    // Write session file with restrictive permissions (0o600) to protect sensitive tokens
    // This ensures only the file owner can read/write the session file
    await fs.writeFile(
      this.sessionFile,
      JSON.stringify(session, null, 2),
      { encoding: "utf-8", mode: 0o600 }
    );
    
    // Ensure permissions are set correctly even if umask interfered
    await fs.chmod(this.sessionFile, 0o600);
  }

  async removeSession(): Promise<void> {
    try {
      await fs.unlink(this.sessionFile);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }
}
