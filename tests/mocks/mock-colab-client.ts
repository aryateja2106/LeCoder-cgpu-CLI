/**
 * Mock ColabClient for testing
 *
 * Simulates Colab API responses for testing without live connections.
 * Supports configurable responses and error simulation.
 */

export interface RuntimeInfo {
  id: string;
  state: 'RUNNING' | 'STARTING' | 'STOPPING' | 'STOPPED' | 'ERROR';
  variant: 'GPU' | 'TPU' | 'CPU';
  gpuType?: string;
  createdAt: string;
  lastActivity: string;
}

export interface CcuInfo {
  remainingCcu: number;
  totalCcu: number;
  tier: 'free' | 'pro' | 'pro+';
  resetTime: string;
}

export interface Assignment {
  id: string;
  runtimeId: string;
  notebookId: string;
  createdAt: string;
}

export interface KernelInfo {
  id: string;
  state: 'idle' | 'busy' | 'starting' | 'dead';
  executionCount: number;
  lastActivity: string;
}

export interface MockColabClientConfig {
  defaultTier?: 'free' | 'pro' | 'pro+';
  simulateRateLimit?: boolean;
  simulateTransientError?: boolean;
  runtimeCreationDelay?: number;
  maxRuntimes?: number;
}

export interface MethodCall {
  method: string;
  args: unknown[];
  timestamp: Date;
}

export class MockColabClient {
  private runtimes: Map<string, RuntimeInfo> = new Map();
  private kernels: Map<string, KernelInfo> = new Map();
  private assignments: Map<string, Assignment> = new Map();
  private callHistory: MethodCall[] = [];
  private config: Required<MockColabClientConfig>;
  private requestCount = 0;

  constructor(config: MockColabClientConfig = {}) {
    this.config = {
      defaultTier: config.defaultTier ?? 'free',
      simulateRateLimit: config.simulateRateLimit ?? false,
      simulateTransientError: config.simulateTransientError ?? false,
      runtimeCreationDelay: config.runtimeCreationDelay ?? 10,
      maxRuntimes: config.maxRuntimes ?? 5,
    };
  }

