import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { ColabClient } from "../colab/client.js";
import { AssignedRuntime } from "../runtime/runtime-manager.js";
import { JupyterKernelClient } from "./kernel-client.js";
import type { ExecutionResult, ExecuteOptions } from "./protocol.js";
import type { Session, Kernel } from "../colab/api.js";

export enum ConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  FAILED = "failed",
}

export interface ColabConnectionEvents {
  connected: () => void;
  disconnected: () => void;
  reconnecting: (attempt: number, maxAttempts: number) => void;
  error: (error: Error) => void;
  stateChange: (state: ConnectionState) => void;
}

export interface ColabConnectionOptions {
  /** Maximum number of reconnection attempts */
  maxReconnectAttempts?: number;
  /** Base delay for exponential backoff in ms */
  reconnectBaseDelay?: number;
  /** Notebook path for session creation */
  notebookPath?: string;
  /** Kernel name for session creation */
  kernelName?: string;
  /** Timeout for kernel readiness check in ms */
  kernelReadyTimeout?: number;
  /** Poll interval for kernel readiness check in ms */
  kernelReadyPollInterval?: number;
}

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const DEFAULT_RECONNECT_BASE_DELAY = 1000;
const DEFAULT_NOTEBOOK_PATH = "/content/lecoder.ipynb";
const DEFAULT_KERNEL_NAME = "python3";
const DEFAULT_KERNEL_READY_TIMEOUT = 30000; // 30 seconds
const DEFAULT_KERNEL_READY_POLL_INTERVAL = 1000; // 1 second

/**
 * Manages Jupyter kernel lifecycle and state for Colab connections
 */
export class ColabConnection extends EventEmitter {
  private readonly runtime: AssignedRuntime;
  private readonly colabClient: ColabClient;
  private readonly options: Required<ColabConnectionOptions>;

  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private kernelClient: JupyterKernelClient | null = null;
  private session: Session | null = null;
  private kernelId: string | null = null;
  private sessionId: string = randomUUID();
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private currentToken: string;
  private currentProxyUrl: string;

  constructor(
    runtime: AssignedRuntime,
    colabClient: ColabClient,
    options: ColabConnectionOptions = {}
  ) {
    super();
    this.runtime = runtime;
    this.colabClient = colabClient;
    this.currentToken = runtime.proxy.token;
    this.currentProxyUrl = runtime.proxy.url;
    this.options = {
      maxReconnectAttempts:
        options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS,
      reconnectBaseDelay:
        options.reconnectBaseDelay ?? DEFAULT_RECONNECT_BASE_DELAY,
      notebookPath: options.notebookPath ?? DEFAULT_NOTEBOOK_PATH,
      kernelName: options.kernelName ?? DEFAULT_KERNEL_NAME,
      kernelReadyTimeout:
        options.kernelReadyTimeout ?? DEFAULT_KERNEL_READY_TIMEOUT,
      kernelReadyPollInterval:
        options.kernelReadyPollInterval ?? DEFAULT_KERNEL_READY_POLL_INTERVAL,
    };
  }

