/**
 * Mock DriveClient for testing
 *
 * Simulates Google Drive API responses for testing without live connections.
 * Supports file operations and error simulation.
 */

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  createdTime: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
  trashed?: boolean;
}

export interface FileList {
  files: DriveFile[];
  nextPageToken?: string;
}

export interface MockDriveClientConfig {
  simulateRateLimit?: boolean;
  simulate404?: boolean;
  simulate403?: boolean;
  pageSize?: number;
}

export interface MethodCall {
  method: string;
  args: unknown[];
  timestamp: Date;
}

export class MockDriveClient {
  private files: Map<string, DriveFile> = new Map();
  private callHistory: MethodCall[] = [];
  private config: Required<MockDriveClientConfig>;
  private requestCount = 0;

  constructor(config: MockDriveClientConfig = {}) {
    this.config = {
      simulateRateLimit: config.simulateRateLimit ?? false,
      simulate404: config.simulate404 ?? false,
      simulate403: config.simulate403 ?? false,
      pageSize: config.pageSize ?? 10,
    };
  }

  /**
   * List files with optional query and pagination
   */
  async listFiles(options: {
    query?: string;
    pageToken?: string;
    pageSize?: number;
    fields?: string;
    orderBy?: string;
  } = {}): Promise<FileList> {
    this.recordCall('listFiles', [options]);
    await this.checkForErrors();

    const pageSize = options.pageSize ?? this.config.pageSize;
    let allFiles = Array.from(this.files.values()).filter((f) => !f.trashed);

    // Apply query filter (simplified)
    if (options.query) {
      const query = options.query.toLowerCase();
      if (query.includes('mimetype')) {
        const mimeMatch = query.match(/mimetype\s*=\s*'([^']+)'/);
        if (mimeMatch) {
          allFiles = allFiles.filter((f) => f.mimeType === mimeMatch[1]);
        }
      }
      if (query.includes('name contains')) {
        const nameMatch = query.match(/name contains '([^']+)'/);
        if (nameMatch) {
          allFiles = allFiles.filter((f) =>
            f.name.toLowerCase().includes(nameMatch[1].toLowerCase())
          );
        }
      }
    }

    // Apply ordering
    if (options.orderBy) {
      const [field, direction] = options.orderBy.split(' ');
      allFiles.sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[field] as string;
        const bVal = (b as Record<string, unknown>)[field] as string;
        const cmp = aVal.localeCompare(bVal);
        return direction === 'desc' ? -cmp : cmp;
      });
    }

    // Handle pagination
    let startIndex = 0;
    if (options.pageToken) {
      startIndex = parseInt(options.pageToken, 10);
    }

    const pageFiles = allFiles.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < allFiles.length;

    return {
      files: pageFiles,
      nextPageToken: hasMore ? String(startIndex + pageSize) : undefined,
    };
  }

  /**
   * Get a single file by ID
   */
  async getFile(fileId: string, fields?: string): Promise<DriveFile> {
    this.recordCall('getFile', [fileId, fields]);
    await this.checkForErrors();

    if (this.config.simulate404) {
      throw this.createError(404, 'File not found');
    }

    const file = this.files.get(fileId);
    if (!file) {
      throw this.createError(404, `File not found: ${fileId}`);
    }

    return file;
  }

  /**
   * Create a new file
   */
  async createFile(metadata: {
    name: string;
    mimeType: string;
    parents?: string[];
    content?: string;
  }): Promise<DriveFile> {
    this.recordCall('createFile', [metadata]);
    await this.checkForErrors();

    if (this.config.simulate403) {
      throw this.createError(403, 'Access denied');
    }

    const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const file: DriveFile = {
      id,
      name: metadata.name,
      mimeType: metadata.mimeType,
      parents: metadata.parents,
      createdTime: now,
      modifiedTime: now,
      size: metadata.content ? String(metadata.content.length) : '0',
      webViewLink: `https://drive.google.com/file/d/${id}/view`,
      trashed: false,
    };

    this.files.set(id, file);
    return file;
  }

  /**
   * Update a file
   */
  async updateFile(
    fileId: string,
    metadata: Partial<{ name: string; content: string }>
  ): Promise<DriveFile> {
    this.recordCall('updateFile', [fileId, metadata]);
    await this.checkForErrors();

    const file = this.files.get(fileId);
    if (!file) {
      throw this.createError(404, `File not found: ${fileId}`);
    }

    if (metadata.name) {
      file.name = metadata.name;
    }
    if (metadata.content) {
      file.size = String(metadata.content.length);
    }
    file.modifiedTime = new Date().toISOString();

    return file;
  }

  /**
   * Delete a file (move to trash)
   */
  async deleteFile(fileId: string, permanent = false): Promise<void> {
    this.recordCall('deleteFile', [fileId, permanent]);
    await this.checkForErrors();

    const file = this.files.get(fileId);
    if (!file) {
      throw this.createError(404, `File not found: ${fileId}`);
    }

    if (permanent) {
      this.files.delete(fileId);
    } else {
      file.trashed = true;
      file.modifiedTime = new Date().toISOString();
    }
  }

  /**
   * Copy a file
   */
  async copyFile(fileId: string, newName?: string): Promise<DriveFile> {
    this.recordCall('copyFile', [fileId, newName]);
    await this.checkForErrors();

    const original = this.files.get(fileId);
    if (!original) {
      throw this.createError(404, `File not found: ${fileId}`);
    }

    const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const copy: DriveFile = {
      ...original,
      id,
      name: newName ?? `Copy of ${original.name}`,
      createdTime: now,
      modifiedTime: now,
    };

    this.files.set(id, copy);
    return copy;
  }

  /**
   * Search for files
   */
  async searchFiles(query: string): Promise<DriveFile[]> {
    this.recordCall('searchFiles', [query]);
    await this.checkForErrors();

    const result = await this.listFiles({ query, pageSize: 100 });
    return result.files;
  }

  // Test helper methods

  /**
   * Get method call history
   */
  getCallHistory(): MethodCall[] {
    return [...this.callHistory];
  }

  /**
   * Clear method call history
   */
  clearCallHistory(): void {
    this.callHistory = [];
  }

  /**
   * Get call count for a specific method
   */
  getCallCount(method: string): number {
    return this.callHistory.filter((c) => c.method === method).length;
  }

  /**
   * Add a pre-configured file
   */
  addFile(file: DriveFile): void {
    this.files.set(file.id, file);
  }

  /**
   * Add multiple files
   */
  addFiles(files: DriveFile[]): void {
    for (const file of files) {
      this.files.set(file.id, file);
    }
  }

  /**
   * Get a file directly (without API call)
   */
  getFileDirectly(fileId: string): DriveFile | undefined {
    return this.files.get(fileId);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<MockDriveClientConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.files.clear();
    this.callHistory = [];
    this.requestCount = 0;
  }

  /**
   * Get current file count
   */
  getFileCount(): number {
    return this.files.size;
  }

  /**
   * Create test notebook files
   */
  createTestNotebooks(count: number): DriveFile[] {
    const notebooks: DriveFile[] = [];
    for (let i = 0; i < count; i++) {
      const file = this.createTestNotebook(`Test Notebook ${i + 1}`);
      notebooks.push(file);
    }
    return notebooks;
  }

  /**
   * Create a single test notebook
   */
  createTestNotebook(name: string): DriveFile {
    const id = `notebook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const file: DriveFile = {
      id,
      name: name.endsWith('.ipynb') ? name : `${name}.ipynb`,
      mimeType: 'application/vnd.google.colaboratory',
      createdTime: now,
      modifiedTime: now,
      size: '1024',
      webViewLink: `https://colab.research.google.com/drive/${id}`,
      trashed: false,
    };

    this.files.set(id, file);
    return file;
  }

  // Private helper methods

  private recordCall(method: string, args: unknown[]): void {
    this.callHistory.push({
      method,
      args,
      timestamp: new Date(),
    });
    this.requestCount++;
  }

  private async checkForErrors(): Promise<void> {
    // Simulate rate limiting (every 10th request)
    if (this.config.simulateRateLimit && this.requestCount % 10 === 0) {
      throw this.createError(429, 'Rate limit exceeded');
    }
  }

  private createError(status: number, message: string): Error & { status: number } {
    const error = new Error(message) as Error & { status: number };
    error.status = status;
    return error;
  }
}

// Factory function for creating pre-configured clients
export function createMockDriveClient(
  preset: 'default' | 'rate-limited' | 'access-denied' | 'empty' = 'default'
): MockDriveClient {
  switch (preset) {
    case 'rate-limited':
      return new MockDriveClient({ simulateRateLimit: true });
    case 'access-denied':
      return new MockDriveClient({ simulate403: true });
    case 'empty':
      return new MockDriveClient();
    default: {
      const client = new MockDriveClient();
      // Add some default test notebooks
      client.createTestNotebooks(3);
      return client;
    }
  }
}
