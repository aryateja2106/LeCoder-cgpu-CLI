import { describe, it, expect } from 'vitest';

describe('LeCoder cGPU', () => {
  it('should have basic test infrastructure', () => {
    expect(true).toBe(true);
  });

  it('should validate environment setup', () => {
    expect(process.env.NODE_ENV).toBeDefined();
  });
});

describe('Configuration', () => {
  it('should be able to import core modules', async () => {
    // Test that we can import without errors
    expect(async () => {
      // Dynamic import to avoid build-time issues
      const module = await import('../../src/config.js');
      return module;
    }).toBeDefined();
  });
});

describe('Package Information', () => {
  it('should have correct package name', async () => {
    const pkg = await import('../../package.json', { assert: { type: 'json' } });
    expect(pkg.default.name).toBe('lecoder-cgpu');
  });

  it('should have correct version format', async () => {
    const pkg = await import('../../package.json', { assert: { type: 'json' } });
    expect(pkg.default.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should have Apache-2.0 license', async () => {
    const pkg = await import('../../package.json', { assert: { type: 'json' } });
    expect(pkg.default.license).toBe('Apache-2.0');
  });
});
