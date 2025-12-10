import fs from "node:fs";

/**
 * Detect if running inside a Docker container or other containerized environment
 */
export function isRunningInContainer(): boolean {
  try {
    // Method 1: Check for .dockerenv file (most Docker containers)
    if (fs.existsSync("/.dockerenv")) {
      return true;
    }

    // Method 2: Check cgroup for docker/containerd
    const cgroup = fs.readFileSync("/proc/self/cgroup", "utf8");
    if (cgroup.includes("docker") || cgroup.includes("containerd") || cgroup.includes("kubepods")) {
      return true;
    }

    return false;
  } catch {
    // If we can't read these files, assume not in a container
    return false;
  }
}

/**
 * Get a human-readable environment description
 */
export function getEnvironmentType(): string {
  if (isRunningInContainer()) {
    return "container";
  }
  return "host";
}
