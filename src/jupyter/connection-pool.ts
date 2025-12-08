import { ColabClient } from "../colab/client.js";
import { AssignedRuntime } from "../runtime/runtime-manager.js";
import { ColabConnection, ConnectionState } from "./colab-connection.js";
import type { SubscriptionTier } from "../colab/api.js";

export interface ConnectionPoolOptions {
  /** Maximum connections for free tier */
  freeConnectionLimit?: number;
  /** Maximum connections for Pro tier */
  proConnectionLimit?: number;
  /** Keep-alive interval in ms */
  keepAliveIntervalMs?: number;
  /** Health check interval in ms */
  healthCheckIntervalMs?: number;
}

const DEFAULT_FREE_CONNECTION_LIMIT = 1;
const DEFAULT_PRO_CONNECTION_LIMIT = 5;
const DEFAULT_KEEP_ALIVE_INTERVAL_MS = 60_000;
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30_000;

/**
 * Manages a pool of Colab kernel connections for multi-instance support
 */
export class ConnectionPool {
  private static instance: ConnectionPool | null = null;

  private readonly connections: Map<string, ColabConnection> = new Map();
  private readonly options: Required<ConnectionPoolOptions>;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private subscriptionTier: SubscriptionTier = 0; // Default to NONE

  private constructor(options: ConnectionPoolOptions = {}) {
    this.options = {
      freeConnectionLimit:
        options.freeConnectionLimit ?? DEFAULT_FREE_CONNECTION_LIMIT,
      proConnectionLimit:
        options.proConnectionLimit ?? DEFAULT_PRO_CONNECTION_LIMIT,
      keepAliveIntervalMs:
        options.keepAliveIntervalMs ?? DEFAULT_KEEP_ALIVE_INTERVAL_MS,
      healthCheckIntervalMs:
        options.healthCheckIntervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS,
    };
  }

  /**
   * Get singleton instance
   */
  static getInstance(options?: ConnectionPoolOptions): ConnectionPool {
    if (!ConnectionPool.instance) {
      ConnectionPool.instance = new ConnectionPool(options);
    }
    return ConnectionPool.instance;
  }

  /**
   * Reset singleton instance (for testing)
   */
  static resetInstance(): void {
    if (ConnectionPool.instance) {
      void ConnectionPool.instance.closeAll();
      ConnectionPool.instance = null;
    }
  }

  /**
   * Set subscription tier to adjust connection limits
   */
  setSubscriptionTier(tier: SubscriptionTier): void {
    this.subscriptionTier = tier;
  }

  /**
   * Get or create a connection for a runtime
   */
  async getOrCreateConnection(
    runtime: AssignedRuntime,
    colabClient: ColabClient
  ): Promise<ColabConnection> {
    const key = this.getConnectionKey(runtime);

    // Check for existing healthy connection
    const existing = this.connections.get(key);
    if (existing && this.isConnectionHealthy(existing)) {
      return existing;
    }

    // Remove unhealthy connection if it exists
    if (existing) {
      await this.closeConnection(key);
    }

    // Check connection limit
    const limit = this.getConnectionLimit();
    if (this.connections.size >= limit) {
      throw new Error(
        `Connection limit reached (${limit}). Close existing connections or upgrade to Colab Pro.`
      );
    }

    // Create new connection
    const connection = new ColabConnection(runtime, colabClient);
    await connection.initialize();

    this.connections.set(key, connection);
    this.startKeepAlive();

    return connection;
  }

  /**
   * Get connection key from runtime
   */
  private getConnectionKey(runtime: AssignedRuntime): string {
    return runtime.endpoint;
  }

  /**
   * Check if a connection is healthy
   */
  private isConnectionHealthy(connection: ColabConnection): boolean {
    const state = connection.getState();
    return (
      state === ConnectionState.CONNECTED ||
      state === ConnectionState.RECONNECTING
    );
  }

  /**
   * Get connection limit based on subscription tier
   */
  private getConnectionLimit(): number {
    // SubscriptionTier: 0 = NONE, 1 = PRO, 2 = PRO_PLUS
    if (this.subscriptionTier >= 1) {
      return this.options.proConnectionLimit;
    }
    return this.options.freeConnectionLimit;
  }

  /**
   * List all active connections
   */
  listConnections(): ColabConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get a specific connection by endpoint
   */
  getConnection(endpoint: string): ColabConnection | undefined {
    return this.connections.get(endpoint);
  }

  /**
   * Close a specific connection
   */
  async closeConnection(key: string): Promise<void> {
    const connection = this.connections.get(key);
    if (connection) {
      try {
        await connection.shutdown();
      } catch (error) {
        if (process.env.LECODER_CGPU_DEBUG) {
          console.error(`Error closing connection ${key}:`, error);
        }
      }
      this.connections.delete(key);
    }

    // Stop timers if no connections
    if (this.connections.size === 0) {
      this.stopTimers();
    }
  }

  /**
   * Close all connections
   */
  async closeAll(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const [key] of this.connections) {
      closePromises.push(this.closeConnection(key));
    }

    await Promise.allSettled(closePromises);
    this.stopTimers();
  }

  /**
   * Start keep-alive mechanism
   */
  private startKeepAlive(): void {
    if (this.keepAliveTimer) return;

    this.keepAliveTimer = setInterval(() => {
      void this.sendKeepAlives();
    }, this.options.keepAliveIntervalMs);

    this.healthCheckTimer = setInterval(() => {
      void this.performHealthChecks();
    }, this.options.healthCheckIntervalMs);
  }

  /**
   * Stop timers
   */
  private stopTimers(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Send keep-alive messages to all kernels
   */
  private async sendKeepAlives(): Promise<void> {
    for (const connection of this.connections.values()) {
      if (connection.connected) {
        try {
          const client = await connection.getKernelClient();
          // Send kernel_info_request as keep-alive
          await client.getKernelInfo();
        } catch (error) {
          if (process.env.LECODER_CGPU_DEBUG) {
            console.error("Keep-alive failed:", error);
          }
        }
      }
    }
  }

  /**
   * Perform health checks on all connections
   */
  private async performHealthChecks(): Promise<void> {
    const deadConnections: string[] = [];

    for (const [key, connection] of this.connections) {
      const state = connection.getState();
      if (state === ConnectionState.FAILED) {
        deadConnections.push(key);
      }
    }

    // Remove dead connections
    for (const key of deadConnections) {
      await this.closeConnection(key);
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): ConnectionPoolStats {
    let connected = 0;
    let reconnecting = 0;
    let failed = 0;

    for (const connection of this.connections.values()) {
      switch (connection.getState()) {
        case ConnectionState.CONNECTED:
          connected++;
          break;
        case ConnectionState.RECONNECTING:
          reconnecting++;
          break;
        case ConnectionState.FAILED:
          failed++;
          break;
      }
    }

    return {
      total: this.connections.size,
      connected,
      reconnecting,
      failed,
      limit: this.getConnectionLimit(),
    };
  }
}

export interface ConnectionPoolStats {
  total: number;
  connected: number;
  reconnecting: number;
  failed: number;
  limit: number;
}
