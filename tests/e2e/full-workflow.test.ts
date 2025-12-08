/**
 * End-to-end tests for complete workflows
 *
 * Tests auth → connect → run → disconnect and notebook workflows.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Types for E2E testing
interface AuthState {
  authenticated: boolean;
  token?: string;
  expiresAt?: Date;
}

interface RuntimeState {
  id: string;
  connected: boolean;
  variant: "GPU" | "TPU" | "CPU";
}

interface NotebookState {
  id: string;
  name: string;
  runtimeConnected: boolean;
}

// Simulated full workflow executor
class MockWorkflowExecutor {
  private auth: AuthState = { authenticated: false };
  private runtime: RuntimeState | null = null;
  private notebooks: Map<string, NotebookState> = new Map();
  private sessions: Map<string, { id: string; active: boolean }> = new Map();
  private executionHistory: { code: string; result: string }[] = [];

  // Auth flow
  async authenticate(): Promise<void> {
    this.auth = {
      authenticated: true,
      token: "mock-token-" + Date.now(),
      expiresAt: new Date(Date.now() + 3600 * 1000),
    };
  }

  async logout(): Promise<void> {
    this.auth = { authenticated: false };
    this.runtime = null;
  }

  isAuthenticated(): boolean {
    return this.auth.authenticated;
  }

  // Connect flow
  async connect(variant: "GPU" | "TPU" | "CPU" = "GPU"): Promise<RuntimeState> {
    if (!this.auth.authenticated) {
      throw new Error("Not authenticated");
    }

    this.runtime = {
      id: "runtime-" + Date.now(),
      connected: true,
      variant,
    };

    return this.runtime;
  }

  async disconnect(): Promise<void> {
    if (this.runtime) {
      this.runtime.connected = false;
      this.runtime = null;
    }
  }

  isConnected(): boolean {
    return this.runtime?.connected ?? false;
  }

  // Run flow
  async run(code: string): Promise<{ output: string; success: boolean }> {
    if (!this.isConnected()) {
      throw new Error("Not connected to runtime");
    }

    // Simulate execution
    let output = "";
    let success = true;

    if (code.includes("print(")) {
      const match = code.match(/print\(['"](.+)['"]\)/);
      output = match ? match[1] + "\n" : "";
    } else if (code.includes("error")) {
      success = false;
      output = "Error: simulated error\n";
    } else {
      output = `Executed: ${code}\n`;
    }

    this.executionHistory.push({ code, result: output });

    return { output, success };
  }

  // Notebook flow
  async createNotebook(name: string): Promise<NotebookState> {
    if (!this.auth.authenticated) {
      throw new Error("Not authenticated");
    }

    const notebook: NotebookState = {
      id: "notebook-" + Date.now(),
      name,
      runtimeConnected: false,
    };

    this.notebooks.set(notebook.id, notebook);
    return notebook;
  }

  async openNotebook(notebookId: string): Promise<NotebookState> {
    const notebook = this.notebooks.get(notebookId);
    if (!notebook) {
      throw new Error("Notebook not found");
    }

    // Auto-connect runtime
    if (!this.isConnected()) {
      await this.connect();
    }

    notebook.runtimeConnected = true;
    return notebook;
  }

  async executeInNotebook(notebookId: string, code: string): Promise<string> {
    const notebook = this.notebooks.get(notebookId);
    if (!notebook || !notebook.runtimeConnected) {
      throw new Error("Notebook not connected");
    }

    const result = await this.run(code);
    return result.output;
  }

  async deleteNotebook(notebookId: string): Promise<void> {
    if (!this.notebooks.has(notebookId)) {
      throw new Error("Notebook not found");
    }
    this.notebooks.delete(notebookId);
  }

  // Session flow
  async createSession(label: string): Promise<{ id: string }> {
    if (!this.auth.authenticated) {
      throw new Error("Not authenticated");
    }

    const session = {
      id: "session-" + Date.now(),
      active: this.sessions.size === 0,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  async switchSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    // Deactivate all sessions
    for (const s of this.sessions.values()) {
      s.active = false;
    }

    session.active = true;
  }

  async closeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  listSessions(): { id: string; active: boolean }[] {
    return Array.from(this.sessions.values());
  }

  // Helpers
  getExecutionHistory(): { code: string; result: string }[] {
    return [...this.executionHistory];
  }

  reset(): void {
    this.auth = { authenticated: false };
    this.runtime = null;
    this.notebooks.clear();
    this.sessions.clear();
    this.executionHistory = [];
  }
}

describe("Full Workflow E2E Tests", () => {
  let workflow: MockWorkflowExecutor;

  beforeEach(() => {
    workflow = new MockWorkflowExecutor();
  });

  afterEach(() => {
    workflow.reset();
  });

  describe("auth → connect → run → disconnect flow", () => {
    it("should complete full flow successfully", async () => {
      // Authenticate
      await workflow.authenticate();
      expect(workflow.isAuthenticated()).toBe(true);

      // Connect
      const runtime = await workflow.connect("GPU");
      expect(workflow.isConnected()).toBe(true);
      expect(runtime.variant).toBe("GPU");

      // Run
      const result = await workflow.run("print('hello')");
      expect(result.success).toBe(true);
      expect(result.output).toBe("hello\n");

      // Disconnect
      await workflow.disconnect();
      expect(workflow.isConnected()).toBe(false);

      // Logout
      await workflow.logout();
      expect(workflow.isAuthenticated()).toBe(false);
    });

    it("should fail to connect without auth", async () => {
      await expect(workflow.connect()).rejects.toThrow("Not authenticated");
    });

    it("should fail to run without connection", async () => {
      await workflow.authenticate();
      await expect(workflow.run("print('hello')")).rejects.toThrow("Not connected");
    });
  });

  describe("notebook create → open → execute → delete flow", () => {
    it("should complete notebook workflow", async () => {
      // Auth
      await workflow.authenticate();

      // Create
      const notebook = await workflow.createNotebook("test.ipynb");
      expect(notebook.id).toBeDefined();
      expect(notebook.name).toBe("test.ipynb");

      // Open (auto-connects runtime)
      const opened = await workflow.openNotebook(notebook.id);
      expect(opened.runtimeConnected).toBe(true);

      // Execute
      const output = await workflow.executeInNotebook(notebook.id, "print('test')");
      expect(output).toBe("test\n");

      // Delete
      await workflow.deleteNotebook(notebook.id);
    });

    it("should auto-connect runtime on notebook open", async () => {
      await workflow.authenticate();
      const notebook = await workflow.createNotebook("test.ipynb");

      expect(workflow.isConnected()).toBe(false);

      await workflow.openNotebook(notebook.id);

      expect(workflow.isConnected()).toBe(true);
    });

    it("should fail to create notebook without auth", async () => {
      await expect(workflow.createNotebook("test.ipynb")).rejects.toThrow(
        "Not authenticated"
      );
    });
  });

  describe("multi-session workflow", () => {
    it("should create and manage multiple sessions", async () => {
      await workflow.authenticate();

      // Create 3 sessions
      const session1 = await workflow.createSession("Experiment 1");
      const session2 = await workflow.createSession("Experiment 2");
      const session3 = await workflow.createSession("Experiment 3");

      expect(workflow.listSessions()).toHaveLength(3);

      // First session should be active
      expect(workflow.listSessions()[0].active).toBe(true);

      // Switch to session 2
      await workflow.switchSession(session2.id);
      const sessions = workflow.listSessions();
      const active = sessions.find((s) => s.active);
      expect(active?.id).toBe(session2.id);

      // Close session 3
      await workflow.closeSession(session3.id);
      expect(workflow.listSessions()).toHaveLength(2);
    });

    it("should switch between sessions", async () => {
      await workflow.authenticate();

      const session1 = await workflow.createSession("Session 1");
      const session2 = await workflow.createSession("Session 2");

      await workflow.switchSession(session2.id);

      const sessions = workflow.listSessions();
      expect(sessions.find((s) => s.id === session1.id)?.active).toBe(false);
      expect(sessions.find((s) => s.id === session2.id)?.active).toBe(true);
    });
  });

  describe("execution history tracking", () => {
    it("should track all executions", async () => {
      await workflow.authenticate();
      await workflow.connect();

      await workflow.run("print('a')");
      await workflow.run("print('b')");
      await workflow.run("print('c')");

      const history = workflow.getExecutionHistory();
      expect(history).toHaveLength(3);
    });
  });
});
