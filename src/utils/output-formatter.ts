import type { ExecutionResult } from "../jupyter/protocol.js";
import { ReplyStatus } from "../jupyter/protocol.js";
import type { HistoryEntry } from "../runtime/execution-history.js";
import { ErrorCode, createErrorSummary, ExecutionError } from "../jupyter/error-handler.js";

/**
 * Formatting options
 */
export interface FormatOptions {
  json: boolean;
  pretty?: boolean;
  includeMetadata?: boolean;
}

/**
 * Status information for status command
 */
export interface StatusInfo {
  authenticated: boolean;
  account: {
    id: string;
    label: string;
  };
  eligibleGpus: string[];
  runtimes: RuntimeInfo[];
}

/**
 * Runtime information
 */
export interface RuntimeInfo {
  label: string;
  endpoint: string;
  accelerator: string;
  connected: boolean;
  gpu?: {
    name: string;
    memory: {
      total: string;
      used: string;
      free: string;
    };
    utilization: {
      gpu: string;
      memory: string;
    };
  };
  kernel?: {
    id: string;
    state: string;
    executionCount: number;
  };
}

/**
 * Output formatter for JSON and human-readable formats
 */
export class OutputFormatter {
  /**
   * Format execution result
   */
  static formatExecutionResult(
    result: ExecutionResult,
    options: FormatOptions = { json: false }
  ): string {
    if (options.json) {
      return this.formatExecutionResultJson(result, options);
    }
    // For human-readable, we still use the existing chalk-based formatting
    // This will be handled by the calling code using formatExecutionResult from error-handler.ts
    return "";
  }

  /**
   * Format execution result as JSON
   */
  private static formatExecutionResultJson(
    result: ExecutionResult,
    options: FormatOptions
  ): string {
    const includeMetadata = options.includeMetadata ?? true;

    const output: Record<string, unknown> = {
      status: result.status,
      errorCode: result.status === ReplyStatus.OK ? ErrorCode.SUCCESS : undefined,
    };

    // Stdout (strip ANSI codes)
    if (result.stdout) {
      output.stdout = this.stripAnsiCodes(result.stdout);
    }

    // Stderr (strip ANSI codes)
    if (result.stderr) {
      output.stderr = this.stripAnsiCodes(result.stderr);
    }

    // Display data
    if (result.display_data && result.display_data.length > 0) {
      output.display_data = result.display_data.map((data) => ({
        data: data.data,
        metadata: data.metadata,
      }));
    }

    // Error information
    if (result.error) {
      const error = new ExecutionError(
        result.error.ename,
        result.error.evalue,
        result.error.traceback
      );
      const errorSummary = createErrorSummary(error);
      
      output.errorCode = errorSummary.code;
      output.error = {
        name: errorSummary.name,
        message: this.stripAnsiCodes(errorSummary.message),
        category: errorSummary.category,
        description: errorSummary.description,
        traceback: errorSummary.traceback?.map((line) =>
          this.stripAnsiCodes(line)
        ),
        suggestion: errorSummary.suggestion,
      };
    }

    // Metadata
    if (includeMetadata) {
      if (result.timing) {
        output.timing = {
          started: result.timing.started,
          completed: result.timing.completed,
          duration_ms: result.timing.duration_ms,
        };
      }

      if (result.execution_count !== undefined) {
        output.execution_count = result.execution_count;
      }
    }

    const pretty = options.pretty ?? true;
    return JSON.stringify(output, null, pretty ? 2 : undefined);
  }

  /**
   * Format status information
   */
  static formatStatus(statusInfo: StatusInfo, asJson: boolean = false): string {
    if (asJson) {
      return JSON.stringify(statusInfo, null, 2);
    }
    // Human-readable format handled by calling code
    return "";
  }

  /**
   * Format single history entry
   */
  static formatHistoryEntry(
    entry: HistoryEntry,
    asJson: boolean = false
  ): string {
    if (asJson) {
      const serialized = {
        ...entry,
        timestamp: entry.timestamp.toISOString(),
        stdout: entry.stdout ? this.stripAnsiCodes(entry.stdout) : undefined,
        stderr: entry.stderr ? this.stripAnsiCodes(entry.stderr) : undefined,
        error: entry.error
          ? {
              ...entry.error,
              traceback: entry.error.traceback.map((line) =>
                this.stripAnsiCodes(line)
              ),
            }
          : undefined,
      };
      return JSON.stringify(serialized, null, 2);
    }
    return "";
  }

  /**
   * Format list of history entries
   */
  static formatHistoryList(
    entries: HistoryEntry[],
    asJson: boolean = false
  ): string {
    if (asJson) {
      const serialized = entries.map((entry) => ({
        ...entry,
        timestamp: entry.timestamp.toISOString(),
        stdout: entry.stdout ? this.stripAnsiCodes(entry.stdout) : undefined,
        stderr: entry.stderr ? this.stripAnsiCodes(entry.stderr) : undefined,
        error: entry.error
          ? {
              ...entry.error,
              traceback: entry.error.traceback.map((line) =>
                this.stripAnsiCodes(line)
              ),
            }
          : undefined,
      }));
      return JSON.stringify(serialized, null, 2);
    }
    return "";
  }

  /**
   * Strip ANSI color codes from string
   */
  static stripAnsiCodes(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, "");
  }

  /**
   * Check if JSON mode is enabled globally
   */
  static isJsonMode(): boolean {
    return process.argv.includes("--json");
  }
}
