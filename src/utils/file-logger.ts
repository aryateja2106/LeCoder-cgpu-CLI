import fs from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";

/**
 * Log levels in order of severity
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Log entry structure
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  levelName: string;
  category: string;
  message: string;
  data?: unknown;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Logger configuration options
 */
export interface FileLoggerOptions {
  /** Base directory for logs (default: ~/.config/lecoder-cgpu/logs) */
  logsDir: string;
  /** Minimum log level to write (default: INFO) */
  minLevel?: LogLevel;
  /** Maximum log file size in bytes before rotation (default: 10MB) */
  maxFileSize?: number;
  /** Number of days to retain old logs (default: 7) */
  retentionDays?: number;
  /** Whether to also log to console (default: false) */
  consoleOutput?: boolean;
}

/**
 * File-based logger for persistent debugging logs
 */
export class FileLogger extends EventEmitter {
  private readonly logsDir: string;
  private readonly minLevel: LogLevel;
  private readonly maxFileSize: number;
  private readonly retentionDays: number;
  private readonly consoleOutput: boolean;

  private currentLogFile: string | null = null;
  private writeStream: WriteStream | null = null;
  private currentFileSize = 0;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private writeQueue: LogEntry[] = [];
  private isWriting = false;

  constructor(options: FileLoggerOptions) {
    super();
    this.logsDir = options.logsDir;
    this.minLevel = options.minLevel ?? LogLevel.INFO;
    this.maxFileSize = options.maxFileSize ?? 10 * 1024 * 1024; // 10MB
    this.retentionDays = options.retentionDays ?? 7;
    this.consoleOutput = options.consoleOutput ?? false;
  }

  /**
   * Initialize the logger - creates logs directory and opens log file
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize();
    await this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      // Create logs directory
      await fs.mkdir(this.logsDir, { recursive: true });

      // Clean up old logs
      await this.cleanupOldLogs();

      // Open current log file
      await this.openLogFile();

      this.initialized = true;
      
      // Process any queued entries
      await this.processQueue();
    } catch (error) {
      // Don't throw - logging should not break the app
      if (this.consoleOutput) {
        console.error("[FileLogger] Failed to initialize:", error);
      }
    }
  }

  /**
   * Get the current log file path
   */
  private getLogFilePath(): string {
    const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    return path.join(this.logsDir, `lecoder-cgpu-${date}.log`);
  }

  /**
   * Open or rotate the log file
   */
  private async openLogFile(): Promise<void> {
    const logFile = this.getLogFilePath();

    // Check if we need to switch to a new file (new day)
    if (this.currentLogFile !== logFile) {
      await this.closeLogFile();
      this.currentLogFile = logFile;
      this.currentFileSize = 0;

      // Check existing file size
      try {
        const stats = await fs.stat(logFile);
        this.currentFileSize = stats.size;
      } catch {
        // File doesn't exist yet
      }
    }

    // Open write stream if not already open
    if (!this.writeStream) {
      this.writeStream = createWriteStream(logFile, { flags: "a" });
      this.writeStream.on("error", (error) => {
        if (this.consoleOutput) {
          console.error("[FileLogger] Write error:", error);
        }
        this.emit("error", error);
      });
    }
  }

  /**
   * Close the current log file
   */
  private async closeLogFile(): Promise<void> {
    if (this.writeStream) {
      await new Promise<void>((resolve) => {
        this.writeStream!.end(() => resolve());
      });
      this.writeStream = null;
    }
  }

