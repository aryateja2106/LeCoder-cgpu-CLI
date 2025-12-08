import chalk from "chalk";

/**
 * Verbose logging configuration
 */
interface VerboseLoggerConfig {
  enabled: boolean;
  includeTimestamps: boolean;
}

/**
 * Utility class for detailed verbose logging
 */
export class VerboseLogger {
  private config: VerboseLoggerConfig;

  constructor(enabled: boolean = false) {
    this.config = {
      enabled,
      includeTimestamps: true,
    };
  }

  /**
   * Enable or disable verbose logging
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Check if verbose logging is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Log an API call
   */
  logApiCall(method: string, url: string, statusCode?: number): void {
    if (!this.config.enabled) return;

    const timestamp = this.getTimestamp();
    const status = statusCode ? ` [${statusCode}]` : "";
    console.log(
      chalk.gray(`[VERBOSE]${timestamp} API ${method} ${url}${status}`)
    );
  }

  /**
   * Log WebSocket event
   */
  logWebSocketEvent(event: string, details?: string): void {
    if (!this.config.enabled) return;

    const timestamp = this.getTimestamp();
    const detailsStr = details ? ` - ${details}` : "";
    console.log(
      chalk.gray(`[VERBOSE]${timestamp} WebSocket ${event}${detailsStr}`)
    );
  }

  /**
   * Log kernel message
   */
  logKernelMessage(msgType: string, content?: unknown): void {
    if (!this.config.enabled) return;

    const timestamp = this.getTimestamp();
    const contentStr = content
      ? `\n${chalk.gray(JSON.stringify(content, null, 2))}`
      : "";
    console.log(
      chalk.gray(`[VERBOSE]${timestamp} Kernel message: ${msgType}${contentStr}`)
    );
  }

  /**
   * Log timing information
   */
  logTiming(label: string, durationMs: number): void {
    if (!this.config.enabled) return;

    const timestamp = this.getTimestamp();
    console.log(
      chalk.gray(`[VERBOSE]${timestamp} Timing: ${label} took ${durationMs}ms`)
    );
  }

  /**
   * Log runtime assignment details
   */
  logRuntimeAssignment(
    endpoint: string,
    accelerator: string,
    proxyUrl?: string
  ): void {
    if (!this.config.enabled) return;

    const timestamp = this.getTimestamp();
    console.log(
      chalk.gray(`[VERBOSE]${timestamp} Runtime assigned:`)
    );
    console.log(chalk.gray(`  Endpoint: ${endpoint}`));
    console.log(chalk.gray(`  Accelerator: ${accelerator}`));
    if (proxyUrl) {
      console.log(chalk.gray(`  Proxy URL: ${proxyUrl}`));
    }
  }

  /**
   * Log session creation
   */
  logSessionCreation(sessionId: string, kernelId: string): void {
    if (!this.config.enabled) return;

    const timestamp = this.getTimestamp();
    console.log(
      chalk.gray(`[VERBOSE]${timestamp} Session created:`)
    );
    console.log(chalk.gray(`  Session ID: ${sessionId}`));
    console.log(chalk.gray(`  Kernel ID: ${kernelId}`));
  }

  /**
   * Log keep-alive event
   */
  logKeepAlive(type: "ping" | "pong"): void {
    if (!this.config.enabled) return;

    const timestamp = this.getTimestamp();
    console.log(
      chalk.gray(`[VERBOSE]${timestamp} Keep-alive ${type}`)
    );
  }

  /**
   * Log connection test
   */
  logConnectionTest(target: string, success: boolean, errorMsg?: string): void {
    if (!this.config.enabled) return;

    const timestamp = this.getTimestamp();
    const status = success ? chalk.green("✓") : chalk.red("✗");
    const error = errorMsg ? ` - ${errorMsg}` : "";
    console.log(
      chalk.gray(`[VERBOSE]${timestamp} Connection test ${status} ${target}${error}`)
    );
  }

  /**
   * Log execution timing breakdown
   */
  logExecutionBreakdown(breakdown: {
    connection_ms?: number;
    execution_ms?: number;
    cleanup_ms?: number;
  }): void {
    if (!this.config.enabled) return;

    const timestamp = this.getTimestamp();
    console.log(
      chalk.gray(`[VERBOSE]${timestamp} Execution timing breakdown:`)
    );
    if (breakdown.connection_ms !== undefined) {
      console.log(chalk.gray(`  Connection: ${breakdown.connection_ms}ms`));
    }
    if (breakdown.execution_ms !== undefined) {
      console.log(chalk.gray(`  Execution: ${breakdown.execution_ms}ms`));
    }
    if (breakdown.cleanup_ms !== undefined) {
      console.log(chalk.gray(`  Cleanup: ${breakdown.cleanup_ms}ms`));
    }
  }

  /**
   * Log general verbose message
   */
  log(message: string, data?: unknown): void {
    if (!this.config.enabled) return;

    const timestamp = this.getTimestamp();
    const dataStr = data
      ? `\n${chalk.gray(JSON.stringify(data, null, 2))}`
      : "";
    console.log(chalk.gray(`[VERBOSE]${timestamp} ${message}${dataStr}`));
  }

  /**
   * Log error with full stack trace
   */
  logError(message: string, error: unknown): void {
    if (!this.config.enabled) return;

    const timestamp = this.getTimestamp();
    console.error(chalk.red(`[VERBOSE]${timestamp} ERROR: ${message}`));
    if (error instanceof Error) {
      console.error(chalk.red(error.stack || error.message));
    } else {
      console.error(chalk.red(String(error)));
    }
  }

  /**
   * Get formatted timestamp
   */
  private getTimestamp(): string {
    if (!this.config.includeTimestamps) return "";

    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const ms = String(now.getMilliseconds()).padStart(3, "0");
    return ` [${hours}:${minutes}:${seconds}.${ms}]`;
  }
}

/**
 * Create a verbose logger instance
 */
export function createVerboseLogger(enabled: boolean = false): VerboseLogger {
  return new VerboseLogger(enabled);
}
