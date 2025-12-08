import chalk from "chalk";
import type { ExecutionResult } from "./protocol.js";
import { ReplyStatus } from "./protocol.js";

/**
 * Error categories for classification
 */
export enum ErrorCategory {
  SYNTAX = "syntax",
  RUNTIME = "runtime",
  TIMEOUT = "timeout",
  MEMORY = "memory",
  IMPORT = "import",
  IO = "io",
  UNKNOWN = "unknown",
}

/**
 * Numeric error codes for machine parsing
 */
export enum ErrorCode {
  SUCCESS = 0,
  SYNTAX_ERROR = 1001,
  RUNTIME_ERROR = 1002,
  TIMEOUT_ERROR = 1003,
  MEMORY_ERROR = 1004,
  IMPORT_ERROR = 1005,
  IO_ERROR = 1006,
  UNKNOWN_ERROR = 1999,
}

/**
 * Extended error class for execution errors
 */
export class ExecutionError extends Error {
  readonly ename: string;
  readonly evalue: string;
  readonly traceback: string[];
  readonly executionCount: number | null;
  readonly category: ErrorCategory;
  readonly errorCode: number;

  constructor(
    ename: string,
    evalue: string,
    traceback: string[],
    executionCount: number | null = null
  ) {
    super(`${ename}: ${evalue}`);
    this.name = "ExecutionError";
    this.ename = ename;
    this.evalue = evalue;
    this.traceback = traceback;
    this.executionCount = executionCount;
    this.category = categorizeError({ ename, evalue, traceback });
    this.errorCode = getErrorCode(this.category);
  }
}

/**
 * Agent-friendly error summary
 */
export interface ErrorSummary {
  code: number;
  category: string;
  name: string;
  message: string;
  description: string;
  traceback?: string[];
  suggestion?: string;
}

/**
 * Parsed traceback with structured information
 */
export interface ParsedTraceback {
  frames: TracebackFrame[];
  rawLines: string[];
}

/**
 * A single frame in the traceback
 */
export interface TracebackFrame {
  file: string;
  line: number | null;
  function: string;
  code: string;
}

/**
 * Categorize an error based on its type
 */
export function categorizeError(error: {
  ename: string;
  evalue: string;
  traceback: string[];
}): ErrorCategory {
  const { ename } = error;

  // Syntax errors
  if (
    ename === "SyntaxError" ||
    ename === "IndentationError" ||
    ename === "TabError"
  ) {
    return ErrorCategory.SYNTAX;
  }

  // Import errors
  if (ename === "ImportError" || ename === "ModuleNotFoundError") {
    return ErrorCategory.IMPORT;
  }

  // Memory errors
  if (
    ename === "MemoryError" ||
    ename === "OutOfMemoryError" ||
    ename.includes("OOM") ||
    error.evalue.toLowerCase().includes("out of memory")
  ) {
    return ErrorCategory.MEMORY;
  }

  // Timeout errors
  if (
    ename === "TimeoutError" ||
    ename === "KeyboardInterrupt" ||
    ename.includes("Timeout")
  ) {
    return ErrorCategory.TIMEOUT;
  }

  // IO errors
  if (
    ename === "IOError" ||
    ename === "OSError" ||
    ename === "FileNotFoundError" ||
    ename === "PermissionError" ||
    ename === "IsADirectoryError" ||
    ename === "NotADirectoryError"
  ) {
    return ErrorCategory.IO;
  }

  // Common runtime errors
  if (
    ename === "NameError" ||
    ename === "TypeError" ||
    ename === "ValueError" ||
    ename === "AttributeError" ||
    ename === "KeyError" ||
    ename === "IndexError" ||
    ename === "ZeroDivisionError" ||
    ename === "RuntimeError" ||
    ename === "AssertionError" ||
    ename === "StopIteration" ||
    ename === "RecursionError"
  ) {
    return ErrorCategory.RUNTIME;
  }

  return ErrorCategory.UNKNOWN;
}

/**
 * Parse a Python traceback into structured frames
 */
