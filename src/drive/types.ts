/**
 * Google Drive file metadata.
 */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink?: string;
}

/**
 * Jupyter notebook cell structure.
 */
export interface NotebookCell {
  cell_type: "code" | "markdown";
  source: string | string[];
  metadata: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
}

/**
 * Jupyter notebook content (.ipynb JSON structure).
 */
export interface NotebookContent {
  cells: NotebookCell[];
  metadata: {
    colab?: {
      name?: string;
      provenance?: unknown[];
      collapsed_sections?: unknown[];
      [key: string]: unknown;
    };
    kernelspec?: {
      name: string;
      display_name: string;
    };
    language_info?: {
      name: string;
      version?: string;
    };
    [key: string]: unknown;
  };
  nbformat: number;
  nbformat_minor: number;
}

/**
 * Enriched notebook information combining Drive metadata and Colab-specific fields.
 */
export interface NotebookInfo {
  id: string;
  name: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink?: string;
  colabName?: string;
}

/**
 * Query options for listing notebooks.
 */
export interface NotebookQuery {
  pageSize?: number;
  orderBy?: string;
  query?: string;
}

/**
 * Options for NotebookManager.listNotebooks().
 */
export interface ListOptions {
  limit?: number;
  orderBy?: "name" | "createdTime" | "modifiedTime";
}
