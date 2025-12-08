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
        return undefined;
      }
      
      return session;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw err;
    }
  }

  async storeSession(session: StoredSession): Promise<void> {
    await fs.writeFile(this.sessionFile, JSON.stringify(session, null, 2), "utf-8");
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
