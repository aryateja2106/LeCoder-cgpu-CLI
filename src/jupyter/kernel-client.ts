import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  type JupyterMessage,
  type ExecutionResult,
  type ExecuteOptions,
  MessageType,
  ReplyStatus,
  ExecutionState,
  createExecuteRequest,
  createKernelInfoRequest,
  createInterruptRequest,
  serializeMessage,
  deserializeMessage,
  matchesParent,
  StreamContentSchema,
  ErrorContentSchema,
  DisplayDataContentSchema,
  ExecuteReplyContentSchema,
  StatusContentSchema,
} from "./protocol.js";
import {
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
  COLAB_CLIENT_AGENT_HEADER,
} from "../colab/headers.js";

export interface KernelClientOptions {
  kernelId: string;
  wsUrl: string;
  token: string;
  sessionId?: string;
  proxyUrl?: string; // Proxy URL for Origin header
}

export interface KernelClientEvents {
  connected: () => void;
  disconnected: (code: number, reason: string) => void;
  message: (message: JupyterMessage) => void;
  status: (state: ExecutionState) => void;
  error: (error: Error) => void;
}

/**
 * Client for communicating with a Jupyter kernel via WebSocket
 */
export class JupyterKernelClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly kernelId: string;
  private readonly wsUrl: string;
  private readonly token: string;
  private readonly sessionId: string;
  private readonly proxyUrl: string | undefined;
  private isConnected: boolean = false;
  private messageQueue: string[] = [];

  constructor(options: KernelClientOptions) {
    super();
    this.kernelId = options.kernelId;
    this.wsUrl = options.wsUrl;
    this.token = options.token;
    this.sessionId = options.sessionId || randomUUID();
    this.proxyUrl = options.proxyUrl;
  }

  /**
   * Connect to the Jupyter kernel WebSocket
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsEndpoint = `${this.wsUrl}/api/kernels/${this.kernelId}/channels`;
      
      // Add runtime proxy token and authuser as query parameters
      const url = new URL(wsEndpoint);
      url.searchParams.set("token", this.token);
      url.searchParams.set("authuser", "0");

      // Build headers for authentication (required by Colab runtime proxy)
      const headers: Record<string, string> = {
        [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]: this.token,
        [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
      };

      // Add Origin header if proxy URL is provided
      if (this.proxyUrl) {
        const origin = new URL(this.proxyUrl).origin;
        headers.Origin = origin;
      }

      this.ws = new WebSocket(url.toString(), { headers });

      this.ws.on("open", () => {
        this.isConnected = true;
        this.emit("connected");
        
        // Send any queued messages
        while (this.messageQueue.length > 0) {
          const msg = this.messageQueue.shift();
          if (msg && this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(msg);
          }
        }
        
        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const message = this.parseMessage(data);
          this.emit("message", message);
          this.handleMessage(message);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          this.emit("error", err);
        }
      });

      this.ws.on("error", (error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Provide more helpful error messages for common issues
        let enhancedError: Error;
        
        if (errorMessage.includes("404") || errorMessage.includes("Not Found")) {
          enhancedError = new Error(
            `WebSocket connection failed (404): Kernel endpoint not found. ` +
            `This usually means: ` +
            `1) The kernel ID is invalid or the kernel was deleted, ` +
            `2) The runtime proxy URL is incorrect, ` +
            `3) Authentication headers are missing or invalid. ` +
            `Try using --new-runtime to get a fresh kernel.`
          );
        } else if (errorMessage.includes("401") || errorMessage.includes("403")) {
          enhancedError = new Error(
            `WebSocket connection failed (${errorMessage.includes("401") ? "401" : "403"}): Authentication failed. ` +
            `The runtime proxy token may have expired. ` +
            `Try re-authenticating or using --new-runtime.`
          );
        } else if (errorMessage.includes("ECONNREFUSED") || errorMessage.includes("ENOTFOUND")) {
          enhancedError = new Error(
            `WebSocket connection failed: Cannot reach Colab runtime. ` +
            `This may indicate network issues or the runtime is unavailable. ` +
            `Check your internet connection and try again with --new-runtime.`
          );
        } else {
          enhancedError = new Error(`WebSocket connection error: ${errorMessage}`);
        }
        
        enhancedError.cause = error;
        this.emit("error", enhancedError);
        reject(enhancedError);
      });

      this.ws.on("close", (code, reason) => {
        this.isConnected = false;
        this.emit("disconnected", code, reason.toString());
      });
    });
  }

  /**
   * Parse incoming WebSocket message
   * 
   * Handles raw WebSocket data (Buffer or string) and delegates to
   * deserializeMessage which handles the various Jupyter wire formats.
   */
  private parseMessage(data: WebSocket.Data): JupyterMessage {
    // WebSocket.Data can be Buffer, ArrayBuffer, Buffer[], or string
    // Convert to Buffer or string for deserializeMessage
    if (Buffer.isBuffer(data)) {
      return deserializeMessage(data);
    } else if (typeof data === "string") {
      return deserializeMessage(data);
    } else if (data instanceof ArrayBuffer) {
      return deserializeMessage(Buffer.from(data));
    } else if (Array.isArray(data)) {
      // Multiple Buffer fragments - concatenate them
      // WebSocket.Data array is typed as Buffer[] but Buffer.concat needs Uint8Array[]
      // We know data is Buffer[] from the array check, so this cast is safe
      return deserializeMessage(Buffer.concat(data as unknown as Uint8Array[]));
    } else {
      throw new TypeError(`Unsupported WebSocket data type: ${typeof data}`);
    }
  }

  /**
   * Handle specific message types
   */
  private handleMessage(message: JupyterMessage): void {
    // Emit status changes
    if (message.header.msg_type === MessageType.STATUS) {
      try {
        const content = StatusContentSchema.parse(message.content);
        this.emit("status", content.execution_state);
      } catch {
        // Ignore invalid status messages
      }
    }
  }

  /**
   * Send a message to the kernel
   */
  private sendMessage<T>(message: JupyterMessage<T>): void {
    const serialized = serializeMessage(message);
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(serialized);
    } else {
      // Queue message if not connected
      this.messageQueue.push(serialized);
    }
  }

  /**
   * Execute code on the kernel and return structured results
   */
  async executeCode(
    code: string,
    options: ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const started = new Date();
    const request = createExecuteRequest(code, this.sessionId, options);
    const msg_id = request.header.msg_id;

    // Output size limits (1MB for stdout/stderr each)
    const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB
    let outputSize = 0;
    let outputTruncated = false;

    return new Promise((resolve, reject) => {
      const timeout = options.timeout_ms || 300000; // 5 minute default
      let timeoutHandle: NodeJS.Timeout | null = null;

      const result: ExecutionResult = {
        status: ReplyStatus.OK,
        execution_count: null,
        stdout: "",
        stderr: "",
        traceback: [],
        display_data: [],
      };

      const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        this.off("message", messageHandler);
      };

      const messageHandler = (message: JupyterMessage) => {
        if (!matchesParent(message, msg_id)) return;

        try {
          switch (message.header.msg_type) {
            case MessageType.EXECUTE_REPLY: {
              const content = ExecuteReplyContentSchema.parse(message.content);
              result.status = content.status;
              result.execution_count = content.execution_count;
              
              if (content.status === ReplyStatus.ERROR) {
                result.error = {
                  ename: content.ename || "UnknownError",
                  evalue: content.evalue || "",
                  traceback: content.traceback || [],
                };
                result.traceback = content.traceback || [];
              }
              
              const completed = new Date();
              result.timing = {
                started,
                completed,
                duration_ms: completed.getTime() - started.getTime(),
              };
              
              // Add truncation warning if output was truncated
              if (outputTruncated) {
                if (!result.stderr) {
                  result.stderr = "";
                }
                result.stderr += `\n[Output truncated: exceeded ${MAX_OUTPUT_SIZE / 1024}KB limit]\n`;
              }
              
              cleanup();
              resolve(result);
              break;
            }

            case MessageType.STREAM: {
              const content = StreamContentSchema.parse(message.content);
              const text = content.text || "";
              
              // Check output size limits
              if (outputSize + text.length > MAX_OUTPUT_SIZE) {
                outputTruncated = true;
                const remaining = MAX_OUTPUT_SIZE - outputSize;
                if (remaining > 0) {
                  if (content.name === "stdout") {
                    result.stdout += text.substring(0, remaining);
                  } else if (content.name === "stderr") {
                    result.stderr += text.substring(0, remaining);
                  }
                  outputSize = MAX_OUTPUT_SIZE;
                }
                // Stop collecting more output
                break;
              }
              
              if (content.name === "stdout") {
                result.stdout += text;
                outputSize += text.length;
              } else if (content.name === "stderr") {
                result.stderr += text;
                outputSize += text.length;
              }
              break;
            }

            case MessageType.ERROR: {
              const content = ErrorContentSchema.parse(message.content);
              result.error = {
                ename: content.ename,
                evalue: content.evalue,
                traceback: content.traceback,
              };
              result.traceback = content.traceback;
              break;
            }

            case MessageType.DISPLAY_DATA:
            case MessageType.EXECUTE_RESULT: {
              const content = DisplayDataContentSchema.parse(message.content);
              result.display_data.push(content);
              break;
            }

            case MessageType.STATUS: {
              // Status messages are informational, don't affect result
              break;
            }
          }
        } catch (error) {
          // Ignore parsing errors for individual messages
          if (process.env.LECODER_CGPU_DEBUG) {
            console.error("Error parsing message:", error);
          }
        }
      };

      this.on("message", messageHandler);

      // Set timeout with better error message
      timeoutHandle = setTimeout(() => {
        cleanup();
        const elapsed = Date.now() - started.getTime();
        reject(new Error(
          `Execution timed out after ${timeout}ms (elapsed: ${elapsed}ms). ` +
          `The code may be taking too long to execute. Consider: ` +
          `1) Breaking it into smaller chunks, ` +
          `2) Adding progress indicators, ` +
          `3) Using a longer timeout with --timeout option.`
        ));
      }, timeout);

      // Send execute request
      this.sendMessage(request);
    });
  }

  /**
   * Request kernel info
   */
  async getKernelInfo(): Promise<JupyterMessage> {
    const request = createKernelInfoRequest(this.sessionId);
    const msg_id = request.header.msg_id;

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.off("message", messageHandler);
        reject(new Error("Kernel info request timed out"));
      }, 10000);

      const messageHandler = (message: JupyterMessage) => {
        if (
          message.header.msg_type === MessageType.KERNEL_INFO_REPLY &&
          matchesParent(message, msg_id)
        ) {
          clearTimeout(timeoutHandle);
          this.off("message", messageHandler);
          resolve(message);
        }
      };

      this.on("message", messageHandler);
      this.sendMessage(request);
    });
  }

  /**
   * Interrupt the kernel
   */
  async interrupt(): Promise<void> {
    const request = createInterruptRequest(this.sessionId);
    this.sendMessage(request);
  }

  /**
   * Close the WebSocket connection
   */
  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.messageQueue = [];
  }

  /**
   * Check if client is connected
   */
  get connected(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get the session ID
   */
  get session(): string {
    return this.sessionId;
  }
}
