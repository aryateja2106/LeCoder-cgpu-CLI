import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock, MockInstance } from 'vitest';

// Helper function to simulate auth command logic
async function executeAuthCommand(
  auth: { getAccessToken: Mock; signOut: Mock },
  colabClient: { getCcuInfo: Mock },
  readline: { question: Mock; close: Mock },
  options: { force?: boolean; validate?: boolean; forceLogin?: boolean }
): Promise<void> {
  let existingSession: { account: { id: string; label: string } } | undefined;
  
  try {
    existingSession = await auth.getAccessToken(options.forceLogin || false);
  } catch {
    existingSession = undefined;
  }

  if (existingSession && !options.force && !options.forceLogin) {
    console.log(`Currently authenticated as ${existingSession.account.label} <${existingSession.account.id}>`);
    
    if (process.stdin.isTTY) {
      const answer = await readline.question('Re-authenticate? This will clear your current session. (y/N): ');
      readline.close();
      
      if (!answer.toLowerCase().match(/^y(es)?$/)) {
        console.log('Authentication cancelled.');
        return;
      }
    }
  }

  if (existingSession || options.forceLogin) {
    await auth.signOut();
  }

  const session = await auth.getAccessToken(true);
  console.log(`✓ Authenticated as ${session.account.label} <${session.account.id}>`);

  if (options.validate) {
    try {
      const ccu = await colabClient.getCcuInfo();
      console.log(`  Eligible GPUs: ${ccu.eligibleGpus.join(', ') || 'None'}`);
      if (ccu.assignments && ccu.assignments.length > 0) {
        console.log(`  Active assignments: ${ccu.assignments.length}`);
      }
    } catch (error) {
      console.log(`Validation failed: ${(error as Error).message}`);
    }
  }
}