export function parseTraceback(traceback: string[]): ParsedTraceback {
  const frames: TracebackFrame[] = [];
  const rawLines: string[] = [];

  // Python traceback format:
  // File "filename.py", line 10, in function_name
  //     code here
  const filePattern = /File "(.+)", line (\d+), in (.+)/;
  const ipythonPattern = /<ipython-input-(\d+)-[^>]+>/;

  let currentFrame: Partial<TracebackFrame> | null = null;

  for (const rawLine of traceback) {
    // Strip ANSI codes
    const line = rawLine.replace(/\x1b\[[0-9;]*m/g, "");
    rawLines.push(line);

    const match = line.match(filePattern);
    if (match) {
      // Save previous frame if exists
      if (currentFrame && currentFrame.file) {
        frames.push({
          file: currentFrame.file,
          line: currentFrame.line ?? null,
          function: currentFrame.function ?? "<unknown>",
          code: currentFrame.code ?? "",
        });
      }

      let file = match[1];
      // Handle IPython input markers
      const ipythonMatch = file.match(ipythonPattern);
      if (ipythonMatch) {
        file = `<cell ${ipythonMatch[1]}>`;
      }

      currentFrame = {
        file,
        line: parseInt(match[2], 10),
        function: match[3],
        code: "",
      };
    } else if (currentFrame && line.trim() && !line.startsWith("Traceback")) {
      // This is likely the code line
      if (!currentFrame.code) {
        currentFrame.code = line.trim();
      }
    }
  }

  // Don't forget the last frame
  if (currentFrame && currentFrame.file) {
    frames.push({
      file: currentFrame.file,
      line: currentFrame.line ?? null,
      function: currentFrame.function ?? "<unknown>",
      code: currentFrame.code ?? "",
    });
  }

  return { frames, rawLines };
}

/**
 * Format an execution error for display
 */
export function formatError(error: {
  ename: string;
  evalue: string;
  traceback: string[];
}): string {
  const lines: string[] = [];

  // Parse traceback for structured output
  const parsed = parseTraceback(error.traceback);

  // Error header
  lines.push(chalk.red.bold(`${error.ename}: ${error.evalue}`));
  lines.push("");

  // Traceback frames
  if (parsed.frames.length > 0) {
    lines.push(chalk.gray("Traceback (most recent call last):"));

    for (const frame of parsed.frames) {
      const lineInfo = frame.line !== null ? `:${frame.line}` : "";
      lines.push(
        chalk.gray(`  ${frame.file}${lineInfo} in `) +
          chalk.cyan(frame.function)
      );
      if (frame.code) {
        lines.push(chalk.white(`    ${frame.code}`));
      }
    }
  }

  return lines.join("\n");
}

/**
 * Format a complete execution result for display
 */
export function formatExecutionResult(result: ExecutionResult): string {
  const lines: string[] = [];

  // Stdout
  if (result.stdout) {
    lines.push(result.stdout);
  }

  // Stderr (warning-style)
  if (result.stderr) {
    lines.push(chalk.yellow(result.stderr));
  }

  // Display data
  for (const data of result.display_data) {
    if (data.data["text/plain"]) {
      lines.push(chalk.cyan(String(data.data["text/plain"])));
    } else if (data.data["text/html"]) {
      lines.push(chalk.gray("[HTML output]"));
    } else if (data.data["image/png"]) {
      lines.push(chalk.gray("[Image output (PNG)]"));
    } else if (data.data["image/jpeg"]) {
      lines.push(chalk.gray("[Image output (JPEG)]"));
    } else if (data.data["image/svg+xml"]) {
      lines.push(chalk.gray("[SVG output]"));
    } else if (data.data["application/json"]) {
      try {
        const json = JSON.stringify(data.data["application/json"], null, 2);
        lines.push(chalk.gray(json));
      } catch {
        lines.push(chalk.gray("[JSON output]"));
      }
    }
  }

  // Error
  if (result.error) {
    lines.push(formatError(result.error));
  }

  // Status indicator
  if (result.status === ReplyStatus.ERROR) {
    lines.push("");
    lines.push(chalk.red("✗ Execution failed"));
  } else if (result.status === ReplyStatus.ABORT) {
    lines.push("");
    lines.push(chalk.yellow("⚠ Execution aborted"));
  }

  // Timing
  if (result.timing) {
    lines.push(
      chalk.gray(`  Completed in ${result.timing.duration_ms}ms`)
    );
  }

  return lines.join("\n");
}

/**
 * Get a user-friendly description of an error category
 */
export function getCategoryDescription(category: ErrorCategory): string {
  switch (category) {
    case ErrorCategory.SYNTAX:
      return "Syntax Error - Check your code for typos or incorrect Python syntax";
    case ErrorCategory.RUNTIME:
      return "Runtime Error - An error occurred during code execution";
    case ErrorCategory.TIMEOUT:
      return "Timeout/Interrupt - The operation was interrupted or timed out";
    case ErrorCategory.MEMORY:
      return "Memory Error - The operation ran out of available memory";
    case ErrorCategory.IMPORT:
      return "Import Error - A required module could not be imported";
    case ErrorCategory.IO:
      return "I/O Error - A file or resource could not be accessed";
    case ErrorCategory.UNKNOWN:
    default:
      return "Unknown Error - An unexpected error occurred";
  }
}

/**
 * Check if debug logging is enabled
 */
export function isDebugEnabled(): boolean {
  return Boolean(process.env.LECODER_CGPU_DEBUG);
}

/**
 * Debug log helper
 */
export function debugLog(message: string, ...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.log(chalk.gray(`[DEBUG] ${message}`), ...args);
  }
}

