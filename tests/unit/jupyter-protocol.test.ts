import { describe, it, expect } from "vitest";
import {
  MessageType,
  Channel,
  ExecutionState,
  ReplyStatus,
  MessageHeaderSchema,
  JupyterMessageSchema,
  ExecuteRequestContentSchema,
  ExecuteReplyContentSchema,
  StreamContentSchema,
  ErrorContentSchema,
  StatusContentSchema,
  DisplayDataContentSchema,
  createMessageHeader,
  serializeMessage,
  deserializeMessage,
  createExecuteRequest,
  createKernelInfoRequest,
  createInterruptRequest,
  matchesParent,
} from "../../src/jupyter/protocol.js";

describe("Jupyter Protocol Types", () => {
  describe("MessageType enum", () => {
    it("should have correct execute message types", () => {
      expect(MessageType.EXECUTE_REQUEST).toBe("execute_request");
      expect(MessageType.EXECUTE_REPLY).toBe("execute_reply");
    });

    it("should have correct stream and error types", () => {
      expect(MessageType.STREAM).toBe("stream");
      expect(MessageType.ERROR).toBe("error");
      expect(MessageType.STATUS).toBe("status");
    });

    it("should have correct kernel info types", () => {
      expect(MessageType.KERNEL_INFO_REQUEST).toBe("kernel_info_request");
      expect(MessageType.KERNEL_INFO_REPLY).toBe("kernel_info_reply");
    });
  });

  describe("Channel enum", () => {
    it("should have all required channels", () => {
      expect(Channel.SHELL).toBe("shell");
      expect(Channel.IOPUB).toBe("iopub");
      expect(Channel.STDIN).toBe("stdin");
      expect(Channel.CONTROL).toBe("control");
      expect(Channel.HEARTBEAT).toBe("heartbeat");
    });
  });

  describe("ExecutionState enum", () => {
    it("should have correct execution states", () => {
      expect(ExecutionState.BUSY).toBe("busy");
      expect(ExecutionState.IDLE).toBe("idle");
      expect(ExecutionState.STARTING).toBe("starting");
    });
  });

  describe("ReplyStatus enum", () => {
    it("should have correct reply statuses", () => {
      expect(ReplyStatus.OK).toBe("ok");
      expect(ReplyStatus.ERROR).toBe("error");
      expect(ReplyStatus.ABORT).toBe("abort");
    });
  });
});

describe("Zod Schemas", () => {
  describe("MessageHeaderSchema", () => {
    it("should validate a valid header", () => {
      const header = {
        msg_id: "test-123",
        msg_type: "execute_request",
        session: "session-456",
        date: "2024-01-01T00:00:00.000Z",
        version: "5.3",
      };
      const result = MessageHeaderSchema.safeParse(header);
      expect(result.success).toBe(true);
    });

    it("should provide defaults for optional fields", () => {
      const header = {
        msg_id: "test-123",
        msg_type: "execute_request",
        session: "session-456",
      };
      const result = MessageHeaderSchema.parse(header);
      expect(result.username).toBe("");
      expect(result.version).toBe("5.3");
    });

    it("should reject missing required fields", () => {
      const header = {
        msg_id: "test-123",
        msg_type: "execute_request",
        // missing session
      };
      const result = MessageHeaderSchema.safeParse(header);
      expect(result.success).toBe(false);
    });
  });

  describe("ExecuteRequestContentSchema", () => {
    it("should validate valid execute request content", () => {
      const content = {
        code: "print('hello')",
        silent: false,
        store_history: true,
        user_expressions: {},
        allow_stdin: true,
        stop_on_error: true,
      };
      const result = ExecuteRequestContentSchema.safeParse(content);
      expect(result.success).toBe(true);
    });

    it("should provide defaults for optional fields", () => {
      const content = {
        code: "print('hello')",
      };
      const result = ExecuteRequestContentSchema.parse(content);
      expect(result.silent).toBe(false);
      expect(result.store_history).toBe(true);
      expect(result.allow_stdin).toBe(true);
      expect(result.stop_on_error).toBe(true);
    });
  });

  describe("ExecuteReplyContentSchema", () => {
    it("should validate successful reply", () => {
      const content = {
        status: "ok",
        execution_count: 1,
        payload: [],
        user_expressions: {},
      };
      const result = ExecuteReplyContentSchema.safeParse(content);
      expect(result.success).toBe(true);
    });

    it("should validate error reply", () => {
      const content = {
        status: "error",
        execution_count: null,
        ename: "ValueError",
        evalue: "invalid value",
        traceback: ["Traceback...", "ValueError: invalid value"],
      };
      const result = ExecuteReplyContentSchema.safeParse(content);
      expect(result.success).toBe(true);
    });
  });

  describe("StreamContentSchema", () => {
    it("should validate stdout stream", () => {
      const content = {
        name: "stdout",
        text: "Hello, World!",
      };
      const result = StreamContentSchema.safeParse(content);
      expect(result.success).toBe(true);
    });

    it("should validate stderr stream", () => {
      const content = {
        name: "stderr",
        text: "Warning message",
      };
      const result = StreamContentSchema.safeParse(content);
      expect(result.success).toBe(true);
    });

    it("should reject invalid stream names", () => {
      const content = {
        name: "invalid",
        text: "test",
      };
      const result = StreamContentSchema.safeParse(content);
      expect(result.success).toBe(false);
    });
  });

  describe("ErrorContentSchema", () => {
    it("should validate error content", () => {
      const content = {
        ename: "TypeError",
        evalue: "'NoneType' object is not callable",
        traceback: [
          "Traceback (most recent call last):",
          '  File "<stdin>", line 1, in <module>',
          "TypeError: 'NoneType' object is not callable",
        ],
      };
      const result = ErrorContentSchema.safeParse(content);
      expect(result.success).toBe(true);
    });
  });

  describe("StatusContentSchema", () => {
    it("should validate busy status", () => {
      const content = { execution_state: "busy" };
      const result = StatusContentSchema.safeParse(content);
      expect(result.success).toBe(true);
    });

    it("should validate idle status", () => {
      const content = { execution_state: "idle" };
      const result = StatusContentSchema.safeParse(content);
      expect(result.success).toBe(true);
    });
  });

  describe("DisplayDataContentSchema", () => {
    it("should validate display data with text/plain", () => {
      const content = {
        data: {
          "text/plain": "42",
        },
        metadata: {},
        transient: {},
      };
      const result = DisplayDataContentSchema.safeParse(content);
      expect(result.success).toBe(true);
    });

    it("should validate display data with multiple MIME types", () => {
      const content = {
        data: {
          "text/plain": "<IPython.display.HTML object>",
          "text/html": "<h1>Hello</h1>",
        },
        metadata: {},
      };
      const result = DisplayDataContentSchema.safeParse(content);
      expect(result.success).toBe(true);
    });
  });
});

