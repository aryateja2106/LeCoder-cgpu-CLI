# Jupyter Kernel Implementation

This document describes the Jupyter kernel protocol implementation in LeCoder cGPU, enabling structured Python code execution on Google Colab runtimes.

## Architecture Overview

The Jupyter kernel implementation provides a parallel execution path alongside the existing terminal mode. While terminal mode gives shell access via WebSocket terminal frames, kernel mode implements the full Jupyter messaging protocol for Python code execution.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           LeCoder cGPU CLI                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   connect --mode terminal         connect --mode kernel                  │
│           │                               │                              │
│           ▼                               ▼                              │
│   ┌───────────────┐              ┌───────────────────┐                  │
│   │TerminalSession│              │  ColabConnection  │                  │
│   │               │              │                   │                  │
│   │ • stdin/stdout│              │ • Session mgmt    │                  │
│   │ • Raw terminal│              │ • Reconnection    │                  │
│   │ • Shell cmds  │              │ • State tracking  │                  │
│   └───────┬───────┘              └─────────┬─────────┘                  │
│           │                                 │                            │
│           │                                 ▼                            │
│           │                      ┌───────────────────┐                  │
│           │                      │JupyterKernelClient│                  │
│           │                      │                   │                  │
│           │                      │ • Execute code    │                  │
│           │                      │ • Handle messages │                  │
│           │                      │ • Interrupt kernel│                  │
│           │                      └─────────┬─────────┘                  │
│           │                                 │                            │
│           ▼                                 ▼                            │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                    WebSocket Connection                          │   │
│   │                                                                  │   │
│   │  /terminals/websocket/{name}      /api/kernels/{id}/channels    │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                        ┌───────────────────────┐
                        │   Colab Runtime       │
                        │   (Jupyter Server)    │
                        └───────────────────────┘
```

## Key Components

### 1. Protocol Types (`src/jupyter/protocol.ts`)

Defines TypeScript types and Zod schemas for Jupyter messages:

- **Message Types**: `execute_request`, `execute_reply`, `stream`, `error`, `status`, etc.
- **Channels**: `shell`, `iopub`, `stdin`, `control`, `heartbeat`
- **Content Schemas**: Validated structures for each message type
- **Helper Functions**: `createMessageHeader()`, `serializeMessage()`, `deserializeMessage()`

### 2. Kernel Client (`src/jupyter/kernel-client.ts`)

WebSocket client implementing the Jupyter kernel protocol:

- Connects to `/api/kernels/{kernelId}/channels`
- Sends execute requests on the shell channel
- Collects responses from shell and iopub channels
- Returns structured `ExecutionResult` with stdout, stderr, errors, display_data

### 3. Connection Manager (`src/jupyter/colab-connection.ts`)

Manages kernel lifecycle and connection state:

- Creates Jupyter sessions via REST API
- Maintains WebSocket connection
- Implements automatic reconnection with exponential backoff
- Tracks state: `disconnected`, `connecting`, `connected`, `reconnecting`, `failed`

### 4. Connection Pool (`src/jupyter/connection-pool.ts`)

Singleton pool for managing multiple kernel connections:

- Connection reuse by endpoint
- Connection limits based on subscription tier
- Keep-alive mechanism
- Health checks

### 5. Error Handler (`src/jupyter/error-handler.ts`)

Structured error processing:

- Error categorization (syntax, runtime, import, memory, etc.)
- Traceback parsing
- Formatted output for CLI display

## Message Flow

### Execute Request Flow

```
CLI                    ColabConnection      JupyterKernelClient      Colab Kernel
 │                           │                     │                      │
 │  executeCode("print(1)")  │                     │                      │
 │ ─────────────────────────>│                     │                      │
 │                           │   getKernelClient() │                      │
 │                           │────────────────────>│                      │
 │                           │                     │                      │
 │                           │   executeCode()     │                      │
 │                           │────────────────────>│                      │
 │                           │                     │  execute_request     │
 │                           │                     │─────────────────────>│
 │                           │                     │                      │
 │                           │                     │  status: busy        │
 │                           │                     │<─────────────────────│
 │                           │                     │  stream: stdout "1\n"│
 │                           │                     │<─────────────────────│
 │                           │                     │  execute_reply: ok   │
 │                           │                     │<─────────────────────│
 │                           │                     │  status: idle        │
 │                           │                     │<─────────────────────│
 │                           │                     │                      │
 │                           │   ExecutionResult   │                      │
 │                           │<────────────────────│                      │
 │   ExecutionResult         │                     │                      │
 │<──────────────────────────│                     │                      │
```

### Reconnection Flow

```
JupyterKernelClient    ColabConnection         ColabClient
       │                      │                      │
       │  disconnect event    │                      │
       │─────────────────────>│                      │
       │                      │                      │
       │                      │  state: reconnecting │
       │                      │                      │
       │                      │  wait (exponential)  │
       │                      │  ───────────────────>│
       │                      │                      │
       │                      │  refreshConnection() │
       │                      │─────────────────────>│
       │                      │                      │
       │                      │  new token           │
       │                      │<─────────────────────│
       │                      │                      │
       │  new KernelClient    │                      │
       │<─────────────────────│                      │
       │                      │                      │
       │  connect()           │                      │
       │<─────────────────────│                      │
       │                      │                      │
       │                      │  state: connected    │
       │                      │                      │
