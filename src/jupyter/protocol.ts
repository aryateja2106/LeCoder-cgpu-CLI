import { randomUUID } from "node:crypto";
import { z } from "zod";

// Jupyter Protocol Message Types
export enum MessageType {
  // Shell channel
  EXECUTE_REQUEST = "execute_request",
  EXECUTE_REPLY = "execute_reply",
  INSPECT_REQUEST = "inspect_request",
  INSPECT_REPLY = "inspect_reply",
  COMPLETE_REQUEST = "complete_request",
  COMPLETE_REPLY = "complete_reply",
  HISTORY_REQUEST = "history_request",
  HISTORY_REPLY = "history_reply",
  IS_COMPLETE_REQUEST = "is_complete_request",
  IS_COMPLETE_REPLY = "is_complete_reply",
  COMM_INFO_REQUEST = "comm_info_request",
  COMM_INFO_REPLY = "comm_info_reply",
  KERNEL_INFO_REQUEST = "kernel_info_request",
  KERNEL_INFO_REPLY = "kernel_info_reply",
  SHUTDOWN_REQUEST = "shutdown_request",
  SHUTDOWN_REPLY = "shutdown_reply",
  INTERRUPT_REQUEST = "interrupt_request",
  INTERRUPT_REPLY = "interrupt_reply",

  // IOPub channel
  STREAM = "stream",
  DISPLAY_DATA = "display_data",
  UPDATE_DISPLAY_DATA = "update_display_data",
  EXECUTE_INPUT = "execute_input",
  EXECUTE_RESULT = "execute_result",
  ERROR = "error",
  STATUS = "status",
  CLEAR_OUTPUT = "clear_output",
  COMM_OPEN = "comm_open",
  COMM_MSG = "comm_msg",
  COMM_CLOSE = "comm_close",

  // Stdin channel
  INPUT_REQUEST = "input_request",
  INPUT_REPLY = "input_reply",
}

// Channel types
export enum Channel {
  SHELL = "shell",
  IOPUB = "iopub",
  STDIN = "stdin",
  CONTROL = "control",
  HEARTBEAT = "heartbeat",
}

// Execution status
export enum ExecutionState {
  BUSY = "busy",
  IDLE = "idle",
  STARTING = "starting",
}

export enum ReplyStatus {
  OK = "ok",
  ERROR = "error",
  ABORT = "abort",
}

// Message Header Schema
export const MessageHeaderSchema = z.object({
  msg_id: z.string(),
  msg_type: z.string(),
  username: z.string().optional().default(""),
  session: z.string(),
  date: z.string().optional(),
  version: z.string().optional().default("5.3"),
});

export type MessageHeader = z.infer<typeof MessageHeaderSchema>;

// Generic Jupyter Message Schema
export const JupyterMessageSchema = z.object({
  header: MessageHeaderSchema,
  parent_header: MessageHeaderSchema.partial().or(z.record(z.never())),
  metadata: z.record(z.unknown()).optional().default({}),
  content: z.record(z.unknown()),
  buffers: z.array(z.instanceof(Buffer)).optional().default([]),
  channel: z.nativeEnum(Channel).optional(),
});

export type JupyterMessage<T = Record<string, unknown>> = {
  header: MessageHeader;
  parent_header: Partial<MessageHeader> | Record<string, never>;
  metadata: Record<string, unknown>;
  content: T;
  buffers?: Buffer[];
  channel?: Channel;
};

// Execute Request Content
export const ExecuteRequestContentSchema = z.object({
  code: z.string(),
  silent: z.boolean().optional().default(false),
  store_history: z.boolean().optional().default(true),
  user_expressions: z.record(z.string()).optional().default({}),
  allow_stdin: z.boolean().optional().default(true),
  stop_on_error: z.boolean().optional().default(true),
});

export type ExecuteRequestContent = z.infer<typeof ExecuteRequestContentSchema>;

// Execute Reply Content
export const ExecuteReplyContentSchema = z.object({
  status: z.nativeEnum(ReplyStatus),
  execution_count: z.number().nullable(),
  payload: z.array(z.record(z.unknown())).optional().default([]),
  user_expressions: z.record(z.unknown()).optional().default({}),
  // Error fields (when status is 'error')
  ename: z.string().optional(),
  evalue: z.string().optional(),
  traceback: z.array(z.string()).optional(),
});

export type ExecuteReplyContent = z.infer<typeof ExecuteReplyContentSchema>;

