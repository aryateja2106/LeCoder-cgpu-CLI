/**
 * Sessions Command Handlers Module
 * 
 * This module provides handler functions for the `sessions` subcommands.
 * Sessions represent active Colab runtime connections stored locally.
 * 
 * ## Session Lifecycle
 * 
 * 1. **Created** - When `connect` or `run` creates a new runtime
 * 2. **Active** - The currently selected session for commands
 * 3. **Connected** - Has a live WebSocket connection
 * 4. **Stale** - No longer reachable, needs cleanup
 * 
 * ## Subcommands
 * 
 * - `sessions list` - Show all sessions with status
 * - `sessions switch <id>` - Change active session
 * - `sessions delete <id>` - Remove a session
 * - `sessions clean` - Remove stale sessions
 * 
 * @module commands/sessions-handlers
 */

import chalk from "chalk";
import type { SessionManager, EnrichedSession, SessionStats } from "../session/session-manager.js";

// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the sessions list command.
 */
export interface SessionsListOptions {
  /** Output as JSON */
  json?: boolean;
  /** Show statistics instead of list */
  stats?: boolean;
}

/**
 * Session status for display styling.
 */
export type SessionDisplayStatus = "connected" | "active" | "stale" | "unknown";

// ─────────────────────────────────────────────────────────────────────────────
// Statistics Display
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Display session statistics.
 * 
 * Shows:
 * - Total session count
 * - Active sessions
 * - Connected sessions
 * - Stale sessions
 * - Maximum allowed (tier-based limit)
 * 
 * @param sessionManager - The session manager
 * @param jsonMode - Output as JSON
 */
export async function displaySessionStats(
  sessionManager: SessionManager,
  jsonMode: boolean
): Promise<void> {
  const stats = await sessionManager.getStats();
  
  if (jsonMode) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  
  displaySessionStatsHuman(stats);
}

/**
 * Format and display session stats in human-readable format.
 * 
 * @param stats - The statistics to display
 */