describe("Helper Functions", () => {
  describe("createMessageHeader", () => {
    it("should create a valid header", () => {
      const header = createMessageHeader("execute_request", "session-123");
      expect(header.msg_type).toBe("execute_request");
      expect(header.session).toBe("session-123");
      expect(header.username).toBe("lecoder-cgpu");
      expect(header.version).toBe("5.3");
      expect(header.msg_id).toBeDefined();
      expect(header.date).toBeDefined();
    });

    it("should generate unique msg_ids", () => {
      const header1 = createMessageHeader("execute_request", "session-123");
      const header2 = createMessageHeader("execute_request", "session-123");
      expect(header1.msg_id).not.toBe(header2.msg_id);
    });

    it("should allow custom username", () => {
      const header = createMessageHeader(
        "execute_request",
        "session-123",
        "custom-user"
      );
      expect(header.username).toBe("custom-user");
    });
  });

  describe("serializeMessage", () => {
    it("should serialize a message to JSON", () => {
      const message = {
        header: createMessageHeader("execute_request", "session-123"),
        parent_header: {},
        metadata: {},
        content: { code: "print(1)" },
      };
      const serialized = serializeMessage(message);
      const parsed = JSON.parse(serialized);
      expect(parsed.header.msg_type).toBe("execute_request");
      expect(parsed.content.code).toBe("print(1)");
    });
  });

  describe("deserializeMessage", () => {
    it("should deserialize a valid message", () => {
      const json = JSON.stringify({
        header: {
          msg_id: "test-123",
          msg_type: "execute_request",
          session: "session-456",
          version: "5.3",
        },
        parent_header: {},
        metadata: {},
        content: { code: "print(1)" },
      });
      const message = deserializeMessage(json);
      expect(message.header.msg_type).toBe("execute_request");
      expect(message.content).toHaveProperty("code", "print(1)");
    });

    it("should throw on invalid JSON", () => {
      expect(() => deserializeMessage("not json")).toThrow();
    });
  });

  describe("createExecuteRequest", () => {
    it("should create a valid execute request", () => {
      const request = createExecuteRequest("print('hello')", "session-123");
      expect(request.header.msg_type).toBe("execute_request");
      expect(request.content.code).toBe("print('hello')");
      expect(request.content.silent).toBe(false);
      expect(request.content.store_history).toBe(true);
    });

    it("should apply custom options", () => {
      const request = createExecuteRequest("print('hello')", "session-123", {
        silent: true,
        store_history: false,
      });
      expect(request.content.silent).toBe(true);
      expect(request.content.store_history).toBe(false);
    });
  });

  describe("createKernelInfoRequest", () => {
    it("should create a valid kernel info request", () => {
      const request = createKernelInfoRequest("session-123");
      expect(request.header.msg_type).toBe("kernel_info_request");
      expect(request.content).toEqual({});
    });
  });

  describe("createInterruptRequest", () => {
    it("should create a valid interrupt request", () => {
      const request = createInterruptRequest("session-123");
      expect(request.header.msg_type).toBe("interrupt_request");
      expect(request.content).toEqual({});
    });
  });

  describe("matchesParent", () => {
    it("should match when parent_header.msg_id matches", () => {
      const message = {
        header: createMessageHeader("execute_reply", "session-123"),
        parent_header: { msg_id: "parent-msg-id" },
        metadata: {},
        content: {},
      };
      expect(matchesParent(message, "parent-msg-id")).toBe(true);
    });

    it("should not match when parent_header.msg_id differs", () => {
      const message = {
        header: createMessageHeader("execute_reply", "session-123"),
        parent_header: { msg_id: "different-id" },
        metadata: {},
        content: {},
      };
      expect(matchesParent(message, "parent-msg-id")).toBe(false);
    });

    it("should not match when parent_header is empty", () => {
      const message = {
        header: createMessageHeader("execute_reply", "session-123"),
        parent_header: {},
        metadata: {},
        content: {},
      };
      expect(matchesParent(message, "parent-msg-id")).toBe(false);
    });
  });
});