// Stream Content
export const StreamContentSchema = z.object({
  name: z.enum(["stdout", "stderr"]),
  text: z.string(),
});

export type StreamContent = z.infer<typeof StreamContentSchema>;

// Error Content
export const ErrorContentSchema = z.object({
  ename: z.string(),
  evalue: z.string(),
  traceback: z.array(z.string()),
});

export type ErrorContent = z.infer<typeof ErrorContentSchema>;

// Status Content
export const StatusContentSchema = z.object({
  execution_state: z.nativeEnum(ExecutionState),
});

export type StatusContent = z.infer<typeof StatusContentSchema>;

// Display Data Content
export const DisplayDataContentSchema = z.object({
  data: z.record(z.unknown()), // MIME type -> data mapping
  metadata: z.record(z.unknown()).optional().default({}),
  transient: z.record(z.unknown()).optional().default({}),
});

export type DisplayDataContent = z.infer<typeof DisplayDataContentSchema>;

// Execute Result Content (similar to Display Data but includes execution_count)
export const ExecuteResultContentSchema = DisplayDataContentSchema.extend({
  execution_count: z.number(),
});

export type ExecuteResultContent = z.infer<typeof ExecuteResultContentSchema>;

// Execute Input Content
export const ExecuteInputContentSchema = z.object({
  code: z.string(),
  execution_count: z.number(),
});

export type ExecuteInputContent = z.infer<typeof ExecuteInputContentSchema>;

// Kernel Info Reply Content
export const KernelInfoReplyContentSchema = z.object({
  status: z.nativeEnum(ReplyStatus),
  protocol_version: z.string(),
  implementation: z.string(),
  implementation_version: z.string(),
  language_info: z.object({
    name: z.string(),
    version: z.string(),
    mimetype: z.string().optional(),
    file_extension: z.string().optional(),
    pygments_lexer: z.string().optional(),
    codemirror_mode: z.union([z.string(), z.record(z.unknown())]).optional(),
    nbconvert_exporter: z.string().optional(),
  }),
  banner: z.string().optional(),
  help_links: z.array(z.object({
    text: z.string(),
    url: z.string(),
  })).optional(),
});

export type KernelInfoReplyContent = z.infer<typeof KernelInfoReplyContentSchema>;

// Execution Result Type
export interface ExecutionResult {
  status: ReplyStatus;
  execution_count: number | null;
  stdout: string;
  stderr: string;
  traceback: string[];
  display_data: DisplayDataContent[];
  error?: {
    ename: string;
    evalue: string;
    traceback: string[];
  };
  timing?: {
    started: Date;
    completed: Date;
    duration_ms: number;
  };
}

// Execute Options
export interface ExecuteOptions {
  silent?: boolean;
  store_history?: boolean;
  user_expressions?: Record<string, string>;
  allow_stdin?: boolean;
  stop_on_error?: boolean;
  timeout_ms?: number;
}

// Helper Functions

/**
 * Create a message header for a Jupyter protocol message
 */
export function createMessageHeader(
  msg_type: string,
  session: string,
  username: string = "lecoder-cgpu"
): MessageHeader {
  return {
    msg_id: randomUUID(),
    msg_type,
    username,
    session,
    date: new Date().toISOString(),
    version: "5.3",
  };
}

/**
 * Serialize a Jupyter message to wire format
 * 
 * Jupyter protocol over WebSocket can use two formats:
 * 1. JSON array: [delimiter, signature, header, parent_header, metadata, content, ...buffers]
 * 2. Single JSON object with all components (used by Colab)
 * 
 * We'll use the JSON object format as it's simpler and what Colab expects.
 * The message structure includes:
 * - header: message metadata (msg_id, msg_type, session, etc.)
 * - parent_header: reference to parent message (for replies)
 * - metadata: additional metadata dict
 * - content: message-specific content
 * - buffers: optional binary buffers (not commonly used in basic execution)
 */
export function serializeMessage<T>(message: JupyterMessage<T>): string {
  // Colab's Jupyter WebSocket endpoint expects a JSON object with the standard fields
  const wire_message = {
    header: message.header,
    parent_header: message.parent_header || {},
    metadata: message.metadata || {},
    content: message.content,
  };
  return JSON.stringify(wire_message);
}

/**
 * Parse a field from array frame format (handles both string and object)
 */