  /**
   * Clean up logs older than retentionDays
   */
  private async cleanupOldLogs(): Promise<void> {
    try {
      const files = await fs.readdir(this.logsDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

      for (const file of files) {
        if (!file.startsWith("lecoder-cgpu-") || !file.endsWith(".log")) continue;

        // Extract date from filename (lecoder-cgpu-YYYY-MM-DD.log)
        const dateMatch = file.match(/lecoder-cgpu-(\d{4}-\d{2}-\d{2})\.log/);
        if (!dateMatch) continue;

        const fileDate = new Date(dateMatch[1]);
        if (fileDate < cutoffDate) {
          await fs.unlink(path.join(this.logsDir, file));
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Check if file needs rotation and rotate if necessary
   */
  private async checkRotation(): Promise<void> {
    if (this.currentFileSize >= this.maxFileSize) {
      // Rotate by adding timestamp suffix
      if (this.currentLogFile) {
        const rotatedFile = this.currentLogFile.replace(
          ".log",
          `-${Date.now()}.log`
        );
        await this.closeLogFile();
        try {
          await fs.rename(this.currentLogFile, rotatedFile);
        } catch {
          // Ignore rotation errors
        }
        this.currentFileSize = 0;
      }
      await this.openLogFile();
    }
  }

  /**
   * Format a log entry as JSON line
   */
  private formatEntry(entry: LogEntry): string {
    return JSON.stringify(entry) + "\n";
  }

  /**
   * Get level name string
   */
  private getLevelName(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return "DEBUG";
      case LogLevel.INFO:
        return "INFO";
      case LogLevel.WARN:
        return "WARN";
      case LogLevel.ERROR:
        return "ERROR";
      default:
        return "UNKNOWN";
    }
  }

  /**
   * Process the write queue
   */
  private async processQueue(): Promise<void> {
    if (this.isWriting || this.writeQueue.length === 0) return;
    if (!this.initialized || !this.writeStream) return;

    this.isWriting = true;

    try {
      while (this.writeQueue.length > 0) {
        const entry = this.writeQueue.shift()!;
        const line = this.formatEntry(entry);

        await new Promise<void>((resolve, reject) => {
          const canContinue = this.writeStream!.write(line, (error) => {
            if (error) reject(error);
            else resolve();
          });

          if (!canContinue) {
            this.writeStream!.once("drain", resolve);
          }
        });

        this.currentFileSize += Buffer.byteLength(line);
        await this.checkRotation();
      }
    } finally {
      this.isWriting = false;
    }
  }

  /**
   * Write a log entry
   */
  private async writeEntry(
    level: LogLevel,
    category: string,
    message: string,
    data?: unknown,
    error?: Error
  ): Promise<void> {
    if (level < this.minLevel) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      levelName: this.getLevelName(level),
      category,
      message,
    };

    if (data !== undefined) {
      entry.data = data;
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    // Console output if enabled
    if (this.consoleOutput) {
      const prefix = `[${entry.levelName}] [${category}]`;
      const msg = `${entry.timestamp} ${prefix} ${message}`;
      switch (level) {
        case LogLevel.ERROR:
          console.error(msg, data ?? "", error ?? "");
          break;
        case LogLevel.WARN:
          console.warn(msg, data ?? "");
          break;
        default:
          console.log(msg, data ?? "");
      }
    }

    // Queue the entry
    this.writeQueue.push(entry);

    // Initialize if needed and process queue
    if (!this.initialized) {
      await this.initialize();
    } else {
      await this.processQueue();
    }
  }

  // Convenience logging methods

  debug(category: string, message: string, data?: unknown): void {
    void this.writeEntry(LogLevel.DEBUG, category, message, data);
  }

  info(category: string, message: string, data?: unknown): void {
    void this.writeEntry(LogLevel.INFO, category, message, data);
  }

  warn(category: string, message: string, data?: unknown): void {
    void this.writeEntry(LogLevel.WARN, category, message, data);
  }

  error(category: string, message: string, error?: Error, data?: unknown): void {
    void this.writeEntry(LogLevel.ERROR, category, message, data, error);
  }

  /**
   * Log an API request/response
   */
  logApi(
    method: string,
    url: string,
    statusCode?: number,
    durationMs?: number,
    error?: Error
  ): void {
    const level = error ? LogLevel.ERROR : statusCode && statusCode >= 400 ? LogLevel.WARN : LogLevel.DEBUG;
    void this.writeEntry(level, "API", `${method} ${url}`, {
      statusCode,
      durationMs,
    }, error);
  }

  /**
   * Log a session lifecycle event
   */
  logSession(
    action: "create" | "switch" | "close" | "expire" | "error",
    sessionId: string,
    details?: Record<string, unknown>
  ): void {
    const level = action === "error" ? LogLevel.ERROR : LogLevel.INFO;
    void this.writeEntry(level, "SESSION", `Session ${action}: ${sessionId}`, details);
  }

  /**
   * Log a runtime event
   */
  logRuntime(
    action: "assign" | "connect" | "disconnect" | "timeout" | "error",
    details?: Record<string, unknown>,
    error?: Error
  ): void {
    const level = action === "error" ? LogLevel.ERROR : LogLevel.INFO;
    void this.writeEntry(level, "RUNTIME", `Runtime ${action}`, details, error);
  }

  /**
   * Log command execution
   */
  logCommand(
    command: string,
    args: string[],
    durationMs?: number,
    exitCode?: number,
    error?: Error
  ): void {
    const level = error ? LogLevel.ERROR : exitCode !== 0 ? LogLevel.WARN : LogLevel.INFO;
    void this.writeEntry(level, "COMMAND", `Executed: ${command}`, {
      args,
      durationMs,
      exitCode,
    }, error);
  }

  /**
   * Log WebSocket events
   */
  logWebSocket(
    event: "open" | "close" | "message" | "error" | "reconnect",
    details?: Record<string, unknown>,
    error?: Error
  ): void {
    const level = event === "error" ? LogLevel.ERROR : LogLevel.DEBUG;
    void this.writeEntry(level, "WEBSOCKET", `WebSocket ${event}`, details, error);
  }

  /**
   * Log kernel messages
   */
  logKernel(
    msgType: string,
    content?: unknown,
    error?: Error
  ): void {
    const level = error ? LogLevel.ERROR : LogLevel.DEBUG;
    void this.writeEntry(level, "KERNEL", `Kernel message: ${msgType}`, content, error);
  }

  /**
   * Flush any pending writes and close the logger
   */
  async close(): Promise<void> {
    // Wait for queue to drain
    while (this.writeQueue.length > 0 || this.isWriting) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await this.closeLogFile();
    this.initialized = false;
    this.initPromise = null;
  }

  /**
   * Get path to current log file
   */
  getCurrentLogFile(): string | null {
    return this.currentLogFile;
  }

  /**
   * Get path to logs directory
   */
  getLogsDir(): string {
    return this.logsDir;
  }

  /**
   * List all log files
   */
  async listLogFiles(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.logsDir);
      return files
        .filter((f) => f.startsWith("lecoder-cgpu-") && f.endsWith(".log"))
        .sort()
        .reverse(); // Most recent first
    } catch {
      return [];
    }
  }

  /**
   * Read contents of a specific log file
   */
  async readLogFile(filename: string): Promise<LogEntry[]> {
    const filePath = path.join(this.logsDir, filename);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return content
        .trim()
        .split("\n")
        .filter((line) => line)
        .map((line) => JSON.parse(line) as LogEntry);
    } catch {
      return [];
    }
  }

  /**
   * Search logs for entries matching criteria
   */
  async searchLogs(options: {
    level?: LogLevel;
    category?: string;
    startDate?: Date;
    endDate?: Date;
    searchText?: string;
    limit?: number;
  }): Promise<LogEntry[]> {
    const results: LogEntry[] = [];
    const limit = options.limit ?? 100;

    const files = await this.listLogFiles();
    for (const file of files) {
      if (results.length >= limit) break;

      // Check date range from filename
      const dateMatch = file.match(/lecoder-cgpu-(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        const fileDate = new Date(dateMatch[1]);
        if (options.startDate && fileDate < options.startDate) continue;
        if (options.endDate && fileDate > options.endDate) continue;
      }

      const entries = await this.readLogFile(file);
      for (const entry of entries) {
        if (results.length >= limit) break;

        // Filter by level
        if (options.level !== undefined && entry.level < options.level) continue;

        // Filter by category
        if (options.category && entry.category !== options.category) continue;

        // Filter by search text
        if (options.searchText) {
          const searchLower = options.searchText.toLowerCase();
          const matchesMessage = entry.message.toLowerCase().includes(searchLower);
          const matchesData = entry.data && JSON.stringify(entry.data).toLowerCase().includes(searchLower);
          if (!matchesMessage && !matchesData) continue;
        }

        results.push(entry);
      }
    }

    return results;
  }
}

// Singleton instance
let globalLogger: FileLogger | null = null;

/**
 * Initialize the global file logger
 */
export function initFileLogger(logsDir: string, options?: Partial<FileLoggerOptions>): FileLogger {
  if (globalLogger) {
    return globalLogger;
  }

  globalLogger = new FileLogger({
    logsDir,
    ...options,
  });

  // Initialize asynchronously
  void globalLogger.initialize();

  return globalLogger;
}

/**
 * Get the global file logger instance
 */
export function getFileLogger(): FileLogger | null {
  return globalLogger;
}

/**
 * Create a category-specific logger facade
 */
export function createCategoryLogger(category: string) {
  return {
    debug: (message: string, data?: unknown) => globalLogger?.debug(category, message, data),
    info: (message: string, data?: unknown) => globalLogger?.info(category, message, data),
    warn: (message: string, data?: unknown) => globalLogger?.warn(category, message, data),
    error: (message: string, error?: Error, data?: unknown) => globalLogger?.error(category, message, error, data),
  };
}
