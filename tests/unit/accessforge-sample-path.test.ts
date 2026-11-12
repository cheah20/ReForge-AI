/**
 * tests/unit/accessforge-sample-path.test.ts
 *
 * accessforge-skeleton task 1.6: the FormBridge sample-form route that the
 * AccessForge confirmation screens link to exists (formbridge-pdf task 28.5).
 * Validates: Requirements 11.5, 11.6
 */

import { describe, it, expect } from 'vitest';
import { SAMPLE_FORM_PATH } from '../../src/shared/app-paths.js';

describe('SAMPLE_FORM_PATH for the AccessForge links', () => {
  it('is exported from src/shared/app-paths.ts as a same-origin path', () => {
    expect(typeof SAMPLE_FORM_PATH).toBe('string');
    expect(SAMPLE_FORM_PATH.startsWith('/')).toBe(true);
    expect(SAMPLE_FORM_PATH.startsWith('//')).toBe(false);
    const url = new URL(SAMPLE_FORM_PATH, 'https://reforge.example');
    expect(url.origin).toBe('https://reforge.example');
    expect(url.pathname).toBe(SAMPLE_FORM_PATH);
  });

  it('has no query string or fragment, so no answer can ride along in the link (decision D)', () => {
    expect(SAMPLE_FORM_PATH).not.toMatch(/[?#]/);
  });

  it('is not under /legacy/ or /api/', () => {
    expect(SAMPLE_FORM_PATH === '/legacy' || SAMPLE_FORM_PATH.startsWith('/legacy/')).toBe(false);
    expect(SAMPLE_FORM_PATH.startsWith('/api/')).toBe(false);
  });
});
