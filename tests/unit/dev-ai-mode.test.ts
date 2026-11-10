/**
 * tests/unit/dev-ai-mode.test.ts
 *
 * Offline development must not need a Cloudflare login: remote bindings open
 * only when AI_MODE=real is set in the environment or in .dev.vars.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { devAiMode, readVar } from '../../scripts/dev-ai-mode.js';

const files = (content?: string) => () => content;

describe('devAiMode', () => {
  it('is mock by default: no environment variable and no .dev.vars', () => {
    expect(devAiMode('/p', {}, files(undefined))).toBe('mock');
  });

  it('is real with AI_MODE=real in the environment', () => {
    expect(devAiMode('/p', { AI_MODE: 'real' }, files(undefined))).toBe('real');
  });

  it('is real with AI_MODE=real in .dev.vars', () => {
    expect(devAiMode('/p', {}, files('# local\nAI_MODE="real"\n'))).toBe('real');
  });

  it('an explicit environment value wins over .dev.vars', () => {
    expect(devAiMode('/p', { AI_MODE: 'mock' }, files('AI_MODE=real'))).toBe('mock');
  });

  it('anything but exactly "real" is mock', () => {
    for (const v of ['REAL', 'true', '1', '', ' real']) expect(devAiMode('/p', { AI_MODE: v }, files(undefined)), v).toBe('mock');
  });

  it('parses dotenv text: comments, quotes, spaces, the last assignment wins', () => {
    expect(readVar('A=1\n# AI_MODE=real\n', 'AI_MODE')).toBeUndefined();
    expect(readVar("AI_MODE = 'real'", 'AI_MODE')).toBe('real');
    expect(readVar('AI_MODE=mock\nAI_MODE=real\r\n', 'AI_MODE')).toBe('real');
    expect(readVar('XAI_MODE=real', 'AI_MODE')).toBeUndefined();
  });
});

describe('project configuration', () => {
  it('vite.config.ts enables remote bindings only through devAiMode', () => {
    const config = readFileSync('vite.config.ts', 'utf8');
    expect(config).toMatch(/cloudflare\(\{\s*remoteBindings:\s*devAiMode\(/);
  });

  it('.dev.vars is ignored by git (it can hold local secrets)', () => {
    expect(readFileSync('.gitignore', 'utf8')).toMatch(/^\.dev\.vars\*?$/m);
  });
});
