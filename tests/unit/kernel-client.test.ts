import { describe, it, expect } from "vitest";
import {
  MessageType,
  ExecutionState,
} from "../../src/jupyter/protocol.js";

// Simple tests that don't require mocking WebSocket
describe("JupyterKernelClient - Module", () => {
  it("should export JupyterKernelClient class", async () => {
    const module = await import("../../src/jupyter/kernel-client.js");
    expect(module.JupyterKernelClient).toBeDefined();
    expect(typeof module.JupyterKernelClient).toBe("function");
  });
});

describe("JupyterKernelClient - Constructor", () => {
  it("should create client with provided options", async () => {
    const { JupyterKernelClient } = await import(
      "../../src/jupyter/kernel-client.js"
    );
    const client = new JupyterKernelClient({
      kernelId: "test-kernel-id",
      wsUrl: "wss://example.com",
      token: "test-token",
      sessionId: "test-session-id",
    });

    expect(client.session).toBe("test-session-id");
  });

  it("should generate session ID if not provided", async () => {
    const { JupyterKernelClient } = await import(
      "../../src/jupyter/kernel-client.js"
    );
    const client = new JupyterKernelClient({
      kernelId: "test-kernel-id",
      wsUrl: "wss://example.com",
      token: "test-token",
    });

    expect(client.session).toBeDefined();
    expect(client.session.length).toBeGreaterThan(0);
  });
});

describe("JupyterKernelClient - Methods", () => {
  it("should have executeCode method", async () => {
    const { JupyterKernelClient } = await import(
      "../../src/jupyter/kernel-client.js"
    );
    const client = new JupyterKernelClient({
      kernelId: "test-kernel-id",
      wsUrl: "wss://example.com",
      token: "test-token",
    });

    expect(typeof client.executeCode).toBe("function");
  });

  it("should have interrupt method", async () => {
    const { JupyterKernelClient } = await import(
      "../../src/jupyter/kernel-client.js"
    );
    const client = new JupyterKernelClient({
      kernelId: "test-kernel-id",
      wsUrl: "wss://example.com",
      token: "test-token",
    });

    expect(typeof client.interrupt).toBe("function");
  });

  it("should have getKernelInfo method", async () => {
    const { JupyterKernelClient } = await import(
      "../../src/jupyter/kernel-client.js"
    );
    const client = new JupyterKernelClient({
      kernelId: "test-kernel-id",
      wsUrl: "wss://example.com",
      token: "test-token",
    });

    expect(typeof client.getKernelInfo).toBe("function");
  });

  it("should have connect method", async () => {
    const { JupyterKernelClient } = await import(
      "../../src/jupyter/kernel-client.js"
    );
    const client = new JupyterKernelClient({
      kernelId: "test-kernel-id",
      wsUrl: "wss://example.com",
      token: "test-token",
    });

    expect(typeof client.connect).toBe("function");
  });

  it("should have close method", async () => {
    const { JupyterKernelClient } = await import(
      "../../src/jupyter/kernel-client.js"
    );
    const client = new JupyterKernelClient({
      kernelId: "test-kernel-id",
      wsUrl: "wss://example.com",
      token: "test-token",
    });

    expect(typeof client.close).toBe("function");
  });
});

describe("JupyterKernelClient - Properties", () => {
  it("should start with connected = false", async () => {
    const { JupyterKernelClient } = await import(
      "../../src/jupyter/kernel-client.js"
    );
    const client = new JupyterKernelClient({
      kernelId: "test-kernel-id",
      wsUrl: "wss://example.com",
      token: "test-token",
    });

    expect(client.connected).toBe(false);
  });
});

describe("MessageType usage", () => {
  it("should have correct message type for status", () => {
    expect(MessageType.STATUS).toBe("status");
  });

  it("should have correct execution states", () => {
    expect(ExecutionState.BUSY).toBe("busy");
    expect(ExecutionState.IDLE).toBe("idle");
    expect(ExecutionState.STARTING).toBe("starting");
  });
});
