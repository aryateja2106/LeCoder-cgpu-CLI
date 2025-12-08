/**
 * Unit tests for RuntimeManager
 *
 * Tests runtime assignment, reuse, connection pooling, and error handling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TooManyAssignmentsError } from '../../src/colab/client.js';
import type { ColabClient } from '../../src/colab/client.js';
import type { Assignment, CcuInfo, ListedAssignment, RuntimeProxyInfo } from '../../src/colab/api.js';
import { Shape, SubscriptionState, SubscriptionTier, Variant } from '../../src/colab/api.js';
import { RuntimeManager } from '../../src/runtime/runtime-manager.js';

// Mock ColabClient that implements the interface RuntimeManager expects
class MockColabClient implements Partial<ColabClient> {
  private assignments: Map<string, ListedAssignment> = new Map();
  private assignmentCounter = 0;
  private shouldThrowTooManyAssignments = false;

  async getCcuInfo(): Promise<CcuInfo> {
    return {
      currentBalance: 100,
      consumptionRateHourly: 10,
      assignmentsCount: this.assignments.size,
      eligibleGpus: ['T4', 'V100', 'A100'],
      eligibleTpus: ['TPU_V2'],
    };
  }

  async assign(
    _notebookHash: string,
    variant: Variant,
    accelerator?: string,
  ): Promise<{ assignment: Assignment; isNew: boolean }> {
    if (this.shouldThrowTooManyAssignments) {
      throw new TooManyAssignmentsError('Too many assignments');
    }

    const endpoint = `endpoint-${++this.assignmentCounter}`;
    const actualAccelerator = this.getAcceleratorForVariant(variant, accelerator);

    const assignment: Assignment = {
      endpoint,
      accelerator: actualAccelerator,
      variant,
      machineShape: Shape.STANDARD,
      idleTimeoutSec: 3600,
      subscriptionState: SubscriptionState.UNSUBSCRIBED,
      subscriptionTier: SubscriptionTier.NONE,
      runtimeProxyInfo: {
        url: `https://runtime-${this.assignmentCounter}.example.com`,
        token: `token-${this.assignmentCounter}`,
        tokenExpiresInSeconds: 3600,
      },
    };

    this.assignments.set(endpoint, {
      endpoint,
      accelerator: actualAccelerator,
      variant,
      machineShape: Shape.STANDARD,
    });

    return { assignment, isNew: true };
  }

  private getAcceleratorForVariant(variant: Variant, accelerator?: string): string {
    if (accelerator) {
      return accelerator;
    }
    if (variant === Variant.GPU) {
      return 'T4';
    }
    if (variant === Variant.TPU) {
      return 'TPU_V2';
    }
    return 'CPU';
  }

  async listAssignments(): Promise<ListedAssignment[]> {
    return Array.from(this.assignments.values());
  }

  async refreshConnection(endpoint: string): Promise<RuntimeProxyInfo> {
    if (!this.assignments.has(endpoint)) {
      throw new Error(`No assignment found for endpoint: ${endpoint}`);
    }

    return {
      url: `https://runtime-refreshed.example.com`,
      token: `refreshed-token`,
      tokenExpiresInSeconds: 3600,
    };
  }

  // Test helper methods
  setMaxAssignmentsReached(value: boolean): void {
    this.shouldThrowTooManyAssignments = value;
  }

  reset(): void {
    this.assignments.clear();
    this.assignmentCounter = 0;
    this.shouldThrowTooManyAssignments = false;
  }

  getAssignmentCount(): number {
    return this.assignments.size;
  }
}

describe('RuntimeManager', () => {
  let client: MockColabClient;
  let manager: RuntimeManager;

  beforeEach(() => {
    client = new MockColabClient();
    manager = new RuntimeManager(client as unknown as ColabClient);
  });

  describe('assignRuntime', () => {
    it('should assign a GPU runtime with default accelerator', async () => {
      const runtime = await manager.assignRuntime({ variant: Variant.GPU, quiet: true });

      expect(runtime).toBeDefined();
      expect(runtime.label).toContain('GPU');
      expect(runtime.label).toContain('T4');
      expect(runtime.accelerator).toBe('T4');
      expect(runtime.proxy).toBeDefined();
      expect(runtime.proxy.token).toBeDefined();
      expect(client.getAssignmentCount()).toBe(1);
    });

    it('should assign a TPU runtime', async () => {
      const runtime = await manager.assignRuntime({ variant: Variant.TPU, quiet: true });

      expect(runtime).toBeDefined();
      expect(runtime.label).toContain('TPU');
      expect(runtime.accelerator).toBe('TPU_V2');
      expect(client.getAssignmentCount()).toBe(1);
    });

    it('should assign a CPU runtime', async () => {
      const runtime = await manager.assignRuntime({ variant: Variant.DEFAULT, quiet: true });

      expect(runtime).toBeDefined();
      expect(runtime.label).toContain('CPU');
      expect(client.getAssignmentCount()).toBe(1);
    });

    it('should reuse existing runtime when variant matches', async () => {
      const runtime1 = await manager.assignRuntime({ variant: Variant.GPU, quiet: true });
      const runtime2 = await manager.assignRuntime({ variant: Variant.GPU, quiet: true });

      expect(runtime1.endpoint).toBe(runtime2.endpoint);
      expect(client.getAssignmentCount()).toBe(1); // Only one assignment was made
    });

    it('should request new runtime when forceNew is true', async () => {
      await manager.assignRuntime({ variant: Variant.GPU, quiet: true });

      // Set the client to throw TooManyAssignmentsError on next assignment
      client.setMaxAssignmentsReached(true);

      // With forceNew=true, it should attempt a new assignment and get the error
      await expect(
        manager.assignRuntime({ variant: Variant.GPU, forceNew: true, quiet: true })
      ).rejects.toThrow();
    });

    it('should handle TooManyAssignmentsError by trying to reuse', async () => {
      // First create an assignment
      const runtime1 = await manager.assignRuntime({ variant: Variant.GPU, quiet: true });

      // Set the client to throw on next assignment
      client.setMaxAssignmentsReached(true);

      // Should reuse existing assignment instead of failing
      const runtime2 = await manager.assignRuntime({ variant: Variant.GPU, quiet: true });

      expect(runtime2.endpoint).toBe(runtime1.endpoint);
    });

    it('should throw when forceNew is true and hit assignment limit', async () => {
      await manager.assignRuntime({ variant: Variant.GPU, quiet: true });
      client.setMaxAssignmentsReached(true);

      await expect(
        manager.assignRuntime({ variant: Variant.GPU, forceNew: true, quiet: true })
      ).rejects.toThrow();
    });
  });

  describe('createKernelConnection', () => {
    it('should have createKernelConnection method', () => {
      // The actual implementation requires a real ColabConnection
      // For unit tests, we just verify the method exists and has the right signature
      expect(manager.createKernelConnection).toBeDefined();
      expect(typeof manager.createKernelConnection).toBe('function');
    });
  });
});