  /**
   * Get CCU (Compute Units) information
   */
  async getCcuInfo(): Promise<CcuInfo> {
    this.recordCall('getCcuInfo', []);
    await this.checkForErrors();

    const tierLimits = {
      free: { total: 100, remaining: 80 },
      pro: { total: 500, remaining: 450 },
      'pro+': { total: 1000, remaining: 900 },
    };

    const limits = tierLimits[this.config.defaultTier];
    return {
      remainingCcu: limits.remaining,
      totalCcu: limits.total,
      tier: this.config.defaultTier,
      resetTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  /**
   * List active runtime assignments
   */
  async listAssignments(): Promise<Assignment[]> {
    this.recordCall('listAssignments', []);
    await this.checkForErrors();

    return Array.from(this.assignments.values());
  }

  /**
   * Create a new runtime
   */
  async createRuntime(variant: 'GPU' | 'TPU' | 'CPU' = 'GPU', gpuType?: string): Promise<RuntimeInfo> {
    this.recordCall('createRuntime', [variant, gpuType]);
    await this.checkForErrors();

    if (this.runtimes.size >= this.config.maxRuntimes) {
      throw new Error('Maximum number of runtimes reached');
    }

    // Simulate creation delay
    await this.delay(this.config.runtimeCreationDelay);

    const id = `runtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const runtime: RuntimeInfo = {
      id,
      state: 'RUNNING',
      variant,
      gpuType: variant === 'GPU' ? (gpuType ?? 'T4') : undefined,
      createdAt: now,
      lastActivity: now,
    };

    this.runtimes.set(id, runtime);
    return runtime;
  }

  /**
   * Delete a runtime
   */
  async deleteRuntime(runtimeId: string): Promise<void> {
    this.recordCall('deleteRuntime', [runtimeId]);
    await this.checkForErrors();

    if (!this.runtimes.has(runtimeId)) {
      throw new Error(`Runtime not found: ${runtimeId}`);
    }

    this.runtimes.delete(runtimeId);

    // Also clean up associated kernels and assignments
    for (const [kernelId, kernel] of this.kernels.entries()) {
      if (kernelId.includes(runtimeId)) {
        this.kernels.delete(kernelId);
      }
    }

    for (const [assignmentId, assignment] of this.assignments.entries()) {
      if (assignment.runtimeId === runtimeId) {
        this.assignments.delete(assignmentId);
      }
    }
  }

  /**
   * Get runtime information
   */
  async getRuntime(runtimeId: string): Promise<RuntimeInfo | null> {
    this.recordCall('getRuntime', [runtimeId]);
    await this.checkForErrors();

    return this.runtimes.get(runtimeId) ?? null;
  }

  /**
   * List all runtimes
   */
  async listRuntimes(): Promise<RuntimeInfo[]> {
    this.recordCall('listRuntimes', []);
    await this.checkForErrors();

    return Array.from(this.runtimes.values());
  }

  /**
   * List kernels for a runtime
   */
  async listKernels(runtimeId: string): Promise<KernelInfo[]> {
    this.recordCall('listKernels', [runtimeId]);
    await this.checkForErrors();

    if (!this.runtimes.has(runtimeId)) {
      throw new Error(`Runtime not found: ${runtimeId}`);
    }

    return Array.from(this.kernels.values()).filter((k) =>
      k.id.includes(runtimeId)
    );
  }

  /**
   * Create a kernel for a runtime
   */
  async createKernel(runtimeId: string): Promise<KernelInfo> {
    this.recordCall('createKernel', [runtimeId]);
    await this.checkForErrors();

    if (!this.runtimes.has(runtimeId)) {
      throw new Error(`Runtime not found: ${runtimeId}`);
    }

    const id = `${runtimeId}-kernel-${Date.now()}`;
    const now = new Date().toISOString();

    const kernel: KernelInfo = {
      id,
      state: 'idle',
      executionCount: 0,
      lastActivity: now,
    };

    this.kernels.set(id, kernel);
    return kernel;
  }

  /**
   * Delete a kernel
   */
  async deleteKernel(kernelId: string): Promise<void> {
    this.recordCall('deleteKernel', [kernelId]);
    await this.checkForErrors();

    if (!this.kernels.has(kernelId)) {
      throw new Error(`Kernel not found: ${kernelId}`);
    }

    this.kernels.delete(kernelId);
  }

  /**
   * Interrupt a kernel
   */
  async interruptKernel(kernelId: string): Promise<void> {
    this.recordCall('interruptKernel', [kernelId]);
    await this.checkForErrors();

    const kernel = this.kernels.get(kernelId);
    if (!kernel) {
      throw new Error(`Kernel not found: ${kernelId}`);
    }

    kernel.state = 'idle';
    kernel.lastActivity = new Date().toISOString();
  }

  /**
   * Create an assignment (link notebook to runtime)
   */
  async createAssignment(notebookId: string, runtimeId: string): Promise<Assignment> {
    this.recordCall('createAssignment', [notebookId, runtimeId]);
    await this.checkForErrors();

    if (!this.runtimes.has(runtimeId)) {
      throw new Error(`Runtime not found: ${runtimeId}`);
    }

    const id = `assignment-${Date.now()}`;
    const assignment: Assignment = {
      id,
      runtimeId,
      notebookId,
      createdAt: new Date().toISOString(),
    };

    this.assignments.set(id, assignment);
    return assignment;
  }

  // Test helper methods

  /**
   * Get method call history
   */
  getCallHistory(): MethodCall[] {
    return [...this.callHistory];
  }

  /**
   * Clear method call history
   */
  clearCallHistory(): void {
    this.callHistory = [];
  }

  /**
   * Get call count for a specific method
   */
  getCallCount(method: string): number {
    return this.callHistory.filter((c) => c.method === method).length;
  }

  /**
   * Add a pre-configured runtime
   */
  addRuntime(runtime: RuntimeInfo): void {
    this.runtimes.set(runtime.id, runtime);
  }

  /**
   * Update runtime state
   */
  setRuntimeState(runtimeId: string, state: RuntimeInfo['state']): void {
    const runtime = this.runtimes.get(runtimeId);
    if (runtime) {
      runtime.state = state;
      runtime.lastActivity = new Date().toISOString();
    }
  }

  /**
   * Update kernel state
   */
  setKernelState(kernelId: string, state: KernelInfo['state']): void {
    const kernel = this.kernels.get(kernelId);
    if (kernel) {
      kernel.state = state;
      kernel.lastActivity = new Date().toISOString();
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<MockColabClientConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.runtimes.clear();
    this.kernels.clear();
    this.assignments.clear();
    this.callHistory = [];
    this.requestCount = 0;
  }

  /**
   * Get current runtime count
   */
  getRuntimeCount(): number {
    return this.runtimes.size;
  }

  // Private helper methods

  private recordCall(method: string, args: unknown[]): void {
    this.callHistory.push({
      method,
      args,
      timestamp: new Date(),
    });
    this.requestCount++;
  }

  private async checkForErrors(): Promise<void> {
    // Simulate rate limiting (every 10th request)
    if (this.config.simulateRateLimit && this.requestCount % 10 === 0) {
      const error = new Error('Rate limit exceeded') as Error & { status: number };
      error.status = 429;
      throw error;
    }

    // Simulate transient error (every 5th request)
    if (this.config.simulateTransientError && this.requestCount % 5 === 0) {
      const error = new Error('Service temporarily unavailable') as Error & { status: number };
      error.status = 503;
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Factory function for creating pre-configured clients
export function createMockColabClient(
  preset: 'default' | 'pro' | 'rate-limited' | 'unstable' = 'default'
): MockColabClient {
  switch (preset) {
    case 'pro':
      return new MockColabClient({ defaultTier: 'pro', maxRuntimes: 10 });
    case 'rate-limited':
      return new MockColabClient({ simulateRateLimit: true });
    case 'unstable':
      return new MockColabClient({ simulateTransientError: true });
    default:
      return new MockColabClient();
  }
}
