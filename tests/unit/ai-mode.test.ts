/**
 * tests/unit/ai-mode.test.ts
 *
 * Review item 14 / decision 11: mock AI unless real AI is explicitly enabled,
 * and the Wrangler config keeps that default.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolveAiMode } from '../../src/worker/ai-mode.js';

const binding = { run: async () => ({}) };

describe('resolveAiMode', () => {
  it('uses the mock when AI_MODE is not set, even with a binding', () => {
    expect(resolveAiMode({ AI: binding })).toBe('mock');
  });

  it('uses the mock when AI_MODE is real but there is no binding', () => {
    expect(resolveAiMode({ AI_MODE: 'real' })).toBe('mock');
  });

  it('uses real AI only with AI_MODE=real and a binding', () => {
    expect(resolveAiMode({ AI: binding, AI_MODE: 'real' })).toBe('real');
  });

  it('treats any other AI_MODE value as mock', () => {
    expect(resolveAiMode({ AI: binding, AI_MODE: 'REAL' })).toBe('mock');
    expect(resolveAiMode({ AI: binding, AI_MODE: 'true' })).toBe('mock');
  });
});

describe('wrangler.jsonc', () => {
  // Strip // comments, then parse as JSON.
  const config = JSON.parse(
    readFileSync('wrangler.jsonc', 'utf8')
      .split('\n')
      .map((line) => line.replace(/^\s*\/\/.*$/, ''))
      .join('\n'),
  );

  it('connects the AI binding remotely (there is no local AI simulation)', () => {
    expect(config.ai).toEqual({ binding: 'AI', remote: true });
  });

  it('defaults AI_MODE to mock', () => {
    expect(config.vars.AI_MODE).toBe('mock');
  });

  it('routes /api/* to the Worker before the SPA fallback', () => {
    expect(config.assets.run_worker_first).toContain('/api/*');
    expect(config.assets.not_found_handling).toBe('single-page-application');
  });
});
