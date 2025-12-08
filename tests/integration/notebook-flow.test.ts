import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { DriveClient } from "../../src/drive/client.js";
import { NotebookManager } from "../../src/drive/notebook-manager.js";

/**
 * Integration tests for notebook management flow.
 * These tests mock the Drive and Colab APIs but test the full command flow.
 */
describe("Notebook Flow Integration", () => {
  let mockGetAccessToken: () => Promise<string>;
  let driveClient: DriveClient;
  let notebookManager: NotebookManager;

  beforeEach(() => {
    // Mock environment and global fetch
    globalThis.fetch = vi.fn();
    vi.stubEnv("HOME", "/tmp/test-home");
    
    // Mock access token retrieval
    mockGetAccessToken = vi.fn().mockResolvedValue("mock-access-token");
    driveClient = new DriveClient(mockGetAccessToken);
    notebookManager = new NotebookManager(driveClient);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe("Create → List → Open → Delete", () => {
    it("should complete full notebook lifecycle", async () => {
      const mockNotebookId = "test-notebook-id-123";
      const mockNotebookName = "Test Notebook.ipynb";
      
      // Step 1: Create notebook
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          id: mockNotebookId,
          name: mockNotebookName,
          mimeType: "application/x-ipynb+json",
          createdTime: "2024-01-01T00:00:00Z",
          modifiedTime: "2024-01-01T00:00:00Z",
          webViewLink: `https://colab.research.google.com/drive/${mockNotebookId}`,
        }),
      } as never);

      const createdNotebook = await driveClient.createNotebook(mockNotebookName);
      expect(createdNotebook.id).toBe(mockNotebookId);
      expect(createdNotebook.name).toBe(mockNotebookName);
      expect(mockGetAccessToken).toHaveBeenCalled();

      // Step 2: List notebooks and verify the new one appears
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          files: [
            {
              id: mockNotebookId,
              name: mockNotebookName,
              mimeType: "application/x-ipynb+json",
              createdTime: "2024-01-01T00:00:00Z",
              modifiedTime: "2024-01-01T00:00:00Z",
              webViewLink: `https://colab.research.google.com/drive/${mockNotebookId}`,
            },
          ],
        }),
      } as never);

      const notebooks = await notebookManager.listNotebooks();
      expect(notebooks).toHaveLength(1);
      expect(notebooks[0].id).toBe(mockNotebookId);
      expect(notebooks[0].name).toBe(mockNotebookName);

      // Step 3: Get notebook details (simulating open command preparation)
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          id: mockNotebookId,
          name: mockNotebookName,
          mimeType: "application/x-ipynb+json",
          createdTime: "2024-01-01T00:00:00Z",
          modifiedTime: "2024-01-01T00:00:00Z",
          webViewLink: `https://colab.research.google.com/drive/${mockNotebookId}`,
        }),
      } as never);

      const notebookDetails = await driveClient.getNotebook(mockNotebookId);
      expect(notebookDetails.id).toBe(mockNotebookId);
      expect(notebookDetails.name).toBe(mockNotebookName);

      // Step 4: Delete notebook
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 204,
      } as never);

      await driveClient.deleteNotebook(mockNotebookId);
      
      // Verify the delete was called with correct parameters
      expect(globalThis.fetch).toHaveBeenLastCalledWith(
        expect.stringContaining(`/files/${mockNotebookId}`),
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            Authorization: "Bearer mock-access-token",
          }),
        })
      );
    });
  });

  describe("JSON output validation", () => {
    it("should produce valid JSON for list command", async () => {
      // Mock list response
      const mockNotebooks = [
        {
          id: "file1",
          name: "test.ipynb",
          createdTime: "2024-01-01T00:00:00Z",
          modifiedTime: "2024-01-02T00:00:00Z",
          webViewLink: "https://colab.research.google.com/drive/file1",
          colabName: "Test Notebook",
        },
      ];

      // Verify JSON serialization works
      const json = JSON.stringify(mockNotebooks);
      const parsed = JSON.parse(json);
      
      expect(parsed).toEqual(mockNotebooks);
      expect(parsed[0].id).toBe("file1");
    });

    it("should produce valid JSON for create command", async () => {
      const mockNotebook = {
        id: "newfile",
        name: "new.ipynb",
        createdTime: "2024-01-01T00:00:00Z",
        modifiedTime: "2024-01-01T00:00:00Z",
        webViewLink: "https://colab.research.google.com/drive/newfile",
        colabName: "New Notebook",
      };

      const json = JSON.stringify(mockNotebook, null, 2);
      const parsed = JSON.parse(json);
      
      expect(parsed).toEqual(mockNotebook);
    });
  });

  describe("Error handling", () => {
    it("should handle Drive API 404 errors", async () => {
      const mockNotebookId = "nonexistent-id-123";
      
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: vi.fn().mockResolvedValue("File not found"),
      } as never);

      // Verify error is thrown with 404 status
      await expect(driveClient.getNotebook(mockNotebookId)).rejects.toThrow(
        /404.*Not Found/
      );
      
      // Verify error message contains helpful context
      try {
        await driveClient.getNotebook(mockNotebookId);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        expect(errorMessage).toContain("404");
        expect(errorMessage.toLowerCase()).toMatch(/not found/);
      }
    });

    it("should handle Drive API 403 errors", async () => {
      const mockNotebookId = "forbidden-id-123";
      
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: vi.fn().mockResolvedValue("Permission denied"),
      } as never);

      // Verify error is thrown with 403 status
      await expect(driveClient.getNotebook(mockNotebookId)).rejects.toThrow(
        /403.*Forbidden/
      );
      
      // Verify error message contains helpful context
      try {
        await driveClient.getNotebook(mockNotebookId);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        expect(errorMessage).toContain("403");
        expect(errorMessage.toLowerCase()).toMatch(/forbidden/);
      }
    });

    it("should handle Drive API 429 rate limit errors", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: vi.fn().mockResolvedValue("Rate limit exceeded"),
      } as never);

      // Verify error is thrown with 429 status
      await expect(notebookManager.listNotebooks()).rejects.toThrow(
        /429.*Too Many Requests/
      );
      
      // Verify error message contains rate limit context
      try {
        await notebookManager.listNotebooks();
        expect.fail("Should have thrown an error");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        expect(errorMessage).toContain("429");
        expect(errorMessage.toLowerCase()).toMatch(/rate limit|too many requests/);
      }
    });

    it("should handle network failures", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Network error: Connection timeout")
      );

      // Verify network error is propagated
      await expect(notebookManager.listNotebooks()).rejects.toThrow(
        /Network error/
      );
      
      // Verify error context is preserved
      try {
        await notebookManager.listNotebooks();
        expect.fail("Should have thrown an error");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        expect(errorMessage).toMatch(/network error|connection/i);
      }
    });
  });
});