function displaySessionStatsHuman(stats: SessionStats): void {
  console.log(chalk.bold("Session Statistics"));
  console.log(chalk.gray("─".repeat(50)));
  console.log(`Total sessions: ${stats.totalSessions}`);
  console.log(`${chalk.green("●")} Active: ${stats.activeSessions}`);
  console.log(`${chalk.blue("●")} Connected: ${stats.connectedSessions}`);
  console.log(`${chalk.red("●")} Stale: ${stats.staleSessions}`);
  console.log(`Max sessions: ${stats.maxSessions} (${stats.tier} tier)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Session List Display
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Display list of all sessions.
 * 
 * Each session shows:
 * - Short ID (first 8 characters)
 * - Label (user-friendly name)
 * - Variant (GPU/TPU/CPU) and accelerator type
 * - Status (connected, active, stale)
 * - Kernel state if available
 * - Creation and last used times
 * 
 * @param sessions - List of sessions to display
 * @param formatTime - Function to format relative time
 */
export function displaySessionList(
  sessions: EnrichedSession[],
  formatTime: (date: Date) => string
): void {
  if (sessions.length === 0) {
    console.log(chalk.gray("\nNo active sessions"));
    console.log(chalk.gray("Run 'lecoder-cgpu connect' to create a new session"));
    return;
  }
  
  console.log(chalk.bold(`\nActive Sessions (${sessions.length}):`));
  console.log(chalk.gray("─".repeat(100)));
  
  for (const sess of sessions) {
    displaySession(sess, formatTime);
  }
  
  const activeSession = sessions.find(s => s.isActive);
  if (activeSession) {
    console.log(chalk.gray(`Active session: ${activeSession.id.substring(0, 8)}`));
  }
}

/**
 * Display a single session's details.
 * 
 * @param session - The session to display
 * @param formatTime - Function to format relative time
 */
function displaySession(
  session: EnrichedSession,
  formatTime: (date: Date) => string
): void {
  const idShort = session.id.substring(0, 8);
  const activeMarker = session.isActive ? chalk.green("* ") : "  ";
  const statusColor = getStatusColor(session.status as SessionDisplayStatus);
  const createdAgo = formatTime(new Date(session.createdAt));
  const lastUsedAgo = formatTime(new Date(session.lastUsedAt));
  
  console.log(`${activeMarker}${chalk.bold(idShort)} ${session.label}`);
  console.log(`  Variant: ${session.variant.toUpperCase()} | Accelerator: ${session.runtime.accelerator}`);
  console.log(`  Status: ${statusColor(session.status.toUpperCase())}`);
  
  if (session.kernelState) {
    console.log(`  Kernel: ${session.kernelState}`);
  }
  
  console.log(`  Created: ${createdAgo} | Last used: ${lastUsedAgo}`);
  console.log("");
}

/**
 * Get the chalk color function for a session status.
 * 
 * @param status - The session status
 * @returns Chalk color function
 */
function getStatusColor(status: SessionDisplayStatus): typeof chalk.green {
  switch (status) {
    case "connected":
      return chalk.green;
    case "active":
      return chalk.blue;
    case "stale":
      return chalk.red;
    default:
      return chalk.gray;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find and validate a session by ID.
 * 
 * Supports both full UUIDs and short prefixes (minimum 4 characters).
 * Reports errors for:
 * - No matching sessions
 * - Ambiguous prefixes (multiple matches)
 * 
 * @param sessionManager - The session manager
 * @param sessionId - Full or partial session ID
 * @returns The session if found, or error information
 */
export async function findSession(
  sessionManager: SessionManager,
  sessionId: string
): Promise<{ session: EnrichedSession } | { error: string }> {
  const sessions = await sessionManager.listSessions();
  
  // Try exact match first
  const exactMatch = sessions.find(s => s.id === sessionId);
  if (exactMatch) {
    return { session: exactMatch };
  }
  
  // Try prefix match (minimum 4 characters for safety)
  if (sessionId.length >= 4) {
    const prefixMatches = sessions.filter(s => s.id.startsWith(sessionId));
    
    if (prefixMatches.length === 1) {
      return { session: prefixMatches[0] };
    }
    
    if (prefixMatches.length > 1) {
      const ids = prefixMatches.map(s => s.id.substring(0, 8)).join(", ");
      return { error: `Ambiguous session ID "${sessionId}". Matches: ${ids}` };
    }
  }
  
  return { error: `Session not found: ${sessionId}` };
}

/**
 * Switch to a different active session.
 * 
 * Updates the session storage to mark the specified session as active.
 * The previous active session becomes inactive (but not disconnected).
 * 
 * @param sessionManager - The session manager
 * @param sessionId - The session ID to switch to
 * @param jsonMode - Output as JSON
 * @returns Success or error
 */
export async function switchSession(
  sessionManager: SessionManager,
  sessionId: string,
  jsonMode: boolean
): Promise<{ success: true } | { error: string }> {
  const result = await findSession(sessionManager, sessionId);
  
  if ("error" in result) {
    return result;
  }
  
  await sessionManager.switchSession(result.session.id);
  
  if (jsonMode) {
    console.log(JSON.stringify({ 
      switched: true, 
      sessionId: result.session.id,
      label: result.session.label 
    }));
  } else {
    console.log(chalk.green(`✓ Switched to session ${result.session.id.substring(0, 8)}`));
    console.log(`  Label: ${result.session.label}`);
    console.log(`  Runtime: ${result.session.runtime.label}`);
  }
  
  return { success: true };
}

/**
 * Delete a session by ID.
 * 
 * Removes the session from local storage. Does NOT disconnect
 * the remote Colab runtime (use `disconnect` for that).
 * 
 * @param sessionManager - The session manager
 * @param sessionId - The session ID to delete
 * @param jsonMode - Output as JSON
 * @returns Success or error
 */
export async function deleteSession(
  sessionManager: SessionManager,
  sessionId: string,
  jsonMode: boolean
): Promise<{ success: true } | { error: string }> {
  const result = await findSession(sessionManager, sessionId);
  
  if ("error" in result) {
    return result;
  }
  
  await sessionManager.removeSession(result.session.id);
  
  if (jsonMode) {
    console.log(JSON.stringify({ 
      deleted: true, 
      sessionId: result.session.id 
    }));
  } else {
    console.log(chalk.green(`✓ Deleted session ${result.session.id.substring(0, 8)}`));
  }
  
  return { success: true };
}

/**
 * Clean up stale sessions.
 * 
 * Removes sessions that are no longer reachable:
 * - Runtime has been disconnected
 * - Session has timed out
 * - Storage is inconsistent
 * 
 * @param sessionManager - The session manager
 * @param jsonMode - Output as JSON
 * @returns Array of cleaned session IDs
 */
export async function cleanStaleSessions(
  sessionManager: SessionManager,
  jsonMode: boolean
): Promise<string[]> {
  const beforeStats = await sessionManager.getStats();
  const staleCount = beforeStats.staleSessions;
  
  if (staleCount === 0) {
    if (jsonMode) {
      console.log(JSON.stringify({ cleaned: [] }));
    } else {
      console.log(chalk.gray("No stale sessions to clean"));
    }
    return [];
  }
  
  const cleanedIds = await sessionManager.cleanStaleSessions();
  
  if (jsonMode) {
    console.log(JSON.stringify({ cleaned: cleanedIds }));
  } else {
    console.log(chalk.green(`✓ Cleaned ${cleanedIds.length} stale session(s)`));
  }
  
  return cleanedIds;
}