  /**
   * Wait for kernel to be ready by polling its status
   */
  private async waitForKernelReady(): Promise<void> {
    if (!this.kernelId) {
      throw new Error("Kernel ID not set. Initialize session first.");
    }

    const startTime = Date.now();
    const timeout = this.options.kernelReadyTimeout;
    const pollInterval = this.options.kernelReadyPollInterval;

    if (process.env.LECODER_CGPU_DEBUG) {
      console.log(
        `Waiting for kernel ${this.kernelId} to be ready (timeout: ${timeout}ms, poll interval: ${pollInterval}ms)`
      );
    }

    while (Date.now() - startTime < timeout) {
      try {
        const kernel = await this.getStatus();
        
        if (process.env.LECODER_CGPU_DEBUG) {
          console.log(
            `Kernel ${this.kernelId} status: ${kernel.executionState}, connections: ${kernel.connections}`
          );
        }

        // Kernel is ready when it's in a stable state and can accept connections
        // Typical states: "idle" (ready), "busy" (executing), "starting" (initializing)
        if (kernel.executionState === "idle" || kernel.executionState === "busy") {
          if (process.env.LECODER_CGPU_DEBUG) {
            console.log(`Kernel ${this.kernelId} is ready for WebSocket connection`);
          }
          return;
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        if (process.env.LECODER_CGPU_DEBUG) {
          console.warn(`Error checking kernel status: ${error}`);
        }
        
        // Continue polling on transient errors
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    throw new Error(
      `Kernel ${this.kernelId} failed to become ready within ${timeout}ms`
    );
  }

  /**
   * Initialize the connection by creating a Jupyter session
   */
  async initialize(): Promise<void> {
    this.setState(ConnectionState.CONNECTING);

    try {
      // Create or fetch existing session
      this.session = await this.createSession();
      this.kernelId = this.session.kernel.id;

      if (process.env.LECODER_CGPU_DEBUG) {
        console.log(`Session created: ${this.session.id}`);
        console.log(`Kernel ID: ${this.kernelId}`);
      }

      // Wait for kernel to be ready before attempting WebSocket connection
      await this.waitForKernelReady();

      // Connect the kernel client
      await this.connectKernelClient();
    } catch (error) {
      this.setState(ConnectionState.FAILED);
      throw error;
    }
  }

  /**
   * Create a Jupyter session via REST API
   */
  private async createSession(): Promise<Session> {
    const session = await this.colabClient.createSession(
      this.options.notebookPath,
      this.options.kernelName,
      this.currentProxyUrl,
      this.currentToken
    );
    return session;
  }

  /**
   * Connect the WebSocket kernel client
   */
  private async connectKernelClient(): Promise<void> {
    if (!this.kernelId) {
      throw new Error("Kernel ID not set. Initialize first.");
    }

    const wsUrl = this.buildWsUrl();

    this.kernelClient = new JupyterKernelClient({
      kernelId: this.kernelId,
      wsUrl,
      token: this.currentToken,
      sessionId: this.sessionId,
    });

    this.setupClientEventHandlers();
    await this.kernelClient.connect();

    this.reconnectAttempts = 0;
    this.setState(ConnectionState.CONNECTED);
    this.emit("connected");
  }

  /**
   * Build WebSocket URL from current proxy URL
   */
  private buildWsUrl(): string {
    const proxyUrl = new URL(this.currentProxyUrl);
    // Convert https to wss, http to ws
    proxyUrl.protocol = proxyUrl.protocol === "https:" ? "wss:" : "ws:";
    // Remove trailing slash
    return proxyUrl.toString().replace(/\/$/, "");
  }

  /**
   * Setup event handlers for the kernel client
   */
  private setupClientEventHandlers(): void {
    if (!this.kernelClient) return;

    this.kernelClient.on("disconnected", (_code: number, _reason: string) => {
      this.handleDisconnection();
    });

    this.kernelClient.on("error", (error: Error) => {
      this.emit("error", error);
    });
  }

  /**
   * Handle WebSocket disconnection with automatic reconnection
   */
  private handleDisconnection(): void {
    if (this.state === ConnectionState.FAILED) return;

    this.emit("disconnected");

    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.setState(ConnectionState.FAILED);
      this.emit("error", new Error("Max reconnection attempts exceeded"));
      return;
    }

    this.scheduleReconnect();
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    const delay = this.calculateBackoffDelay();
    this.reconnectAttempts++;

    this.setState(ConnectionState.RECONNECTING);
    this.emit(
      "reconnecting",
      this.reconnectAttempts,
      this.options.maxReconnectAttempts
    );

    if (process.env.LECODER_CGPU_DEBUG) {
      console.log(
        `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts})`
      );
    }

    this.reconnectTimer = setTimeout(() => {
      void this.attemptReconnect();
    }, delay);
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    return this.options.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts);
  }

  /**
   * Attempt to reconnect to the kernel
   */
  private async attemptReconnect(): Promise<void> {
    try {
      // Refresh the runtime proxy token and URL
      const proxyInfo = await this.colabClient.refreshConnection(
        this.runtime.endpoint
      );
      this.currentToken = proxyInfo.token;
      this.currentProxyUrl = proxyInfo.url;

      // Close existing client
      if (this.kernelClient) {
        this.kernelClient.removeAllListeners();
        this.kernelClient.close();
      }

      // Wait for kernel to be ready before attempting WebSocket connection
      await this.waitForKernelReady();

      // Reconnect
      await this.connectKernelClient();
    } catch (error) {
      if (process.env.LECODER_CGPU_DEBUG) {
        console.error("Reconnection failed:", error);
      }
      this.handleDisconnection();
    }
  }

  /**
   * Update connection state and emit event
   */
  private setState(state: ConnectionState): void {
    this.state = state;
    this.emit("stateChange", state);
  }

  /**
   * Get the kernel client, ensuring it's connected
   */
  async getKernelClient(): Promise<JupyterKernelClient> {
    if (this.kernelClient?.connected) {
      return this.kernelClient;
    }

    if (this.state === ConnectionState.DISCONNECTED) {
      await this.initialize();
    } else if (this.state === ConnectionState.RECONNECTING) {
      // Wait for reconnection
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout waiting for reconnection"));
        }, 30000);

        const onConnected = () => {
          clearTimeout(timeout);
          this.off("error", onError);
          if (this.kernelClient) {
            resolve(this.kernelClient);
          } else {
            reject(new Error("Kernel client not available after reconnection"));
          }
        };

        const onError = (error: Error) => {
          clearTimeout(timeout);
          this.off("connected", onConnected);
          reject(error);
        };

        this.once("connected", onConnected);
        this.once("error", onError);
      });
    }

    if (!this.kernelClient) {
      throw new Error("Kernel client not available");
    }

    return this.kernelClient;
  }

  /**
   * Execute code on the kernel
   */
  async executeCode(
    code: string,
    options?: ExecuteOptions
  ): Promise<ExecutionResult> {
    const client = await this.getKernelClient();
    return client.executeCode(code, options);
  }

  /**
   * Get current kernel status via REST API
   */
  async getStatus(): Promise<Kernel> {
    if (!this.kernelId) {
      throw new Error("Kernel not initialized");
    }
    return this.colabClient.getKernel(
      this.kernelId,
      this.currentProxyUrl,
      this.currentToken
    );
  }

  /**
   * Interrupt the kernel
   */
  async interrupt(): Promise<void> {
    const client = await this.getKernelClient();
    await client.interrupt();
  }

  /**
   * Shutdown the connection and optionally delete the kernel
   */
  async shutdown(deleteKernel: boolean = false): Promise<void> {
    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close WebSocket
    if (this.kernelClient) {
      this.kernelClient.removeAllListeners();
      this.kernelClient.close();
      this.kernelClient = null;
    }

    // Delete kernel if requested
    if (deleteKernel && this.kernelId) {
      try {
        await this.colabClient.deleteKernel(
          this.kernelId,
          this.currentProxyUrl,
          this.currentToken
        );
      } catch (error) {
        if (process.env.LECODER_CGPU_DEBUG) {
          console.error("Failed to delete kernel:", error);
        }
      }
    }

    this.setState(ConnectionState.DISCONNECTED);
    this.kernelId = null;
    this.session = null;
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get kernel ID
   */
  getKernelId(): string | null {
    return this.kernelId;
  }

  /**
   * Get session
   */
  getSession(): Session | null {
    return this.session;
  }

  /**
   * Get runtime info
   */
  getRuntime(): AssignedRuntime {
    return this.runtime;
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.state === ConnectionState.CONNECTED && !!this.kernelClient?.connected;
  }
}
