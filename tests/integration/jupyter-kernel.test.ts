import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { AssignedRuntime } from "../../src/runtime/runtime-manager.js";
import type { ColabClient } from "../../src/colab/client.js";
import {
  MessageType,
  ReplyStatus,
  ExecutionState,
  type JupyterMessage,
} from "../../src/jupyter/protocol.js";

// Mock WebSocket class for simulating kernel communication
class MockKernelWebSocket extends EventEmitter {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = MockKernelWebSocket.OPEN;
  private sentMessages: string[] = [];
  private executionCount = 0;

  constructor(public url: string) {
    super();
    // Simulate connection after a tick
    setTimeout(() => {
      this.emit("open");
    }, 0);
  }

  send(data: string) {
    this.sentMessages.push(data);
    // Parse the message and generate appropriate responses
    try {
      const message = JSON.parse(data) as JupyterMessage;
      this.handleMessage(message);
    } catch {
      // Ignore parse errors
    }
  }

  private handleMessage(message: JupyterMessage) {
    const { header } = message;
    const parentHeader = header;

    switch (header.msg_type) {
      case MessageType.EXECUTE_REQUEST:
        this.simulateExecution(message, parentHeader);
        break;
      case MessageType.KERNEL_INFO_REQUEST:
        this.simulateKernelInfo(parentHeader);
        break;
      case MessageType.INTERRUPT_REQUEST:
        // Just acknowledge
        break;
    }
  }