/**
 * Debug error helper
 */
export function debugError(message: string, error?: unknown): void {
  if (isDebugEnabled()) {
    console.error(chalk.red(`[DEBUG ERROR] ${message}`));
    if (error) {
      console.error(error);
    }
  }
}

/**
 * Map error category to numeric code
 */
export function getErrorCode(category: ErrorCategory): number {
  switch (category) {
    case ErrorCategory.SYNTAX:
      return ErrorCode.SYNTAX_ERROR;
    case ErrorCategory.RUNTIME:
      return ErrorCode.RUNTIME_ERROR;
    case ErrorCategory.TIMEOUT:
      return ErrorCode.TIMEOUT_ERROR;
    case ErrorCategory.MEMORY:
      return ErrorCode.MEMORY_ERROR;
    case ErrorCategory.IMPORT:
      return ErrorCode.IMPORT_ERROR;
    case ErrorCategory.IO:
      return ErrorCode.IO_ERROR;
    case ErrorCategory.UNKNOWN:
    default:
      return ErrorCode.UNKNOWN_ERROR;
  }
}

/**
 * Get actionable suggestion for error category
 */
function getErrorSuggestion(category: ErrorCategory, ename: string, evalue: string): string | undefined {
  switch (category) {
    case ErrorCategory.SYNTAX:
      return "Check your code for typos, incorrect indentation, or invalid Python syntax";
    case ErrorCategory.IMPORT: {
      const moduleMatch = evalue.match(/No module named ['"]([^'"]+)['"]/);
      if (moduleMatch) {
        return `Install missing module with: pip install ${moduleMatch[1]}`;
      }
      return "Ensure all required modules are installed in your environment";
    }
    case ErrorCategory.MEMORY:
      return "Try reducing batch size, clearing cache, or using a runtime with more GPU memory";
    case ErrorCategory.TIMEOUT:
      return "Break down long-running operations or increase timeout limits";
    case ErrorCategory.IO:
      return "Verify file paths exist and you have proper permissions";
    case ErrorCategory.RUNTIME:
      if (ename === "NameError") {
        return "Check that all variables and functions are defined before use";
      }
      if (ename === "TypeError") {
        return "Verify argument types match function signatures";
      }
      return "Review the traceback to identify the source of the error";
    default:
      return undefined;
  }
}

/**
 * Create agent-friendly error summary
 */
export function createErrorSummary(error: ExecutionError): ErrorSummary {
  return {
    code: error.errorCode,
    category: error.category,
    name: error.ename,
    message: error.evalue,
    description: getCategoryDescription(error.category),
    traceback: error.traceback,
    suggestion: getErrorSuggestion(error.category, error.ename, error.evalue),
  };
}
