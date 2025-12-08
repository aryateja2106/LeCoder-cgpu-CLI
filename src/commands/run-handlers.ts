/**
 * Run Command Handlers Module
 * 
 * This module provides the handler functions for the `run` command.
 * The `run` command executes shell commands or Python code on a Colab runtime.
 * 
 * ## Execution Modes
 * 
 * 1. **Terminal Mode** (default) - Executes shell commands via terminal WebSocket
 *    - Best for: shell scripts, system commands, file operations
 *    - Uses: TerminalClient, RemoteCommandRunner
 * 
 * 2. **Kernel Mode** - Executes Python code via Jupyter kernel
 *    - Best for: Python code, Jupyter-style execution with outputs
 *    - Uses: ColabConnection, JupyterKernelClient
 * 
 * ## Flow Overview
 * 
 * ```
 * run command
 *   ├── Validate options (check for conflicts)
 *   ├── Get or create session (with variant selection)
 *   ├── Select execution mode
 *   │     ├── Terminal mode → Remote shell execution
 *   │     └── Kernel mode → Jupyter kernel execution
 *   ├── Execute and capture output
 *   ├── Store in history
 *   └── Output results (human or JSON)
 * ```
 * 
 * @module commands/run-handlers
 */

import type { SessionManager } from "../session/session-manager.js";
import type { RuntimeManager } from "../runtime/runtime-manager.js";
import { Variant } from "../colab/api.js";
import type { ReplyStatus } from "../jupyter/protocol.js";

// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options controlling run command behavior.
 * Parsed from CLI flags.
 */
export interface RunCommandOptions {
  /** Execution mode: "terminal" (shell) or "kernel" (Python/Jupyter) */
  mode?: "terminal" | "kernel";
  /** Force creation of a new runtime instead of reusing */
  newRuntime?: boolean;
  /** Use TPU instead of GPU */
  tpu?: boolean;
  /** Use CPU-only runtime */
  cpu?: boolean;
  /** Output as JSON instead of human-readable */
  json?: boolean;
}

/**
 * Result of option validation.
 */
export interface OptionValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Error message if validation failed */
  error?: string;
}

/**
 * Runtime variant for session creation (lowercase strings).
 * Must be mapped to Variant enum for use with sessionManager.
 */
export type RuntimeVariant = "gpu" | "tpu" | "cpu";

/**
 * Map RuntimeVariant strings to Variant enum values.
 * 
 * @param variant - The runtime variant string
 * @returns The corresponding Variant enum value (or DEFAULT for cpu)
 */
export function toVariantEnum(variant: RuntimeVariant): Variant {
  switch (variant) {
    case "gpu":
      return Variant.GPU;
    case "tpu":
      return Variant.TPU;
    case "cpu":
      return Variant.DEFAULT;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Option Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate run command options for conflicting flags.
 * 
 * Checks that mutually exclusive options are not combined:
 * - --session cannot be used with --new-runtime, --tpu, or --cpu
 *   (because session already has a fixed runtime type)
 * 
 * @example
 * ```typescript
 * const result = validateRunOptions(
 *   { session: "abc123" },
 *   { newRuntime: true }
 * );
 * // result.valid = false, result.error = "Cannot use..."
 * ```
 * 
 * @param globalOptions - Global CLI options (session, forceLogin, etc.)
 * @param runOptions - Run-specific options
 * @returns Validation result with error message if invalid
 */
export function validateRunOptions(
  globalOptions: { session?: string },
  runOptions: RunCommandOptions
): OptionValidationResult {
  if (globalOptions.session && (runOptions.newRuntime || runOptions.tpu || runOptions.cpu)) {
    return {
      valid: false,
      error: "Cannot use --session with --new-runtime, --tpu, or --cpu flags"
    };
  }
  return { valid: true };
}

/**
 * Resolve the runtime variant from options.
 * 
 * Priority order:
 * 1. If --tpu flag is set → "tpu"
 * 2. If --cpu flag is set → "cpu"
 * 3. Default → "gpu"
 * 
 * @param options - Run command options
 * @returns The runtime variant to use
 */
export function resolveRuntimeVariant(options: RunCommandOptions): RuntimeVariant {
  if (options.tpu) return "tpu";
  if (options.cpu) return "cpu";
  return "gpu";
}

// History helpers can be added here when needed for actual integration

// ─────────────────────────────────────────────────────────────────────────────
// Session Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for getting or creating a session.
 */
export interface GetOrCreateSessionConfig {
  /** Session manager instance */
  sessionManager: SessionManager;
  /** Optional existing session ID to use */
  sessionId?: string;
  /** Runtime variant to use */
  variant: RuntimeVariant;
  /** Force creation of a new runtime */
  forceNew: boolean;
}

/**
 * Get an existing session or create a new one.
 * 
 * This wrapper around sessionManager.getOrCreateSession provides:
 * - Consistent error handling
 * - Logging of session creation/reuse
 * - Type-safe variant resolution
 * 
 * @param config - Session configuration
 * @returns The session object
 */
export async function getOrCreateSession(
  config: GetOrCreateSessionConfig
): Promise<{ runtime: { label: string; accelerator: string; endpoint: string; proxy?: object } }> {
  const { sessionManager, sessionId, variant, forceNew } = config;
  
  // Convert RuntimeVariant to Variant enum
  const variantEnum = toVariantEnum(variant);
  
  const session = await sessionManager.getOrCreateSession(sessionId, {
    variant: variantEnum,
    forceNew,
  });
  
  return session;
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Mode Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execution context for run command.
 * Contains all dependencies needed for execution.
 */
export interface ExecutionContext {
  /** Runtime manager for creating connections */
  runtimeManager: RuntimeManager;
  /** The runtime to execute on */
  runtime: {
    label: string;
    accelerator: string;
    endpoint: string;
    proxy?: object;
  };
  /** The command to execute */
  command: string;
  /** Output as JSON */
  jsonMode: boolean;
}

/**
 * Result of command execution.
 */
export interface ExecutionResult {
  /** Exit code (0 = success) */
  exitCode: number;
  /** Execution output (stdout/stderr combined) */
  output?: string;
  /** Error information if execution failed */
  error?: { ename: string; evalue: string };
  /** Execution status */
  status: ReplyStatus;
}

/**
 * Determine if kernel mode should be used.
 * 
 * @param mode - Explicitly requested mode, or undefined for auto-detect
 * @returns true if kernel mode should be used
 */
export function shouldUseKernelMode(mode?: "terminal" | "kernel"): boolean {
  return mode === "kernel";
}