describe('Auth Command', () => {
  let mockAuth: { getAccessToken: Mock; signOut: Mock };
  let mockColabClient: { getCcuInfo: Mock };
  let mockReadline: { question: Mock; close: Mock };
  let consoleLogSpy: MockInstance;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    originalIsTTY = process.stdin.isTTY;
    
    mockAuth = {
      getAccessToken: vi.fn(),
      signOut: vi.fn(),
    };
    
    mockColabClient = {
      getCcuInfo: vi.fn(),
    };
    
    mockReadline = {
      question: vi.fn(),
      close: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleLogSpy.mockRestore();
    if (originalIsTTY !== undefined) {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true });
    }
  });

  describe('Authentication Flow', () => {
    it('should authenticate successfully when no session exists', async () => {
      const newSession = {
        accessToken: 'new-access-token',
        account: { id: 'user@example.com', label: 'Test User' }
      };
      
      mockAuth.getAccessToken
        .mockRejectedValueOnce(new Error('No session'))
        .mockResolvedValueOnce(newSession);
      
      await executeAuthCommand(mockAuth, mockColabClient, mockReadline, {});
      
      expect(mockAuth.signOut).not.toHaveBeenCalled();
      expect(mockAuth.getAccessToken).toHaveBeenCalledTimes(2);
      expect(mockAuth.getAccessToken).toHaveBeenNthCalledWith(1, false);
      expect(mockAuth.getAccessToken).toHaveBeenNthCalledWith(2, true);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Authenticated as'));
    });

    it('should prompt for confirmation when session exists and --force not set', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
      
      const existingSession = {
        accessToken: 'existing-token',
        account: { id: 'user@example.com', label: 'Test User' }
      };
      
      mockAuth.getAccessToken.mockResolvedValueOnce(existingSession);
      mockReadline.question.mockResolvedValueOnce('n');
      
      await executeAuthCommand(mockAuth, mockColabClient, mockReadline, {});
      
      expect(mockReadline.question).toHaveBeenCalledWith(expect.stringContaining('Re-authenticate?'));
      expect(mockAuth.signOut).not.toHaveBeenCalled();
      expect(mockAuth.getAccessToken).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('cancelled'));
    });

    it('should re-authenticate when --force flag is set', async () => {
      const existingSession = {
        accessToken: 'existing-token',
        account: { id: 'user@example.com', label: 'Test User' }
      };
      
      const newSession = {
        accessToken: 'new-token',
        account: { id: 'user@example.com', label: 'Test User' }
      };
      
      mockAuth.getAccessToken
        .mockResolvedValueOnce(existingSession)
        .mockResolvedValueOnce(newSession);
      
      await executeAuthCommand(mockAuth, mockColabClient, mockReadline, { force: true });
      
      expect(mockReadline.question).not.toHaveBeenCalled();
      expect(mockAuth.signOut).toHaveBeenCalledTimes(1);
      expect(mockAuth.getAccessToken).toHaveBeenCalledTimes(2);
      expect(mockAuth.getAccessToken).toHaveBeenNthCalledWith(2, true);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Authenticated as'));
    });

    it('should skip prompt in non-interactive terminal', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true });
      
      const existingSession = {
        accessToken: 'existing-token',
        account: { id: 'user@example.com', label: 'Test User' }
      };
      
      const newSession = {
        accessToken: 'new-token',
        account: { id: 'user@example.com', label: 'Test User' }
      };
      
      mockAuth.getAccessToken
        .mockResolvedValueOnce(existingSession)
        .mockResolvedValueOnce(newSession);
      
      await executeAuthCommand(mockAuth, mockColabClient, mockReadline, {});
      
      expect(mockReadline.question).not.toHaveBeenCalled();
      expect(mockAuth.signOut).toHaveBeenCalled();
      expect(mockAuth.getAccessToken).toHaveBeenCalledWith(true);
    });

    it('should respect global --force-login option', async () => {
      const existingSession = {
        accessToken: 'existing-token',
        account: { id: 'user@example.com', label: 'Test User' }
      };
      
      const newSession = {
        accessToken: 'new-token',
        account: { id: 'user@example.com', label: 'Test User' }
      };
      
      mockAuth.getAccessToken
        .mockResolvedValueOnce(existingSession)
        .mockResolvedValueOnce(newSession);
      
      await executeAuthCommand(mockAuth, mockColabClient, mockReadline, { forceLogin: true });
      
      expect(mockReadline.question).not.toHaveBeenCalled();
      expect(mockAuth.signOut).toHaveBeenCalled();
      expect(mockAuth.getAccessToken).toHaveBeenCalledWith(true);
    });
  });

  describe('Credential Validation', () => {
    it('should validate credentials when --validate flag is set', async () => {
      const newSession = {
        accessToken: 'new-access-token',
        account: { id: 'user@example.com', label: 'Test User' }
      };
      
      const ccuInfo = {
        eligibleGpus: ['T4', 'V100'],
        assignments: []
      };
      
      mockAuth.getAccessToken
        .mockRejectedValueOnce(new Error('No session'))
        .mockResolvedValueOnce(newSession);
      mockColabClient.getCcuInfo.mockResolvedValueOnce(ccuInfo);
      
      await executeAuthCommand(mockAuth, mockColabClient, mockReadline, { validate: true });
      
      expect(mockColabClient.getCcuInfo).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Eligible GPUs: T4, V100'));
    });

    it('should handle validation failure gracefully', async () => {
      const newSession = {
        accessToken: 'new-access-token',
        account: { id: 'user@example.com', label: 'Test User' }
      };
      
      mockAuth.getAccessToken
        .mockRejectedValueOnce(new Error('No session'))
        .mockResolvedValueOnce(newSession);
      mockColabClient.getCcuInfo.mockRejectedValueOnce(new Error('API Error'));
      
      await executeAuthCommand(mockAuth, mockColabClient, mockReadline, { validate: true });
      
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Validation failed'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Authenticated as'));
    });

    it('should skip validation when --validate flag not set', async () => {
      const newSession = {
        accessToken: 'new-access-token',
        account: { id: 'user@example.com', label: 'Test User' }
      };
      
      mockAuth.getAccessToken
        .mockRejectedValueOnce(new Error('No session'))
        .mockResolvedValueOnce(newSession);
      
      await executeAuthCommand(mockAuth, mockColabClient, mockReadline, {});
      
      expect(mockColabClient.getCcuInfo).not.toHaveBeenCalled();
    });

    it('should display CCU info including assignments', async () => {
      const newSession = {
        accessToken: 'new-access-token',
        account: { id: 'user@example.com', label: 'Test User' }
      };
      
      const ccuInfo = {
        eligibleGpus: ['T4', 'A100'],
        assignments: [{ id: 'assignment-1' }, { id: 'assignment-2' }]
      };
      
      mockAuth.getAccessToken
        .mockRejectedValueOnce(new Error('No session'))
        .mockResolvedValueOnce(newSession);
      mockColabClient.getCcuInfo.mockResolvedValueOnce(ccuInfo);
      
      await executeAuthCommand(mockAuth, mockColabClient, mockReadline, { validate: true });
      
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Active assignments: 2'));
    });
  });

  describe('User Interaction', () => {
    beforeEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    });

    const testConfirmation = async (input: string, shouldProceed: boolean) => {
      const existingSession = {
        accessToken: 'existing-token',
        account: { id: 'user@example.com', label: 'Test User' }
      };
      
      const newSession = {
        accessToken: 'new-token',
        account: { id: 'user@example.com', label: 'Test User' }
      };
      
      mockAuth.getAccessToken
        .mockResolvedValueOnce(existingSession)
        .mockResolvedValueOnce(newSession);
      mockReadline.question.mockResolvedValueOnce(input);
      
      await executeAuthCommand(mockAuth, mockColabClient, mockReadline, {});
      
      if (shouldProceed) {
        expect(mockAuth.signOut).toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Authenticated as'));
      } else {
        expect(mockAuth.signOut).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('cancelled'));
      }
    };

    it('should accept "y" as confirmation', async () => {
      await testConfirmation('y', true);
    });

    it('should accept "yes" as confirmation', async () => {
      await testConfirmation('yes', true);
    });

    it('should accept "Y" as confirmation (case-insensitive)', async () => {
      await testConfirmation('Y', true);
    });

    it('should reject "n" as cancellation', async () => {
      await testConfirmation('n', false);
    });

    it('should reject empty input as cancellation', async () => {
      await testConfirmation('', false);
    });

    it('should reject any other input as cancellation', async () => {
      await testConfirmation('maybe', false);
    });
  });

  describe('Error Handling', () => {
    it('should handle OAuth flow cancellation', async () => {
      mockAuth.getAccessToken
        .mockRejectedValueOnce(new Error('No session'))
        .mockRejectedValueOnce(new Error('User cancelled OAuth flow'));
      
      await expect(
        executeAuthCommand(mockAuth, mockColabClient, mockReadline, {})
      ).rejects.toThrow('User cancelled OAuth flow');
    });

    it('should handle network errors during authentication', async () => {
      mockAuth.getAccessToken
        .mockRejectedValueOnce(new Error('No session'))
        .mockRejectedValueOnce(new Error('Network error'));
      
      await expect(
        executeAuthCommand(mockAuth, mockColabClient, mockReadline, {})
      ).rejects.toThrow('Network error');
    });

    it('should handle invalid credentials gracefully', async () => {
      mockAuth.getAccessToken
        .mockRejectedValueOnce(new Error('No session'))
        .mockRejectedValueOnce(new Error('Invalid credentials'));
      
      await expect(
        executeAuthCommand(mockAuth, mockColabClient, mockReadline, {})
      ).rejects.toThrow('Invalid credentials');
    });

    it('should handle storage errors when saving session', async () => {
      mockAuth.getAccessToken
        .mockRejectedValueOnce(new Error('No session'))
        .mockRejectedValueOnce(new Error('Failed to write session file'));
      
      await expect(
        executeAuthCommand(mockAuth, mockColabClient, mockReadline, {})
      ).rejects.toThrow('Failed to write session file');
    });
  });
});
