import { describe, it, expect, beforeEach, vi } from "vitest";
import { DriveClient } from "../../src/drive/client.js";
import type { NotebookContent } from "../../src/drive/types.js";

describe("DriveClient", () => {
  let client: DriveClient;
  let mockGetAccessToken: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetAccessToken = vi.fn().mockResolvedValue("mock-access-token");
    client = new DriveClient(mockGetAccessToken);
    
    // Mock global fetch
    global.fetch = vi.fn();
  });

  describe("listNotebooks", () => {
    it("should list notebooks with default query", async () => {
      const mockResponse = {
        files: [
          {
            id: "file1",
            name: "notebook1.ipynb",
            mimeType: "application/x-ipynb+json",
            createdTime: "2024-01-01T00:00:00Z",
            modifiedTime: "2024-01-02T00:00:00Z",
            webViewLink: "https://colab.research.google.com/drive/file1",
          },
        ],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const result = await client.listNotebooks();

      expect(result).toEqual(mockResponse.files);
      expect(mockGetAccessToken).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/files"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer mock-access-token",
          }),
        })
      );
    });

    it("should apply query parameters", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ files: [] }),
      });

      await client.listNotebooks({
        pageSize: 10,
        orderBy: "name",
        query: "name contains 'test'",
      });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const url = new URL(fetchCall[0]);
      
      expect(url.searchParams.get("pageSize")).toBe("10");
      expect(url.searchParams.get("orderBy")).toBe("name");
      expect(url.searchParams.get("q")).toContain("name contains 'test'");
    });
  });

  describe("createNotebook", () => {
    it("should create notebook with default content", async () => {
      const mockResponse = {
        id: "newfile",
        name: "test.ipynb",
        mimeType: "application/x-ipynb+json",
        createdTime: "2024-01-01T00:00:00Z",
        modifiedTime: "2024-01-01T00:00:00Z",
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const result = await client.createNotebook("test");

      expect(result.name).toBe("test.ipynb");
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("upload/drive/v3/files"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer mock-access-token",
            "Content-Type": expect.stringContaining("multipart/related"),
          }),
        })
      );
    });

    it("should create notebook with custom content", async () => {
      const customContent: NotebookContent = {
        cells: [
          {
            cell_type: "code",
            source: ["print('hello')"],
            metadata: {},
          },
        ],
        metadata: {
          colab: { name: "Custom" },
        },
        nbformat: 4,
        nbformat_minor: 0,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: "custom",
          name: "custom.ipynb",
          mimeType: "application/x-ipynb+json",
          createdTime: "2024-01-01T00:00:00Z",
          modifiedTime: "2024-01-01T00:00:00Z",
        }),
      });

      await client.createNotebook("custom", customContent);

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = fetchCall[1].body as string;
      
      expect(body).toContain("print('hello')");
    });
  });

  describe("deleteNotebook", () => {
    it("should delete notebook by ID", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 204,
      });

      await client.deleteNotebook("file1");

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/files/file1"),
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  describe("getNotebookContent", () => {
    it("should fetch notebook content", async () => {
      const mockContent: NotebookContent = {
        cells: [],
        metadata: {
          colab: { name: "Test" },
        },
        nbformat: 4,
        nbformat_minor: 0,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockContent),
      });

      const result = await client.getNotebookContent("file1");

      expect(result).toEqual(mockContent);
      
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const url = new URL(fetchCall[0]);
      expect(url.searchParams.get("alt")).toBe("media");
    });
  });

  describe("error handling", () => {
    it("should throw on API errors", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: vi.fn().mockResolvedValue("File not found"),
      });

      await expect(client.getNotebook("nonexistent")).rejects.toThrow(
        /Drive API error.*404/
      );
    });
  });
});
