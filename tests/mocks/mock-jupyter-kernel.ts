/**
 * Mock Jupyter Kernel for testing
 *
 * Simulates Colab's Jupyter protocol for testing without live connections.
 * Supports core message types and configurable behaviors.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { Server } from 'http';
import { createServer } from 'http';

// Message types from Jupyter protocol
export interface JupyterMessage {
  header: {
    msg_id: string;
    msg_type: string;
    username: string;
    session: string;
    date: string;
    version: string;
  };
  parent_header: Record<string, unknown>;
  metadata: Record<string, unknown>;
  content: Record<string, unknown>;
  buffers?: Buffer[];
  channel?: string;
}

export interface ExecuteRequest {
  code: string;
  silent?: boolean;
  store_history?: boolean;
  user_expressions?: Record<string, unknown>;
  allow_stdin?: boolean;
  stop_on_error?: boolean;
}

export interface MockKernelConfig {
  port?: number;
  executionDelay?: number;
  defaultStatus?: 'idle' | 'busy';
  simulateMemoryError?: boolean;
  simulateImportError?: string;
  simulateTimeout?: boolean;
  maxConnections?: number;
}

export interface MockExecution {
  code: string;
  output?: string;
  error?: {
    ename: string;
    evalue: string;
    traceback: string[];
  };
  displayData?: {
    'text/plain'?: string;
    'text/html'?: string;
    'image/png'?: string;
  };
  executionCount?: number;
}

export class MockJupyterKernel {
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private connections: Set<WebSocket> = new Set();
  private receivedMessages: JupyterMessage[] = [];
  private executionCount = 0;
  private config: Required<MockKernelConfig>;
  private mockExecutions: Map<string, MockExecution> = new Map();
  private isRunning = false;

  constructor(config: MockKernelConfig = {}) {
    this.config = {
      port: config.port ?? 0, // 0 = random available port
      executionDelay: config.executionDelay ?? 10,
      defaultStatus: config.defaultStatus ?? 'idle',
      simulateMemoryError: config.simulateMemoryError ?? false,
      simulateImportError: config.simulateImportError ?? '',
      simulateTimeout: config.simulateTimeout ?? false,
      maxConnections: config.maxConnections ?? 10,
    };
  }

  /**
   * Start the mock kernel server
   */
  async start(): Promise<{ port: number; url: string }> {
    if (this.isRunning) {
      throw new Error('Mock kernel is already running');
    }

    return new Promise((resolve, reject) => {
      this.server = createServer();
      this.wss = new WebSocketServer({ server: this.server });

      this.wss.on('connection', (ws: WebSocket) => {
        if (this.connections.size >= this.config.maxConnections) {
          ws.close(1013, 'Max connections reached');
          return;
        }

        this.connections.add(ws);

        ws.on('message', (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString()) as JupyterMessage;
            this.receivedMessages.push(message);
            this.handleMessage(ws, message);
          } catch (error) {
            console.error('Failed to parse message:', error);
          }
        });

        ws.on('close', () => {
          this.connections.delete(ws);
        });

        ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          this.connections.delete(ws);
        });
      });

      this.server.on('error', reject);

      this.server.listen(this.config.port, () => {
        const address = this.server!.address();
        const port = typeof address === 'object' ? address!.port : this.config.port;
        this.isRunning = true;
        resolve({
          port,
          url: `ws://localhost:${port}`,
        });
      });
    });
  }

  /**
   * Stop the mock kernel server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    return new Promise((resolve) => {
      // Close all connections
      for (const ws of this.connections) {
        ws.close(1000, 'Server shutting down');
      }
      this.connections.clear();

      // Close WebSocket server
      if (this.wss) {
        this.wss.close();
        this.wss = null;
      }

      // Close HTTP server
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          this.isRunning = false;
          resolve();
        });
      } else {
        this.isRunning = false;
        resolve();
      }
    });
  }

  /**
   * Handle incoming Jupyter messages
   */
  private handleMessage(ws: WebSocket, message: JupyterMessage): void {
    switch (message.header.msg_type) {
      case 'kernel_info_request':
        this.handleKernelInfoRequest(ws, message);
        break;
      case 'execute_request':
        this.handleExecuteRequest(ws, message);
        break;
      case 'interrupt_request':
        this.handleInterruptRequest(ws, message);
        break;
      case 'shutdown_request':
        this.handleShutdownRequest(ws, message);
        break;
      case 'is_complete_request':
        this.handleIsCompleteRequest(ws, message);
        break;
      default:
        console.warn(`Unknown message type: ${message.header.msg_type}`);
    }
  }

  /**
   * Handle kernel_info_request
   */
  private handleKernelInfoRequest(ws: WebSocket, message: JupyterMessage): void {
    this.sendMessage(ws, 'kernel_info_reply', message, {
      status: 'ok',
      protocol_version: '5.3',
      implementation: 'mock-jupyter',
      implementation_version: '1.0.0',
      language_info: {
        name: 'python',
        version: '3.10.0',
        mimetype: 'text/x-python',
        file_extension: '.py',
        pygments_lexer: 'ipython3',
        codemirror_mode: {
          name: 'ipython',
          version: 3,
        },
        nbconvert_exporter: 'python',
      },
      banner: 'Mock Jupyter Kernel for Testing',
      help_links: [],
    });
  }

  /**
   * Handle execute_request
   */
  private async handleExecuteRequest(ws: WebSocket, message: JupyterMessage): Promise<void> {
    const content = message.content as ExecuteRequest;
    const code = content.code;

    // Send busy status
    this.sendStatus(ws, message, 'busy');

    // Check for configured mock execution
    const mockExec = this.mockExecutions.get(code);

    // Simulate execution delay
    await this.delay(this.config.executionDelay);

    // Handle timeout simulation
    if (this.config.simulateTimeout) {
      // Don't send any response - simulates timeout
      return;
    }

    // Increment execution count
    this.executionCount++;
    const executionCount = mockExec?.executionCount ?? this.executionCount;

    // Send execute_input
    this.sendMessage(ws, 'execute_input', message, {
      code,
      execution_count: executionCount,
    });

    // Handle memory error simulation
    if (this.config.simulateMemoryError) {
      this.sendError(ws, message, {
        ename: 'MemoryError',
        evalue: 'Unable to allocate memory',
        traceback: [
          'Traceback (most recent call last):',
          '  File "<stdin>", line 1, in <module>',
          'MemoryError: Unable to allocate 16.0 GiB for an array',
        ],
      });
      this.sendExecuteReply(ws, message, 'error', executionCount);
      this.sendStatus(ws, message, 'idle');
      return;
    }

    // Handle import error simulation
    if (this.config.simulateImportError && code.includes(this.config.simulateImportError)) {
      this.sendError(ws, message, {
        ename: 'ModuleNotFoundError',
        evalue: `No module named '${this.config.simulateImportError}'`,
        traceback: [
          'Traceback (most recent call last):',
          '  File "<stdin>", line 1, in <module>',
          `ModuleNotFoundError: No module named '${this.config.simulateImportError}'`,
        ],
      });
      this.sendExecuteReply(ws, message, 'error', executionCount);
      this.sendStatus(ws, message, 'idle');
      return;
    }

    // Handle mock execution with error
    if (mockExec?.error) {
      this.sendError(ws, message, mockExec.error);
      this.sendExecuteReply(ws, message, 'error', executionCount);
      this.sendStatus(ws, message, 'idle');
      return;
    }

    // Send output if configured or default
    const output = mockExec?.output ?? this.generateDefaultOutput(code);
    if (output) {
      this.sendStream(ws, message, 'stdout', output);
    }

    // Send display data if configured
    if (mockExec?.displayData) {
      this.sendDisplayData(ws, message, mockExec.displayData);
    }

    // Send execute_reply with success
    this.sendExecuteReply(ws, message, 'ok', executionCount);

    // Send idle status
    this.sendStatus(ws, message, 'idle');
  }

  /**
   * Handle interrupt_request
   */
  private handleInterruptRequest(ws: WebSocket, message: JupyterMessage): void {
    this.sendMessage(ws, 'interrupt_reply', message, {
      status: 'ok',
    });
  }

  /**
   * Handle shutdown_request
   */
  private handleShutdownRequest(ws: WebSocket, message: JupyterMessage): void {
    const content = message.content as { restart?: boolean };
    this.sendMessage(ws, 'shutdown_reply', message, {
      status: 'ok',
      restart: content.restart ?? false,
    });
  }

  /**
   * Handle is_complete_request
   */
  private handleIsCompleteRequest(ws: WebSocket, message: JupyterMessage): void {
    const content = message.content as { code: string };
    const code = content.code;

    // Simple heuristic for code completeness
    let status: 'complete' | 'incomplete' | 'invalid' | 'unknown' = 'complete';

    if (code.endsWith(':') || code.endsWith('\\')) {
      status = 'incomplete';
    } else if (code.includes('def ') && !code.includes('\n')) {
      status = 'incomplete';
    }

    this.sendMessage(ws, 'is_complete_reply', message, {
      status,
      indent: status === 'incomplete' ? '    ' : '',
    });
  }

  /**
   * Configure a mock execution response
   */
  simulateExecution(code: string, response: Omit<MockExecution, 'code'>): void {
    this.mockExecutions.set(code, { code, ...response });
  }

  /**
   * Configure an error response for specific code
   */
  simulateError(
    code: string,
    error: { ename: string; evalue: string; traceback?: string[] }
  ): void {
    this.mockExecutions.set(code, {
      code,
      error: {
        ename: error.ename,
        evalue: error.evalue,
        traceback: error.traceback ?? [
          'Traceback (most recent call last):',
          '  File "<stdin>", line 1, in <module>',
          `${error.ename}: ${error.evalue}`,
        ],
      },
    });
  }

  /**
   * Clear all mock executions
   */
  clearMockExecutions(): void {
    this.mockExecutions.clear();
  }

  /**
   * Get all received messages
   */
  getReceivedMessages(): JupyterMessage[] {
    return [...this.receivedMessages];
  }

  /**
   * Clear received messages
   */
  clearReceivedMessages(): void {
    this.receivedMessages = [];
  }

  /**
   * Get the number of active connections
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get the current execution count
   */
  getExecutionCount(): number {
    return this.executionCount;
  }

  /**
   * Reset the kernel state
   */
  reset(): void {
    this.executionCount = 0;
    this.receivedMessages = [];
    this.mockExecutions.clear();
  }

  /**
   * Update kernel configuration
   */
  updateConfig(config: Partial<MockKernelConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if the kernel is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  // Helper methods

  private sendMessage(
    ws: WebSocket,
    msgType: string,
    parentMessage: JupyterMessage,
    content: Record<string, unknown>
  ): void {
    const message: JupyterMessage = {
      header: {
        msg_id: uuidv4(),
        msg_type: msgType,
        username: 'mock-kernel',
        session: parentMessage.header.session,
        date: new Date().toISOString(),
        version: '5.3',
      },
      parent_header: parentMessage.header,
      metadata: {},
      content,
      channel: parentMessage.channel ?? 'shell',
    };

    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendStatus(
    ws: WebSocket,
    parentMessage: JupyterMessage,
    status: 'idle' | 'busy' | 'starting'
  ): void {
    const message: JupyterMessage = {
      header: {
        msg_id: uuidv4(),
        msg_type: 'status',
        username: 'mock-kernel',
        session: parentMessage.header.session,
        date: new Date().toISOString(),
        version: '5.3',
      },
      parent_header: parentMessage.header,
      metadata: {},
      content: { execution_state: status },
      channel: 'iopub',
    };

    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendStream(
    ws: WebSocket,
    parentMessage: JupyterMessage,
    name: 'stdout' | 'stderr',
    text: string
  ): void {
    const message: JupyterMessage = {
      header: {
        msg_id: uuidv4(),
        msg_type: 'stream',
        username: 'mock-kernel',
        session: parentMessage.header.session,
        date: new Date().toISOString(),
        version: '5.3',
      },
      parent_header: parentMessage.header,
      metadata: {},
      content: { name, text },
      channel: 'iopub',
    };

    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(
    ws: WebSocket,
    parentMessage: JupyterMessage,
    error: { ename: string; evalue: string; traceback: string[] }
  ): void {
    const message: JupyterMessage = {
      header: {
        msg_id: uuidv4(),
        msg_type: 'error',
        username: 'mock-kernel',
        session: parentMessage.header.session,
        date: new Date().toISOString(),
        version: '5.3',
      },
      parent_header: parentMessage.header,
      metadata: {},
      content: error,
      channel: 'iopub',
    };

    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendDisplayData(
    ws: WebSocket,
    parentMessage: JupyterMessage,
    data: Record<string, string | undefined>
  ): void {
    const filteredData: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        filteredData[key] = value;
      }
    }

    const message: JupyterMessage = {
      header: {
        msg_id: uuidv4(),
        msg_type: 'display_data',
        username: 'mock-kernel',
        session: parentMessage.header.session,
        date: new Date().toISOString(),
        version: '5.3',
      },
      parent_header: parentMessage.header,
      metadata: {},
      content: {
        data: filteredData,
        metadata: {},
        transient: {},
      },
      channel: 'iopub',
    };

    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendExecuteReply(
    ws: WebSocket,
    parentMessage: JupyterMessage,
    status: 'ok' | 'error' | 'aborted',
    executionCount: number
  ): void {
    const content: Record<string, unknown> = {
      status,
      execution_count: executionCount,
    };

    if (status === 'ok') {
      content.user_expressions = {};
      content.payload = [];
    }

    this.sendMessage(ws, 'execute_reply', parentMessage, content);
  }

  private generateDefaultOutput(code: string): string {
    // Generate simple output for common patterns
    if (code.startsWith('print(')) {
      const match = code.match(/print\(['"](.+)['"]\)/);
      if (match) {
        return match[1] + '\n';
      }
    }
    return '';
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Factory function for creating pre-configured kernels
export function createMockKernel(preset: 'default' | 'slow' | 'error' | 'memory-error' = 'default'): MockJupyterKernel {
  switch (preset) {
    case 'slow':
      return new MockJupyterKernel({ executionDelay: 500 });
    case 'error':
      return new MockJupyterKernel({ simulateImportError: 'nonexistent_module' });
    case 'memory-error':
      return new MockJupyterKernel({ simulateMemoryError: true });
    default:
      return new MockJupyterKernel();
  }
}