```

## Execution Result Structure

```typescript
interface ExecutionResult {
  // Status of the execution
  status: "ok" | "error" | "abort";

  // Execution count (cell number)
  execution_count: number | null;

  // Standard output as a single string
  stdout: string;

  // Standard error as a single string
  stderr: string;

  // Error traceback lines (if status is "error")
  traceback: string[];

  // Rich output data (plots, HTML, etc.)
  display_data: DisplayDataContent[];

  // Structured error info
  error?: {
    ename: string;    // Error class name
    evalue: string;   // Error message
    traceback: string[];
  };

  // Timing information
  timing?: {
    started: Date;
    completed: Date;
    duration_ms: number;
  };
}
```

## Connection States

```
                    ┌──────────────┐
                    │ DISCONNECTED │
                    └──────┬───────┘
                           │ initialize()
                           ▼
                    ┌──────────────┐
                    │  CONNECTING  │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │ success    │            │ failure
              ▼            │            ▼
       ┌──────────────┐    │     ┌──────────────┐
       │  CONNECTED   │    │     │    FAILED    │
       └──────┬───────┘    │     └──────────────┘
              │            │            ▲
              │ disconnect │            │
              ▼            │            │ max attempts
       ┌──────────────┐    │            │
       │ RECONNECTING │────┼────────────┘
       └──────┬───────┘    │
              │            │
              │ success    │
              └────────────┘
```

## Error Categories

| Category | Error Types | Description |
|----------|-------------|-------------|
| `syntax` | SyntaxError, IndentationError | Code parsing errors |
| `runtime` | NameError, TypeError, ValueError, etc. | Execution-time errors |
| `import` | ImportError, ModuleNotFoundError | Missing modules |
| `memory` | MemoryError, OOM | Out of memory |
| `timeout` | TimeoutError, KeyboardInterrupt | Execution interrupted |
| `io` | IOError, FileNotFoundError | File/resource access |
| `unknown` | Others | Unclassified errors |

## API Reference

### ColabConnection

```typescript
class ColabConnection {
  // Initialize connection (create session, connect WebSocket)
  async initialize(): Promise<void>;

  // Execute Python code
  async executeCode(code: string, options?: ExecuteOptions): Promise<ExecutionResult>;

  // Get current kernel status
  async getStatus(): Promise<Kernel>;

  // Interrupt running execution
  async interrupt(): Promise<void>;

  // Close connection
  async shutdown(deleteKernel?: boolean): Promise<void>;

  // Check if connected
  get connected(): boolean;

  // Get connection state
  getState(): ConnectionState;
}
```

### JupyterKernelClient

```typescript
class JupyterKernelClient {
  // Connect to kernel WebSocket
  async connect(): Promise<void>;

  // Execute code and wait for result
  async executeCode(code: string, options?: ExecuteOptions): Promise<ExecutionResult>;

  // Get kernel info
  async getKernelInfo(): Promise<JupyterMessage>;

  // Send interrupt signal
  async interrupt(): Promise<void>;

  // Close connection
  close(): void;
}
```

### ConnectionPool

```typescript
class ConnectionPool {
  // Get singleton instance
  static getInstance(): ConnectionPool;

  // Get or create connection for a runtime
  async getOrCreateConnection(runtime, client): Promise<ColabConnection>;

  // List all connections
  listConnections(): ColabConnection[];

  // Close specific connection
  async closeConnection(endpoint: string): Promise<void>;

  // Close all connections
  async closeAll(): Promise<void>;

  // Get pool statistics
  getStats(): ConnectionPoolStats;
}
```

## Configuration Options

### ColabConnection Options

| Option | Default | Description |
|--------|---------|-------------|
| `maxReconnectAttempts` | 5 | Maximum reconnection attempts |
| `reconnectBaseDelay` | 1000ms | Base delay for exponential backoff |
| `notebookPath` | `/content/lecoder.ipynb` | Path for session creation |
| `kernelName` | `python3` | Kernel name for session |

### ConnectionPool Options

| Option | Default | Description |
|--------|---------|-------------|
| `freeConnectionLimit` | 1 | Max connections for free tier |
| `proConnectionLimit` | 5 | Max connections for Pro tier |
| `keepAliveIntervalMs` | 60000 | Keep-alive interval |
| `healthCheckIntervalMs` | 30000 | Health check interval |

## Debugging

Enable debug logging with the environment variable:

```bash
export LECODER_CGPU_DEBUG=1
```

This enables:
- WebSocket message logging
- Reconnection attempt logging
- Kernel state change logging
- Error details

## Testing

Unit tests are in `tests/unit/`:
- `jupyter-protocol.test.ts` - Protocol types and serialization
- `kernel-client.test.ts` - WebSocket client
- `colab-connection.test.ts` - Connection management
- `connection-pool.test.ts` - Pool operations

Integration tests are in `tests/integration/`:
- `jupyter-kernel.test.ts` - End-to-end flow with mocked kernel

Run tests:
```bash
npm run test
npm run test:watch
```
