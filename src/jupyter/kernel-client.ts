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

export interface KernelClientOptions {
  kernelId: string;
  wsUrl: string;
  token: string;
  sessionId?: string;
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
  private isConnected: boolean = false;
  private messageQueue: string[] = [];

  constructor(options: KernelClientOptions) {
    super();
    this.kernelId = options.kernelId;
    this.wsUrl = options.wsUrl;
    this.token = options.token;
    this.sessionId = options.sessionId || randomUUID();
  }

  /**
   * Connect to the Jupyter kernel WebSocket
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsEndpoint = `${this.wsUrl}/api/kernels/${this.kernelId}/channels`;
      
      // Add runtime proxy token as query parameter
      const url = new URL(wsEndpoint);
      url.searchParams.set("token", this.token);

      this.ws = new WebSocket(url.toString());

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
        this.emit("error", error);
        reject(error);
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
              
              cleanup();
              resolve(result);
              break;
            }

            case MessageType.STREAM: {
              const content = StreamContentSchema.parse(message.content);
              if (content.name === "stdout") {
                result.stdout += content.text;
              } else if (content.name === "stderr") {
                result.stderr += content.text;
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

      // Set timeout
      timeoutHandle = setTimeout(() => {
        cleanup();
        reject(new Error(`Execution timed out after ${timeout}ms`));
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
