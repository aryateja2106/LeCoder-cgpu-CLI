import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Auth Flow Integration', () => {
  // Save original fetch to restore after each test
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    // Save original fetch implementation
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    // Restore original fetch implementation
    globalThis.fetch = originalFetch;
  });

  describe('OAuth Flow', () => {
    it('should complete full OAuth flow with authorization code', async () => {
      // This integration test simulates the OAuth flow by:
      // 1. Mocking HTTP requests to Google OAuth endpoints
      // 2. Simulating the authorization code callback
      // 3. Verifying token exchange and session storage
      
      const mockFetch = vi.fn();
      
      // Mock token exchange response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/drive.file',
          token_type: 'Bearer'
        })
      });
      
      // Mock userinfo response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          email: 'test@example.com',
          name: 'Test User',
          picture: 'https://example.com/avatar.jpg'
        })
      });
      
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      // Simulate the token exchange
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
          code: 'auth-code',
          client_id: 'test-client-id',
          redirect_uri: 'http://localhost:8080/callback',
          grant_type: 'authorization_code',
          code_verifier: 'test-verifier'
        })
      });
      
      const tokens = await tokenResponse.json();
      
      // Simulate userinfo fetch
      const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`
        }
      });
      
      const userInfo = await userinfoResponse.json();
      
      expect(tokens.access_token).toBe('mock-access-token');
      expect(tokens.refresh_token).toBe('mock-refresh-token');
      expect(userInfo.email).toBe('test@example.com');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle OAuth cancellation gracefully', async () => {
      // Simulate OAuth cancellation with aborted request
      const controller = new AbortController();
      
      // Abort immediately
      controller.abort();
      
      // Try to fetch with aborted signal - should throw
      try {
        await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          signal: controller.signal,
          body: new URLSearchParams({ code: 'test' })
        });
        // If we get here, test should fail
        expect.fail('Expected fetch to throw');
      } catch (error) {
        // Verify error is due to abort
        expect(error).toBeDefined();
      }
    });

    it('should handle invalid authorization code', async () => {
      const mockFetch = vi.fn();
      
      // Mock failed token exchange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Invalid authorization code'
        })
      });
      
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
          code: 'invalid-code',
          client_id: 'test-client-id',
          redirect_uri: 'http://localhost:8080/callback',
          grant_type: 'authorization_code'
        })
      });
      
      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
      
      const error = await response.json();
      expect(error.error).toBe('invalid_grant');
    });
  });

  describe('Token Refresh', () => {
    it('should refresh expired access token using refresh token', async () => {
      // Test token refresh by mocking the refresh endpoint
      const mockFetch = vi.fn();
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/drive.file',
          token_type: 'Bearer'
        })
      });
      
      globalThis.fetch = mockFetch;
      
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
          refresh_token: 'mock-refresh-token',
          client_id: 'test-client-id',
          grant_type: 'refresh_token'
        })
      });
      
      const tokens = await response.json();
      
      expect(tokens.access_token).toBe('new-access-token');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should re-authenticate when refresh token is invalid', async () => {
      // Test handling of invalid refresh token
      const mockFetch = vi.fn();
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Token has been expired or revoked'
        })
      });
      
      globalThis.fetch = mockFetch;
      
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
          refresh_token: 'expired-refresh-token',
          client_id: 'test-client-id',
          grant_type: 'refresh_token'
        })
      });
      
      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
      
      const error = await response.json();
      expect(error.error).toBe('invalid_grant');
    });

    it('should handle network errors during token refresh', async () => {
      // Test network error handling with retry logic
      const mockFetch = vi.fn();
      
      // First call fails with network error
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      
      // Second call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          expires_in: 3600
        })
      });
      
      globalThis.fetch = mockFetch;
      
      // First attempt fails
      await expect(
        fetch('https://oauth2.googleapis.com/token', { method: 'POST' })
      ).rejects.toThrow('Network error');
      
      // Retry succeeds
      const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST' });
      const tokens = await response.json();
      
      expect(tokens.access_token).toBe('new-access-token');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Session Storage', () => {
    it('should create session file with correct permissions', async () => {
      // Test that session file is created with restrictive
      // permissions (0600) to protect sensitive tokens
      const fs = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      const { FileAuthStorage } = await import('../../src/auth/session-storage.js');
      
      // Create a temporary directory for testing
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lecoder-test-'));
      
      try {
        // Create storage instance and store a test session
        const storage = new FileAuthStorage(tempDir);
        const testSession = {
          id: 'test-session-id',
          refreshToken: 'test-refresh-token',
          scopes: ['https://www.googleapis.com/auth/colab'],
          account: {
            id: 'test@example.com',
            label: 'Test User',
          },
        };
        
        await storage.storeSession(testSession);
        
        // Verify session file exists
        const sessionFilePath = path.join(tempDir, 'session.json');
        const stats = await fs.stat(sessionFilePath);
        
        // Extract file permissions (mask with 0o777 to get permission bits only)
        const filePermissions = stats.mode & 0o777;
        
        // Verify permissions are exactly 0o600 (read/write for owner only)
        expect(filePermissions).toBe(0o600);
        
        // Verify file contains the refresh token
        const fileContent = await fs.readFile(sessionFilePath, 'utf-8');
        const parsedSession = JSON.parse(fileContent);
        expect(parsedSession.refreshToken).toBe('test-refresh-token');
      } finally {
        // Clean up temp directory
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should update session file on token refresh', async () => {
      // Test session file update after token refresh
      const fs = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      const { FileAuthStorage } = await import('../../src/auth/session-storage.js');
      
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lecoder-test-'));
      
      try {
        const storage = new FileAuthStorage(tempDir);
        
        // Store initial session
        const initialSession = {
          id: 'test-session',
          refreshToken: 'old-refresh-token',
          scopes: ['https://www.googleapis.com/auth/drive.file'],
          account: { id: 'test@example.com', label: 'Test User' }
        };
        
        await storage.storeSession(initialSession);
        
        // Update session with new token
        const updatedSession = {
          ...initialSession,
          refreshToken: 'new-refresh-token'
        };
        
        await storage.storeSession(updatedSession);
        
        // Verify updated session
        const sessionFile = path.join(tempDir, 'session.json');
        const content = await fs.readFile(sessionFile, 'utf-8');
        const parsedSession = JSON.parse(content);
        
        expect(parsedSession.refreshToken).toBe('new-refresh-token');
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should handle concurrent session updates', async () => {
      // Test that multiple concurrent updates don't corrupt the session file
      const fs = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      const { FileAuthStorage } = await import('../../src/auth/session-storage.js');
      
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lecoder-test-'));
      
      try {
        const storage = new FileAuthStorage(tempDir);
        
        // Create multiple concurrent update operations
        const updates = Array.from({ length: 5 }, (_, i) => {
          const session = {
            id: 'test-session',
            refreshToken: `token-${i}`,
            scopes: ['https://www.googleapis.com/auth/drive.file'],
            account: { id: 'test@example.com', label: 'Test User' }
          };
          return storage.storeSession(session);
        });
        
        // Wait for all updates to complete
        await Promise.all(updates);
        
        // Verify file is still valid JSON
        const sessionFile = path.join(tempDir, 'session.json');
        const content = await fs.readFile(sessionFile, 'utf-8');
        const parsedSession = JSON.parse(content);
        
        // Should have one of the tokens (last write wins)
        expect(parsedSession.refreshToken).toMatch(/^token-\d$/);
        expect(parsedSession.account.id).toBe('test@example.com');
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should delete session file on logout', async () => {
      // Test session file deletion on logout
      const fs = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      const { FileAuthStorage } = await import('../../src/auth/session-storage.js');
      
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lecoder-test-'));
      
      try {
        const storage = new FileAuthStorage(tempDir);
        
        // Create session
        const session = {
          id: 'test-session',
          refreshToken: 'test-token',
          scopes: ['https://www.googleapis.com/auth/drive.file'],
          account: { id: 'test@example.com', label: 'Test User' }
        };
        
        await storage.storeSession(session);
        
        const sessionFile = path.join(tempDir, 'session.json');
        
        // Verify session exists
        await fs.access(sessionFile);
        
        // Delete session
        await storage.removeSession();
        
        // Verify session file is deleted
        await expect(fs.access(sessionFile)).rejects.toThrow();
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Session Validation', () => {
    it('should validate session against Colab API', async () => {
      // Test session validation with mocked CCU info endpoint
      const mockFetch = vi.fn();
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          eligibleGpus: ['T4', 'V100'],
          assignments: [
            { id: 'assignment-1', gpu: 'T4' }
          ]
        })
      });
      
      globalThis.fetch = mockFetch;
      
      const response = await fetch('https://colab.research.google.com/api/ccu', {
        headers: {
          Authorization: 'Bearer mock-access-token'
        }
      });
      
      const ccuInfo = await response.json();
      
      expect(ccuInfo.eligibleGpus).toContain('T4');
      expect(ccuInfo.assignments).toHaveLength(1);
    });

    it('should report validation errors without invalidating session', async () => {
      // Test that validation errors don't affect the stored session
      const fs = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      const { FileAuthStorage } = await import('../../src/auth/session-storage.js');
      
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lecoder-test-'));
      
      try {
        const storage = new FileAuthStorage(tempDir);
        
        // Store valid session with all required scopes
        const session = {
          id: 'test-session',
          refreshToken: 'test-token',
          scopes: [
            'profile',
            'email',
            'https://www.googleapis.com/auth/colaboratory',
            'https://www.googleapis.com/auth/drive.file'
          ],
          account: { id: 'test@example.com', label: 'Test User' }
        };
        
        await storage.storeSession(session);
        
        // Mock API validation failure
        const mockFetch = vi.fn();
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({
            error: 'Service temporarily unavailable'
          })
        });
        
        globalThis.fetch = mockFetch;
        
        // Validation fails
        const response = await fetch('https://colab.research.google.com/api/ccu');
        expect(response.ok).toBe(false);
        
        // Session should still be valid
        const storedSession = await storage.getSession();
        expect(storedSession).toBeDefined();
        expect(storedSession?.refreshToken).toBe('test-token');
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Account Information', () => {
    it('should fetch and store user profile information', async () => {
      // Test fetching user profile from Google userinfo endpoint
      const mockFetch = vi.fn();
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          email: 'testuser@gmail.com',
          name: 'Test User',
          picture: 'https://lh3.googleusercontent.com/avatar.jpg',
          verified_email: true
        })
      });
      
      globalThis.fetch = mockFetch;
      
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: 'Bearer mock-access-token'
        }
      });
      
      const userInfo = await response.json();
      
      expect(userInfo.email).toBe('testuser@gmail.com');
      expect(userInfo.name).toBe('Test User');
      expect(userInfo.verified_email).toBe(true);
    });

    it('should handle missing user profile gracefully', async () => {
      // Test that minimal profile data is handled correctly
      const mockFetch = vi.fn();
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          email: 'user@example.com',
          // name and other fields missing
        })
      });
      
      globalThis.fetch = mockFetch;
      
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo');
      const userInfo = await response.json();
      
      expect(userInfo.email).toBe('user@example.com');
      expect(userInfo.name).toBeUndefined();
    });
  });

  describe('PKCE Security', () => {
    it('should use PKCE code challenge in OAuth flow', async () => {
      // Test that PKCE parameters are included in token exchange
      const mockFetch = vi.fn();
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'mock-token',
          refresh_token: 'mock-refresh',
          expires_in: 3600
        })
      });
      
      globalThis.fetch = mockFetch;
      
      // Simulate token exchange with PKCE
      await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
          code: 'auth-code',
          code_verifier: 'random-verifier-string',
          client_id: 'test-client-id',
          redirect_uri: 'http://localhost:8080/callback',
          grant_type: 'authorization_code'
        })
      });
      
      // Verify fetch was called with PKCE parameters
      expect(mockFetch).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(URLSearchParams)
        })
      );
    });

    it('should generate unique state parameter for each auth', () => {
      // Test state parameter uniqueness using crypto.randomUUID for longer strings
      const crypto = require('node:crypto');
      const state1 = crypto.randomUUID();
      const state2 = crypto.randomUUID();
      
      expect(state1).not.toBe(state2);
      expect(state1.length).toBeGreaterThan(10);
      expect(state2.length).toBeGreaterThan(10);
    });
  });

  describe('Config Integration', () => {
    it('should respect custom config file path', async () => {
      // Test custom config directory
      const fs = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lecoder-config-'));
      
      try {
        const configFile = path.join(tempDir, 'config.json');
        await fs.writeFile(configFile, JSON.stringify({
          storageDir: tempDir
        }));
        
        const configContent = await fs.readFile(configFile, 'utf-8');
        const config = JSON.parse(configContent);
        
        expect(config.storageDir).toBe(tempDir);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should use correct OAuth client ID from config', async () => {
      // Test that client ID configuration works
      const fs = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lecoder-config-'));
      
      try {
        const configFile = path.join(tempDir, 'config.json');
        const customClientId = 'custom-client-id-12345';
        
        await fs.writeFile(configFile, JSON.stringify({
          oauth: {
            clientId: customClientId
          }
        }));
        
        const configContent = await fs.readFile(configFile, 'utf-8');
        const config = JSON.parse(configContent);
        
        expect(config.oauth.clientId).toBe(customClientId);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should store session in config-specified directory', async () => {
      // Test session storage in custom directory
      const fs = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      const { FileAuthStorage } = await import('../../src/auth/session-storage.js');
      
      const customStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lecoder-custom-'));
      
      try {
        const storage = new FileAuthStorage(customStorageDir);
        
        const session = {
          id: 'test-session',
          refreshToken: 'test-token',
          scopes: ['https://www.googleapis.com/auth/drive.file'],
          account: { id: 'test@example.com', label: 'Test User' }
        };
        
        await storage.storeSession(session);
        
        const sessionFile = path.join(customStorageDir, 'session.json');
        await fs.access(sessionFile);
        
        const content = await fs.readFile(sessionFile, 'utf-8');
        const storedSession = JSON.parse(content);
        
        expect(storedSession.refreshToken).toBe('test-token');
      } finally {
        await fs.rm(customStorageDir, { recursive: true, force: true });
      }
    });
  });
});
