import { describe, it, expect, beforeEach, vi } from "vitest";
import { NotebookManager } from "../../src/drive/notebook-manager.js";
import type { DriveClient } from "../../src/drive/client.js";
import type { RuntimeManager } from "../../src/runtime/runtime-manager.js";
import { Variant } from "../../src/colab/api.js";

describe("NotebookManager", () => {
  let manager: NotebookManager;
  let mockDriveClient: Partial<DriveClient>;

  beforeEach(() => {
    mockDriveClient = {
      listNotebooks: vi.fn().mockResolvedValue([
        {
          id: "file1",
          name: "notebook1.ipynb",
          createdTime: "2024-01-01T00:00:00Z",
          modifiedTime: "2024-01-02T00:00:00Z",
          webViewLink: "https://colab.research.google.com/drive/file1",
        },
      ]),
      getNotebook: vi.fn().mockResolvedValue({
        id: "file1",
        name: "notebook1.ipynb",
        mimeType: "application/x-ipynb+json",
        createdTime: "2024-01-01T00:00:00Z",
        modifiedTime: "2024-01-02T00:00:00Z",
        webViewLink: "https://colab.research.google.com/drive/file1",
      }),
      getNotebookContent: vi.fn().mockResolvedValue({
        cells: [],
        metadata: {
          colab: { name: "Test Notebook" },
        },
        nbformat: 4,
        nbformat_minor: 0,
      }),
      createNotebook: vi.fn().mockResolvedValue({
        id: "newfile",
        name: "test.ipynb",
        mimeType: "application/x-ipynb+json",
        createdTime: "2024-01-01T00:00:00Z",
        modifiedTime: "2024-01-01T00:00:00Z",
        webViewLink: "https://colab.research.google.com/drive/newfile",
      }),
      deleteNotebook: vi.fn().mockResolvedValue(undefined),
    };

    manager = new NotebookManager(
      mockDriveClient as DriveClient
    );
  });

  describe("listNotebooks", () => {
    it("should list notebooks without enrichment by default (fast)", async () => {
      const result = await manager.listNotebooks();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "file1",
        name: "notebook1.ipynb",
      });
      expect(result[0].colabName).toBeUndefined();
      expect(mockDriveClient.listNotebooks).toHaveBeenCalled();
      expect(mockDriveClient.getNotebookContent).not.toHaveBeenCalled();
    });

    it("should list notebooks with enriched metadata when enrich=true", async () => {
      const result = await manager.listNotebooks({ enrich: true });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "file1",
        name: "notebook1.ipynb",
        colabName: "Test Notebook",
      });
      expect(mockDriveClient.listNotebooks).toHaveBeenCalled();
      expect(mockDriveClient.getNotebookContent).toHaveBeenCalled();
    });

    it("should apply list options", async () => {
      await manager.listNotebooks({
        limit: 10,
        orderBy: "name",
      });

      expect(mockDriveClient.listNotebooks).toHaveBeenCalledWith({
        pageSize: 10,
        orderBy: "name",
      });
    });

    it("should handle content fetch failures gracefully when enrich=true", async () => {
      (mockDriveClient.getNotebookContent as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Content unavailable")
      );

      const result = await manager.listNotebooks({ enrich: true });

      expect(result).toHaveLength(1);
      expect(result[0].colabName).toBeUndefined();
    });
  });

  describe("createNotebook", () => {
    it("should create notebook with default template", async () => {
      const result = await manager.createNotebook("test");

      expect(result.name).toBe("test.ipynb");
      expect(mockDriveClient.createNotebook).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({
          cells: expect.any(Array),
          metadata: expect.objectContaining({
            colab: expect.objectContaining({
              name: "test",
            }),
          }),
        })
      );
    });

    it("should create notebook with GPU template", async () => {
      await manager.createNotebook("gpu-test", "gpu");

      const call = (mockDriveClient.createNotebook as ReturnType<typeof vi.fn>).mock.calls[0];
      const content = call[1];
      
      expect(content.cells.some((cell: { source: string | string[] }) => 
        JSON.stringify(cell.source).includes("nvidia-smi")
      )).toBe(true);
    });

    it("should create notebook with TPU template", async () => {
      await manager.createNotebook("tpu-test", "tpu");

      const call = (mockDriveClient.createNotebook as ReturnType<typeof vi.fn>).mock.calls[0];
      const content = call[1];
      
      expect(content.cells.some((cell: { source: string | string[] }) => 
        JSON.stringify(cell.source).includes("TPU")
      )).toBe(true);
    });
  });

  describe("deleteNotebook", () => {
    it("should delete notebook by ID", async () => {
      await manager.deleteNotebook("file1");

      expect(mockDriveClient.deleteNotebook).toHaveBeenCalledWith("file1");
    });
  });

  describe("openNotebook", () => {
    it("should open notebook and assign runtime", async () => {
      const mockRuntimeManager = {
        assignRuntime: vi.fn().mockResolvedValue({
          label: "Colab GPU",
          accelerator: "Tesla T4",
          endpoint: "mock-endpoint",
        }),
      } as unknown as RuntimeManager;

      const result = await manager.openNotebook("file1", mockRuntimeManager);

      expect(result.notebook).toMatchObject({
        id: "file1",
        name: "notebook1.ipynb",
        colabName: "Test Notebook",
      });
      expect(result.runtime).toMatchObject({
        label: "Colab GPU",
        accelerator: "Tesla T4",
      });
      expect(mockRuntimeManager.assignRuntime).toHaveBeenCalledWith({
        forceNew: false,
        variant: Variant.GPU,
      });
    });

    it("should respect variant option", async () => {
      const mockRuntimeManager = {
        assignRuntime: vi.fn().mockResolvedValue({
          label: "Colab TPU",
          accelerator: "TPU v2",
          endpoint: "mock-endpoint",
        }),
      } as unknown as RuntimeManager;

      await manager.openNotebook("file1", mockRuntimeManager, {
        variant: "tpu",
      });

      expect(mockRuntimeManager.assignRuntime).toHaveBeenCalledWith({
        forceNew: false,
        variant: Variant.TPU,
      });
    });

    it("should request new runtime when specified", async () => {
      const mockRuntimeManager = {
        assignRuntime: vi.fn().mockResolvedValue({
          label: "Colab GPU",
          accelerator: "Tesla T4",
          endpoint: "mock-endpoint",
        }),
      } as unknown as RuntimeManager;

      await manager.openNotebook("file1", mockRuntimeManager, {
        forceNew: true,
      });

      expect(mockRuntimeManager.assignRuntime).toHaveBeenCalledWith({
        forceNew: true,
        variant: Variant.GPU,
      });
    });
  });
});
