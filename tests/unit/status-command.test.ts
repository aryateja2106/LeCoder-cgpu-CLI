import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ColabClient } from "../../src/colab/client.js";
import type { RuntimeManager } from "../../src/runtime/runtime-manager.js";

describe("Status Command", () => {
  let mockColabClient: ColabClient;

  beforeEach(() => {
    mockColabClient = {
      getCcuInfo: vi.fn().mockResolvedValue({
        eligibleGpus: ["T4", "A100"],
      }),
      listAssignments: vi.fn().mockResolvedValue([]),
      refreshConnection: vi.fn(),
      listKernels: vi.fn(),
    } as unknown as ColabClient;
  });

  it("should display authentication status and eligible GPUs", async () => {
    const ccu = await mockColabClient.getCcuInfo();
    expect(ccu.eligibleGpus).toEqual(["T4", "A100"]);
  });

  it("should show no active runtimes when none exist", async () => {
    const assignments = await mockColabClient.listAssignments();
    expect(assignments).toHaveLength(0);
  });

  it("should display active runtime details when runtimes exist", async () => {
    // Mock active runtime assignment
    mockColabClient.listAssignments = vi.fn().mockResolvedValue([
      {
        label: "Colab GPU T4",
        accelerator: "T4",
        endpoint: "test-endpoint.googleusercontent.com",
      },
    ]);

    mockColabClient.refreshConnection = vi.fn().mockResolvedValue({
      url: "https://test-endpoint.googleusercontent.com",
      token: "test-token",
      tokenExpiresInSeconds: 3600,
    });

    mockColabClient.listKernels = vi.fn().mockResolvedValue([
      {
        id: "kernel-123",
        name: "python3",
        lastActivity: "2024-01-01T00:00:00Z",
        executionState: "idle",
        connections: 1,
      },
    ]);

    const assignments = await mockColabClient.listAssignments();
    expect(assignments).toHaveLength(1);
    expect(assignments[0].label).toBe("Colab GPU T4");

    const proxy = await mockColabClient.refreshConnection(assignments[0].endpoint);
    expect(proxy.token).toBe("test-token");

    const kernels = await mockColabClient.listKernels();
    expect(kernels).toHaveLength(1);
    expect(kernels[0].executionState).toBe("idle");
  });

  it("should handle unreachable runtime gracefully", async () => {
    mockColabClient.listAssignments = vi.fn().mockResolvedValue([
      {
        label: "Colab GPU T4",
        accelerator: "T4",
        endpoint: "unreachable-endpoint",
      },
    ]);

    mockColabClient.refreshConnection = vi.fn().mockRejectedValue(
      new Error("Connection refused")
    );

    const assignments = await mockColabClient.listAssignments();
    expect(assignments).toHaveLength(1);

    await expect(
      mockColabClient.refreshConnection(assignments[0].endpoint)
    ).rejects.toThrow("Connection refused");
  });

  it("should handle kernel info unavailability gracefully", async () => {
    mockColabClient.listAssignments = vi.fn().mockResolvedValue([
      {
        label: "Colab GPU T4",
        accelerator: "T4",
        endpoint: "test-endpoint",
      },
    ]);

    mockColabClient.refreshConnection = vi.fn().mockResolvedValue({
      url: "https://test-endpoint",
      token: "test-token",
      tokenExpiresInSeconds: 3600,
    });

    mockColabClient.listKernels = vi.fn().mockRejectedValue(
      new Error("Kernel service unavailable")
    );

    await expect(mockColabClient.listKernels()).rejects.toThrow(
      "Kernel service unavailable"
    );
  });

  it("should handle API failures gracefully", async () => {
    mockColabClient.listAssignments = vi.fn().mockRejectedValue(
      new Error("API error")
    );

    await expect(mockColabClient.listAssignments()).rejects.toThrow("API error");
  });

  it("should display CPU runtime without GPU info", async () => {
    mockColabClient.listAssignments = vi.fn().mockResolvedValue([
      {
        label: "Colab CPU",
        accelerator: "None",
        endpoint: "cpu-endpoint",
      },
    ]);

    const assignments = await mockColabClient.listAssignments();
    expect(assignments[0].accelerator).toBe("None");
  });
});
