import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RemoteCommandRunner } from "../../src/runtime/remote-command-runner.js";
import { queryGpuInfo, formatMemory, calculateMemoryUsage } from "../../src/runtime/gpu-info.js";

describe("GPU Info", () => {
  let mockRunner: RemoteCommandRunner;

  beforeEach(() => {
    mockRunner = {
      runAndCapture: vi.fn(),
    } as unknown as RemoteCommandRunner;
  });

  describe("queryGpuInfo", () => {
    it("should parse nvidia-smi output correctly", async () => {
      mockRunner.runAndCapture = vi.fn().mockResolvedValue({
        stdout: "Tesla T4, 15109, 2048, 0\n",
        stderr: "",
        exitCode: 0,
      });

      const gpuInfo = await queryGpuInfo(mockRunner);

      expect(gpuInfo).not.toBeNull();
      expect(gpuInfo?.name).toBe("Tesla T4");
      expect(gpuInfo?.memoryTotal).toBe(15109);
      expect(gpuInfo?.memoryUsed).toBe(2048);
      expect(gpuInfo?.utilization).toBe(0);
    });

    it("should return null for CPU runtimes", async () => {
      mockRunner.runAndCapture = vi.fn().mockResolvedValue({
        stdout: "",
        stderr: "nvidia-smi: command not found",
        exitCode: 127,
      });

      const gpuInfo = await queryGpuInfo(mockRunner);

      expect(gpuInfo).toBeNull();
    });

    it("should handle parsing errors gracefully", async () => {
      mockRunner.runAndCapture = vi.fn().mockResolvedValue({
        stdout: "invalid output format",
        stderr: "",
        exitCode: 0,
      });

      const gpuInfo = await queryGpuInfo(mockRunner);

      expect(gpuInfo).toBeNull();
    });

    it("should handle nvidia-smi failures", async () => {
      mockRunner.runAndCapture = vi.fn().mockRejectedValue(
        new Error("Connection failed")
      );

      const gpuInfo = await queryGpuInfo(mockRunner);

      expect(gpuInfo).toBeNull();
    });

    it("should parse A100 GPU info", async () => {
      mockRunner.runAndCapture = vi.fn().mockResolvedValue({
        stdout: "NVIDIA A100-SXM4-40GB, 40960, 8192, 25\n",
        stderr: "",
        exitCode: 0,
      });

      const gpuInfo = await queryGpuInfo(mockRunner);

      expect(gpuInfo).not.toBeNull();
      expect(gpuInfo?.name).toBe("NVIDIA A100-SXM4-40GB");
      expect(gpuInfo?.memoryTotal).toBe(40960);
      expect(gpuInfo?.memoryUsed).toBe(8192);
      expect(gpuInfo?.utilization).toBe(25);
    });

    it("should handle decimal values in output", async () => {
      mockRunner.runAndCapture = vi.fn().mockResolvedValue({
        stdout: "Tesla V100, 16160.5, 3072.25, 15.7\n",
        stderr: "",
        exitCode: 0,
      });

      const gpuInfo = await queryGpuInfo(mockRunner);

      expect(gpuInfo).not.toBeNull();
      expect(gpuInfo?.memoryTotal).toBe(16161); // Rounded
      expect(gpuInfo?.memoryUsed).toBe(3072);   // Rounded
      expect(gpuInfo?.utilization).toBe(16);    // Rounded
    });
  });

  describe("formatMemory", () => {
    it("should format MB values", () => {
      expect(formatMemory(512)).toBe("512 MB");
      expect(formatMemory(1000)).toBe("1000 MB");
    });

    it("should format GB values", () => {
      expect(formatMemory(1024)).toBe("1.0 GB");
      expect(formatMemory(15360)).toBe("15.0 GB");
      expect(formatMemory(2560)).toBe("2.5 GB");
    });

    it("should handle edge cases", () => {
      expect(formatMemory(0)).toBe("0 MB");
      expect(formatMemory(1023)).toBe("1023 MB");
      expect(formatMemory(1025)).toBe("1.0 GB");
    });
  });

  describe("calculateMemoryUsage", () => {
    it("should calculate percentage correctly", () => {
      expect(calculateMemoryUsage(5000, 10000)).toBe(50);
      expect(calculateMemoryUsage(2048, 15360)).toBe(13);
      expect(calculateMemoryUsage(8192, 40960)).toBe(20);
    });

    it("should round to nearest integer", () => {
      expect(calculateMemoryUsage(3333, 10000)).toBe(33);
      expect(calculateMemoryUsage(6666, 10000)).toBe(67);
    });

    it("should handle edge cases", () => {
      expect(calculateMemoryUsage(0, 10000)).toBe(0);
      expect(calculateMemoryUsage(10000, 10000)).toBe(100);
      expect(calculateMemoryUsage(5000, 0)).toBe(0); // Avoid division by zero
    });
  });
});
