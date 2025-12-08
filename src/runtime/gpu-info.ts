import type { RemoteCommandRunner } from "./remote-command-runner.js";

/**
 * GPU information structure
 */
export interface GpuInfo {
  name: string;
  memoryTotal: number; // MB
  memoryUsed: number;  // MB
  utilization: number; // percentage
}

/**
 * Query GPU information from a Colab runtime using nvidia-smi
 * 
 * @param runner - Remote command runner instance
 * @returns GPU info object or null if not available (CPU runtime)
 */
export async function queryGpuInfo(
  runner: RemoteCommandRunner
): Promise<GpuInfo | null> {
  try {
    // Execute nvidia-smi with CSV output format
    const command = "nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv,noheader,nounits";
    
    // Run the command and capture output
    const result = await runner.runAndCapture(command);
    
    // If nvidia-smi fails, this is likely a CPU-only runtime
    if (result.exitCode !== 0) {
      return null;
    }
    
    // Parse the CSV output
    const line = result.stdout.trim();
    if (!line) {
      return null;
    }
    
    // Split CSV line: name, memory.total, memory.used, utilization.gpu
    const parts = line.split(",").map(p => p.trim());
    if (parts.length < 4) {
      return null;
    }
    
    const name = parts[0];
    const memoryTotal = Number.parseFloat(parts[1]);
    const memoryUsed = Number.parseFloat(parts[2]);
    const utilization = Number.parseFloat(parts[3]);
    
    // Validate parsed values
    if (Number.isNaN(memoryTotal) || Number.isNaN(memoryUsed) || Number.isNaN(utilization)) {
      return null;
    }
    
    return {
      name,
      memoryTotal: Math.round(memoryTotal),
      memoryUsed: Math.round(memoryUsed),
      utilization: Math.round(utilization),
    };
    
  } catch {
    // nvidia-smi not found or runtime error
    return null;
  }
}

/**
 * Format bytes to human-readable string
 * 
 * @param mb - Memory in megabytes
 * @returns Formatted string (e.g., "15.0 GB", "512 MB")
 */
export function formatMemory(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${mb} MB`;
}

/**
 * Calculate memory usage percentage
 * 
 * @param used - Used memory in MB
 * @param total - Total memory in MB
 * @returns Percentage (0-100)
 */
export function calculateMemoryUsage(used: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((used / total) * 100);
}