function parseFrameField(field: unknown): unknown {
  return typeof field === "string" ? JSON.parse(field) : field;
}

/**
 * Parse array frame format into message components
 */
function parseArrayFrame(parsed: unknown[]): Omit<JupyterMessage, 'channel'> {
  // Array format: [delimiter, signature, header, parent_header, metadata, content, ...buffers]
  // Index 0: delimiter (ignored)
  // Index 1: HMAC signature (ignored for now, Colab doesn't use it)
  // Index 2: header
  // Index 3: parent_header  
  // Index 4: metadata
  // Index 5: content
  // Index 6+: buffers (optional)
  
  if (parsed.length < 6) {
    throw new Error(`Invalid array frame format: expected at least 6 elements, got ${parsed.length}`);
  }
  
  return {
    header: parseFrameField(parsed[2]) as MessageHeader,
    parent_header: parseFrameField(parsed[3]) as Partial<MessageHeader>,
    metadata: parseFrameField(parsed[4]) as Record<string, unknown>,
    content: parseFrameField(parsed[5]) as Record<string, unknown>,
    buffers: parsed.slice(6).map((buf: unknown) => 
      Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf))
    ),
  };
}

/**
 * Create error preview from data
 */
function createErrorPreview(data: string | Buffer): string {
  const preview = typeof data === "string" 
    ? data.substring(0, 100) 
    : data.toString("utf8").substring(0, 100);
  return `${preview}${data.length > 100 ? "..." : ""}`;
}

/**
 * Deserialize a Jupyter message from wire format
 * 
 * Handles multiple wire formats:
 * 1. JSON array format: [delimiter, signature, header, parent_header, metadata, content, ...buffers]
 *    - Used by standard Jupyter protocol with HMAC signatures
 * 2. JSON object format: {header, parent_header, metadata, content}
 *    - Used by Colab's simplified protocol (no signatures)
 * 3. Text frame format: Multiple delimited frames
 *    - Legacy format, less common
 * 
 * @param data - Raw WebSocket data (string or Buffer)
 * @returns Parsed JupyterMessage
 */
export function deserializeMessage(data: string | Buffer): JupyterMessage {
  try {
    // Convert Buffer to string if needed
    const text = typeof data === "string" ? data : data.toString("utf8");
    
    // Try parsing as JSON
    const parsed = JSON.parse(text);
    
    // Check if it's an array format (standard Jupyter wire protocol)
    if (Array.isArray(parsed)) {
      const message = parseArrayFrame(parsed);
      return JupyterMessageSchema.parse(message);
    }
    
    // Otherwise assume it's a JSON object format (Colab's approach)
    // Format: {header, parent_header, metadata, content, buffers?}
    return JupyterMessageSchema.parse(parsed);
    
  } catch (error) {
    // Provide more context in error message
    const preview = createErrorPreview(data);
    throw new Error(
      `Failed to deserialize Jupyter message: ${error instanceof Error ? error.message : String(error)}\n` +
      `Data preview: ${preview}`
    );
  }
}

/**
 * Create an execute request message
 */
export function createExecuteRequest(
  code: string,
  session: string,
  options: ExecuteOptions = {}
): JupyterMessage<ExecuteRequestContent> {
  return {
    header: createMessageHeader(MessageType.EXECUTE_REQUEST, session),
    parent_header: {},
    metadata: {},
    content: {
      code,
      silent: options.silent ?? false,
      store_history: options.store_history ?? true,
      user_expressions: options.user_expressions ?? {},
      allow_stdin: options.allow_stdin ?? true,
      stop_on_error: options.stop_on_error ?? true,
    },
  };
}

/**
 * Create a kernel info request message
 */
export function createKernelInfoRequest(
  session: string
): JupyterMessage<Record<string, never>> {
  return {
    header: createMessageHeader(MessageType.KERNEL_INFO_REQUEST, session),
    parent_header: {},
    metadata: {},
    content: {},
  };
}

/**
 * Create an interrupt request message
 */
export function createInterruptRequest(
  session: string
): JupyterMessage<Record<string, never>> {
  return {
    header: createMessageHeader(MessageType.INTERRUPT_REQUEST, session),
    parent_header: {},
    metadata: {},
    content: {},
  };
}

/**
 * Check if a message matches a parent message ID
 */
export function matchesParent(
  message: JupyterMessage,
  parent_msg_id: string
): boolean {
  return message.parent_header.msg_id === parent_msg_id;
}
