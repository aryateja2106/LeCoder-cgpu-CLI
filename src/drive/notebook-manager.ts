import type { RuntimeManager } from "../runtime/runtime-manager.js";
import { Variant } from "../colab/api.js";
import { DriveClient } from "./client.js";
import type { NotebookInfo, ListOptions, NotebookContent } from "./types.js";
import { getDefaultTemplate, getGpuTemplate, getTpuTemplate } from "./templates.js";

/**
 * High-level manager for notebook operations.
 * Combines Drive API (for file management) with Colab API (for runtime operations).
 */
export class NotebookManager {
  constructor(private readonly driveClient: DriveClient) {}

  /**
   * List notebooks with formatted output.
   */
  async listNotebooks(options?: ListOptions): Promise<NotebookInfo[]> {
    const orderByMap: Record<string, string> = {
      name: "name",
      createdTime: "createdTime desc",
      modifiedTime: "modifiedTime desc",
    };

    const orderBy = options?.orderBy ? orderByMap[options.orderBy] : undefined;
    const pageSize = options?.limit ?? 50;

    const files = await this.driveClient.listNotebooks({
      pageSize,
      orderBy,
    });

    // Convert to NotebookInfo with enriched metadata
    const notebooks: NotebookInfo[] = [];
    for (const file of files) {
      try {
        const content = await this.driveClient.getNotebookContent(file.id);
        notebooks.push({
          id: file.id,
          name: file.name,
          createdTime: file.createdTime,
          modifiedTime: file.modifiedTime,
          webViewLink: file.webViewLink,
          colabName: content.metadata.colab?.name,
        });
      } catch {
        // If content fetch fails, use basic info
        notebooks.push({
          id: file.id,
          name: file.name,
          createdTime: file.createdTime,
          modifiedTime: file.modifiedTime,
          webViewLink: file.webViewLink,
        });
      }
    }

    return notebooks;
  }

  /**
   * Create a new notebook with optional template.
   */
  async createNotebook(name: string, template?: string): Promise<NotebookInfo> {
    const content = this.getTemplateContent(template);
    
    // Update template name
    content.metadata.colab = content.metadata.colab ?? {};
    content.metadata.colab.name = name;

    const file = await this.driveClient.createNotebook(name, content);

    return {
      id: file.id,
      name: file.name,
      createdTime: file.createdTime,
      modifiedTime: file.modifiedTime,
      webViewLink: file.webViewLink,
      colabName: content.metadata.colab.name,
    };
  }

  /**
   * Delete a notebook by file ID.
   */
  async deleteNotebook(fileId: string): Promise<void> {
    await this.driveClient.deleteNotebook(fileId);
  }

  /**
   * Open a notebook and assign runtime.
   * Returns both notebook info and runtime for connection.
   */
  async openNotebook(
    fileId: string,
    runtimeManager: RuntimeManager,
    options?: {
      forceNew?: boolean;
      variant?: "gpu" | "tpu" | "cpu";
    },
  ): Promise<{
    notebook: NotebookInfo;
    runtime: Awaited<ReturnType<RuntimeManager["assignRuntime"]>>;
  }> {
    // Get notebook metadata
    const file = await this.driveClient.getNotebook(fileId);
    const content = await this.driveClient.getNotebookContent(fileId);

    const notebook: NotebookInfo = {
      id: file.id,
      name: file.name,
      createdTime: file.createdTime,
      modifiedTime: file.modifiedTime,
      webViewLink: file.webViewLink,
      colabName: content.metadata.colab?.name,
    };

    // Assign runtime
    const runtime = await runtimeManager.assignRuntime({
      forceNew: options?.forceNew ?? false,
      variant: this.resolveVariant(options?.variant),
    });

    return { notebook, runtime };
  }

  /**
   * Get template content based on template type.
   */
  private getTemplateContent(template?: string): NotebookContent {
    switch (template?.toLowerCase()) {
      case "gpu":
        return getGpuTemplate();
      case "tpu":
        return getTpuTemplate();
      case "default":
      default:
        return getDefaultTemplate();
    }
  }

  /**
   * Resolve variant string to Colab API variant.
   */
  private resolveVariant(variant?: string): Variant | undefined {
    switch (variant?.toLowerCase()) {
      case "gpu":
        return Variant.GPU;
      case "tpu":
        return Variant.TPU;
      case "cpu":
        return Variant.DEFAULT;
      default:
        return Variant.GPU;
    }
  }
}