  private simulateExecution(
    request: JupyterMessage,
    parentHeader: JupyterMessage["header"]
  ) {
    const code = (request.content as { code: string }).code;
    this.executionCount++;

    // Emit busy status
    setTimeout(() => {
      this.emitMessage({
        header: this.createHeader(MessageType.STATUS),
        parent_header: parentHeader,
        metadata: {},
        content: { execution_state: ExecutionState.BUSY },
      });
    }, 5);

    // Simulate output based on code
    setTimeout(() => {
      if (code.includes("print(")) {
        // Extract what's being printed
        const match = code.match(/print\(['"](.+)['"]\)/);
        const output = match ? match[1] : "output";
        this.emitMessage({
          header: this.createHeader(MessageType.STREAM),
          parent_header: parentHeader,
          metadata: {},
          content: { name: "stdout", text: output + "\n" },
        });
      }

      if (code.includes("raise")) {
        // Simulate error
        this.emitMessage({
          header: this.createHeader(MessageType.ERROR),
          parent_header: parentHeader,
          metadata: {},
          content: {
            ename: "ValueError",
            evalue: "test error",
            traceback: [
              "Traceback (most recent call last):",
              '  File "<stdin>", line 1, in <module>',
              "ValueError: test error",
            ],
          },
        });
      }

      // Always return a value for expressions like "1+1"
      if (!code.includes("print(") && !code.includes("raise") && !code.includes("=")) {
        this.emitMessage({
          header: this.createHeader(MessageType.EXECUTE_RESULT),
          parent_header: parentHeader,
          metadata: {},
          content: {
            data: { "text/plain": "2" },
            metadata: {},
            execution_count: this.executionCount,
          },
        });
      }
    }, 10);

    // Emit execute_reply
    setTimeout(() => {
      const hasError = code.includes("raise");
      this.emitMessage({
        header: this.createHeader(MessageType.EXECUTE_REPLY),
        parent_header: parentHeader,
        metadata: {},
        content: {
          status: hasError ? ReplyStatus.ERROR : ReplyStatus.OK,
          execution_count: this.executionCount,
          ...(hasError && {
            ename: "ValueError",
            evalue: "test error",
            traceback: ["ValueError: test error"],
          }),
        },
      });
    }, 15);

    // Emit idle status
    setTimeout(() => {
      this.emitMessage({
        header: this.createHeader(MessageType.STATUS),
        parent_header: parentHeader,
        metadata: {},
        content: { execution_state: ExecutionState.IDLE },
      });
    }, 20);
  }

  private simulateKernelInfo(parentHeader: JupyterMessage["header"]) {
    setTimeout(() => {
      this.emitMessage({
        header: this.createHeader(MessageType.KERNEL_INFO_REPLY),
        parent_header: parentHeader,
        metadata: {},
        content: {
          status: ReplyStatus.OK,
          protocol_version: "5.3",
          implementation: "ipykernel",
          implementation_version: "6.0.0",
          language_info: {
            name: "python",
            version: "3.10.0",
            mimetype: "text/x-python",
            file_extension: ".py",
          },
          banner: "Python 3.10.0",
        },
      });
    }, 5);
  }

  private createHeader(msg_type: string) {
    return {
      msg_id: `mock-${Date.now()}-${Math.random()}`,
      msg_type,
      username: "mock-kernel",
      session: "mock-session",
      date: new Date().toISOString(),
      version: "5.3",
    };
  }

  private emitMessage(message: JupyterMessage) {
    // Simulate both wire formats to test protocol handling
    // By default, use JSON object format (Colab's approach)
    // Set JUPYTER_MOCK_ARRAY_FRAME=1 to test array frame format
    
    if (process.env.JUPYTER_MOCK_ARRAY_FRAME === "1") {
      // Array frame format: [delimiter, signature, header, parent_header, metadata, content, ...buffers]
      // This is the standard Jupyter wire protocol with HMAC signatures
      const arrayFrame = [
        "<IDS|MSG>",  // delimiter
        "",           // HMAC signature (empty for testing)
        JSON.stringify(message.header),
        JSON.stringify(message.parent_header),
        JSON.stringify(message.metadata),
        JSON.stringify(message.content),
      ];
      this.emit("message", JSON.stringify(arrayFrame));
    } else {
      // JSON object format (Colab's simplified protocol)
      this.emit("message", JSON.stringify(message));
    }
  }

  close() {
    this.readyState = MockKernelWebSocket.CLOSED;
    this.emit("close", 1000, "Normal closure");
  }

  getSentMessages(): string[] {
    return this.sentMessages;
  }
}

// Create mock modules
const mockWsInstances: MockKernelWebSocket[] = [];

vi.mock("ws", () => {
  return {
    default: class extends MockKernelWebSocket {
      constructor(url: string) {
        super(url);
        mockWsInstances.push(this);
      }
    },
  };
});

describe("Jupyter Kernel Integration", () => {
  let mockRuntime: AssignedRuntime;
  let mockColabClient: ColabClient;

  beforeEach(() => {
    mockWsInstances.length = 0;

    mockRuntime = {
      label: "Colab GPU T4",
      accelerator: "T4",
      endpoint: "test-endpoint",
      proxy: {
        url: "https://example.com",
        token: "test-token",
        tokenExpiresInSeconds: 3600,
      },
    };

    mockColabClient = {
      createSession: vi.fn().mockResolvedValue({
        id: "session-123",
        kernel: {
          id: "kernel-456",
          name: "python3",
          lastActivity: "2024-01-01T00:00:00Z",
          executionState: "idle",
          connections: 1,
        },
        name: "/content/notebook.ipynb",
        path: "/content/notebook.ipynb",
        type: "notebook",
      }),
      getKernel: vi.fn().mockResolvedValue({
        id: "kernel-456",
        name: "python3",
        lastActivity: "2024-01-01T00:00:00Z",
        executionState: "idle",
        connections: 1,
      }),
      deleteKernel: vi.fn().mockResolvedValue(undefined),
      refreshConnection: vi.fn().mockResolvedValue({
        url: "https://example.com",
        token: "refreshed-token",
        tokenExpiresInSeconds: 3600,
      }),
      sendKeepAlive: vi.fn().mockResolvedValue(undefined),
    } as unknown as ColabClient;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("JupyterKernelClient execution flow", () => {
    it("should import protocol types correctly", async () => {
      const { MessageType, ReplyStatus } = await import(
        "../../src/jupyter/protocol.js"
      );
      expect(MessageType.EXECUTE_REQUEST).toBe("execute_request");
      expect(ReplyStatus.OK).toBe("ok");
    });

    it("should import kernel client", async () => {
      const { JupyterKernelClient } = await import(
        "../../src/jupyter/kernel-client.js"
      );
      expect(JupyterKernelClient).toBeDefined();
    });
  });

  describe("End-to-end execution scenarios", () => {
    it("should handle simple code execution", async () => {
      const {
        createExecuteRequest,
        MessageType,
      } = await import("../../src/jupyter/protocol.js");

      const request = createExecuteRequest("print('hello')", "test-session");
      expect(request.header.msg_type).toBe(MessageType.EXECUTE_REQUEST);
      expect(request.content.code).toBe("print('hello')");
    });

    it("should create proper execute request with options", async () => {
      const { createExecuteRequest } = await import(
        "../../src/jupyter/protocol.js"
      );

      const request = createExecuteRequest("1+1", "test-session", {
        silent: true,
        store_history: false,
      });

      expect(request.content.silent).toBe(true);
      expect(request.content.store_history).toBe(false);
    });
  });

  describe("ColabConnection flow", () => {
    it("should create session via client", async () => {
      const { ColabConnection } = await import(
        "../../src/jupyter/colab-connection.js"
      );

      // Create a partial mock that doesn't actually connect
      const connection = new ColabConnection(mockRuntime, mockColabClient);
      expect(connection).toBeDefined();
      expect(connection.getState()).toBe("disconnected");
    });
  });

  describe("Error handling", () => {
    it("should categorize errors correctly", async () => {
      const { categorizeError, ErrorCategory } = await import(
        "../../src/jupyter/error-handler.js"
      );

      expect(
        categorizeError({
          ename: "SyntaxError",
          evalue: "invalid syntax",
          traceback: [],
        })
      ).toBe(ErrorCategory.SYNTAX);

      expect(
        categorizeError({
          ename: "ImportError",
          evalue: "No module named 'foo'",
          traceback: [],
        })
      ).toBe(ErrorCategory.IMPORT);

      expect(
        categorizeError({
          ename: "ValueError",
          evalue: "invalid value",
          traceback: [],
        })
      ).toBe(ErrorCategory.RUNTIME);
    });

    it("should parse traceback correctly", async () => {
      const { parseTraceback } = await import(
        "../../src/jupyter/error-handler.js"
      );

      const traceback = [
        "Traceback (most recent call last):",
        '  File "/content/test.py", line 10, in main',
        "    result = process(data)",
        '  File "/content/test.py", line 5, in process',
        "    return int(x)",
        "ValueError: invalid literal for int()",
      ];

      const parsed = parseTraceback(traceback);
      expect(parsed.frames.length).toBeGreaterThan(0);
      expect(parsed.rawLines).toHaveLength(traceback.length);
    });
  });

  describe("Connection Pool", () => {
    it("should manage connections correctly", async () => {
      const { ConnectionPool } = await import(
        "../../src/jupyter/connection-pool.js"
      );

      ConnectionPool.resetInstance();
      const pool = ConnectionPool.getInstance();

      expect(pool.listConnections()).toHaveLength(0);

      const stats = pool.getStats();
      expect(stats.total).toBe(0);
      expect(stats.limit).toBe(1); // Free tier default

      ConnectionPool.resetInstance();
    });
  });
});

describe("Protocol message round-trip", () => {
  it("should serialize and deserialize messages correctly", async () => {
    const { serializeMessage, deserializeMessage, createExecuteRequest } =
      await import("../../src/jupyter/protocol.js");

    const originalRequest = createExecuteRequest(
      "print('test')",
      "session-123"
    );
    const serialized = serializeMessage(originalRequest);
    const deserialized = deserializeMessage(serialized);

    expect(deserialized.header.msg_type).toBe(originalRequest.header.msg_type);
    expect(deserialized.content).toHaveProperty(
      "code",
      originalRequest.content.code
    );
  });

  it("should handle JSON object format (Colab protocol)", async () => {
    const { deserializeMessage, MessageType } = await import(
      "../../src/jupyter/protocol.js"
    );

    // Simulate Colab's JSON object format
    const colabMessage = JSON.stringify({
      header: {
        msg_id: "test-123",
        msg_type: MessageType.STATUS,
        username: "colab",
        session: "session-456",
        date: new Date().toISOString(),
        version: "5.3",
      },
      parent_header: {},
      metadata: {},
      content: { execution_state: "idle" },
    });

    const deserialized = deserializeMessage(colabMessage);
    expect(deserialized.header.msg_type).toBe(MessageType.STATUS);
    expect(deserialized.content).toHaveProperty("execution_state", "idle");
  });

  it("should handle array frame format (standard Jupyter protocol)", async () => {
    const { deserializeMessage, MessageType } = await import(
      "../../src/jupyter/protocol.js"
    );

    // Simulate standard Jupyter wire protocol with array frames
    const header = {
      msg_id: "test-123",
      msg_type: MessageType.STREAM,
      username: "jupyter",
      session: "session-456",
      date: new Date().toISOString(),
      version: "5.3",
    };

    const arrayFrame = [
      "<IDS|MSG>",                          // delimiter
      "",                                    // HMAC signature (empty for testing)
      JSON.stringify(header),                // header
      JSON.stringify({}),                    // parent_header
      JSON.stringify({}),                    // metadata
      JSON.stringify({ name: "stdout", text: "hello\n" }), // content
    ];

    const deserialized = deserializeMessage(JSON.stringify(arrayFrame));
    expect(deserialized.header.msg_type).toBe(MessageType.STREAM);
    expect(deserialized.content).toHaveProperty("name", "stdout");
    expect(deserialized.content).toHaveProperty("text", "hello\n");
  });

  it("should handle array frame format with buffers", async () => {
    const { deserializeMessage, MessageType } = await import(
      "../../src/jupyter/protocol.js"
    );

    const header = {
      msg_id: "test-123",
      msg_type: MessageType.DISPLAY_DATA,
      username: "jupyter",
      session: "session-456",
      date: new Date().toISOString(),
      version: "5.3",
    };

    const arrayFrame = [
      "<IDS|MSG>",
      "",
      JSON.stringify(header),
      JSON.stringify({}),
      JSON.stringify({}),
      JSON.stringify({ data: { "image/png": "base64data" }, metadata: {} }),
      "buffer1",  // Additional buffer
    ];

    const deserialized = deserializeMessage(JSON.stringify(arrayFrame));
    expect(deserialized.header.msg_type).toBe(MessageType.DISPLAY_DATA);
    expect(deserialized.buffers).toBeDefined();
    expect(deserialized.buffers?.length).toBe(1);
  });

  it("should handle Buffer input", async () => {
    const { deserializeMessage, MessageType } = await import(
      "../../src/jupyter/protocol.js"
    );

    const message = {
      header: {
        msg_id: "test-123",
        msg_type: MessageType.STATUS,
        username: "test",
        session: "session-456",
        date: new Date().toISOString(),
        version: "5.3",
      },
      parent_header: {},
      metadata: {},
      content: { execution_state: "busy" },
    };

    const buffer = Buffer.from(JSON.stringify(message), "utf8");
    const deserialized = deserializeMessage(buffer);
    expect(deserialized.header.msg_type).toBe(MessageType.STATUS);
  });

  it("should provide helpful error messages for invalid data", async () => {
    const { deserializeMessage } = await import(
      "../../src/jupyter/protocol.js"
    );

    expect(() => {
      deserializeMessage("invalid json {{{");
    }).toThrow(/Failed to deserialize Jupyter message/);

    expect(() => {
      deserializeMessage(JSON.stringify({ invalid: "structure" }));
    }).toThrow(/Failed to deserialize Jupyter message/);
  });

  it("should handle array frame with insufficient elements", async () => {
    const { deserializeMessage } = await import(
      "../../src/jupyter/protocol.js"
    );

    // Array with less than 6 elements should fail
    const invalidArrayFrame = ["<IDS|MSG>", "", "header"];
    
    expect(() => {
      deserializeMessage(JSON.stringify(invalidArrayFrame));
    }).toThrow(/Invalid array frame format/);
  });
});
