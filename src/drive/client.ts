import fetch, { RequestInit } from "node-fetch";
import { z } from "zod";
import type { DriveFile, NotebookContent, NotebookQuery } from "./types.js";
import { DriveFileSchema, DriveFileListSchema, NotebookContentSchema } from "./schemas.js";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const UPLOAD_API_BASE = "https://www.googleapis.com/upload/drive/v3";

/**
 * Client for Google Drive API v3.
 * Handles CRUD operations for Colab notebooks (.ipynb files) stored in Drive.
 */
export class DriveClient {
  constructor(private readonly getAccessToken: () => Promise<string>) {}

  /**
   * List notebooks (.ipynb files) from user's Drive.
   */
  async listNotebooks(query?: NotebookQuery): Promise<DriveFile[]> {
    const url = new URL(`${DRIVE_API_BASE}/files`);
    
    // Build query to filter .ipynb files
    const queryParts = [
      "trashed=false",
      "(mimeType='application/x-ipynb+json' or name contains '.ipynb')",
    ];
    
    if (query?.query) {
      queryParts.push(query.query);
    }
    
    url.searchParams.set("q", queryParts.join(" and "));
    url.searchParams.set("fields", "files(id,name,mimeType,createdTime,modifiedTime,webViewLink)");
    url.searchParams.set("pageSize", String(query?.pageSize ?? 100));
    
    if (query?.orderBy) {
      url.searchParams.set("orderBy", query.orderBy);
    }

    const response = await this.issueRequest<z.infer<typeof DriveFileListSchema>>(
      url,
      { method: "GET" },
      DriveFileListSchema,
    );

    return response.files;
  }

  /**
   * Get single notebook metadata by file ID.
   */
  async getNotebook(fileId: string): Promise<DriveFile> {
    const url = new URL(`${DRIVE_API_BASE}/files/${fileId}`);
    url.searchParams.set("fields", "id,name,mimeType,createdTime,modifiedTime,webViewLink");

    return this.issueRequest<DriveFile>(url, { method: "GET" }, DriveFileSchema);
  }

  /**
   * Create a new notebook in Drive.
   */
  async createNotebook(name: string, content?: NotebookContent): Promise<DriveFile> {
    // Ensure .ipynb extension
    const fileName = name.endsWith(".ipynb") ? name : `${name}.ipynb`;
    
    const metadata = {
      name: fileName,
      mimeType: "application/x-ipynb+json",
    };

    const notebookContent = content ?? this.getMinimalNotebook();
    
    // Use multipart upload
    const boundary = "-------314159265358979323846";
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;

    const metadataPart = delimiter +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata);

    const contentPart = delimiter +
      "Content-Type: application/x-ipynb+json\r\n\r\n" +
      JSON.stringify(notebookContent);

    const body = metadataPart + contentPart + closeDelim;

    const url = new URL(`${UPLOAD_API_BASE}/files`);
    url.searchParams.set("uploadType", "multipart");
    url.searchParams.set("fields", "id,name,mimeType,createdTime,modifiedTime,webViewLink");

    return this.issueRequest<DriveFile>(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
      DriveFileSchema,
    );
  }

  /**
   * Delete a notebook by file ID.
   */
  async deleteNotebook(fileId: string): Promise<void> {
    const url = new URL(`${DRIVE_API_BASE}/files/${fileId}`);
    await this.issueRequest<void>(url, { method: "DELETE" });
  }

  /**
   * Get notebook content (.ipynb JSON).
   */
  async getNotebookContent(fileId: string): Promise<NotebookContent> {
    const url = new URL(`${DRIVE_API_BASE}/files/${fileId}`);
    url.searchParams.set("alt", "media");

    return this.issueRequest<NotebookContent>(url, { method: "GET" }, NotebookContentSchema);
  }

  /**
   * Issue HTTP request to Drive API with authentication.
   */
  private async issueRequest<T>(
    endpoint: URL,
    init: RequestInit,
    schema?: z.ZodType<T>,
  ): Promise<T> {
    const accessToken = await this.getAccessToken();
    
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      ...((init.headers as Record<string, string>) ?? {}),
    };

    const response = await fetch(endpoint.toString(), {
      ...init,
      headers,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Drive API error: ${response.status} ${response.statusText}\n${errorBody}`,
      );
    }

    if (response.status === 204 || init.method === "DELETE") {
      return undefined as T;
    }

    const json = await response.json();
    
    if (schema) {
      return schema.parse(json);
    }
    
    return json as T;
  }

  /**
   * Get minimal valid notebook structure.
   */
  private getMinimalNotebook(): NotebookContent {
    return {
      cells: [],
      metadata: {
        colab: {
          name: "New Notebook",
          provenance: [],
        },
        kernelspec: {
          name: "python3",
          display_name: "Python 3",
        },
        language_info: {
          name: "python",
        },
      },
      nbformat: 4,
      nbformat_minor: 0,
    };
  }
}
