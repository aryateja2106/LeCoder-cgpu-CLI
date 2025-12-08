import { z } from "zod";

/**
 * Schema for Google Drive File resource.
 */
export const DriveFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  createdTime: z.string(),
  modifiedTime: z.string(),
  webViewLink: z.string().optional(),
});

/**
 * Schema for Drive Files.list response.
 */
export const DriveFileListSchema = z.object({
  files: z.array(DriveFileSchema),
  nextPageToken: z.string().optional(),
});

/**
 * Schema for notebook cell.
 */
export const NotebookCellSchema = z.object({
  cell_type: z.enum(["code", "markdown"]),
  source: z.union([z.string(), z.array(z.string())]),
  metadata: z.record(z.unknown()),
  outputs: z.array(z.unknown()).optional(),
  execution_count: z.union([z.number(), z.null()]).optional(),
});

/**
 * Schema for notebook content (.ipynb structure).
 */
export const NotebookContentSchema = z.object({
  cells: z.array(NotebookCellSchema),
  metadata: z.object({
    colab: z
      .object({
        name: z.string().optional(),
        provenance: z.array(z.unknown()).optional(),
        collapsed_sections: z.array(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
    kernelspec: z
      .object({
        name: z.string(),
        display_name: z.string(),
      })
      .optional(),
    language_info: z
      .object({
        name: z.string(),
        version: z.string().optional(),
      })
      .optional(),
  }).passthrough(),
  nbformat: z.number(),
  nbformat_minor: z.number(),
});
