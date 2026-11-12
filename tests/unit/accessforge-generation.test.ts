// @vitest-environment jsdom
/**
 * tests/unit/accessforge-generation.test.ts
 *
 * accessforge-skeleton task 7.3 (design "Revival_Generation").
 * Validates: Requirements 3.9, 3.10
 */

import { describe, it, expect } from 'vitest';
import { INITIAL_FRAME, isCurrent, nextGeneration, stampOf } from '../../src/lib/accessforge/generation.js';
import { TEMPLATES } from '../../src/worker/legacy/generated/templates.js';
import { fill } from '../../src/worker/legacy/render.js';

const registerDoc = () => new DOMParser().parseFromString(fill(TEMPLATES.register, {}), 'text/html');
const pageVersion = (doc: Document) => doc.querySelector('meta[name="portal-page-version"]')?.getAttribute('content');

describe('Revival_Generation', () => {
  it('increases the counter by one on every call, for loads starting and loaded', () => {
    const doc = registerDoc();
    const seen: number[] = [];
    let h = INITIAL_FRAME;
    for (const next of [null, doc, null, doc, doc]) {
      h = nextGeneration(h, next);
      seen.push(h.generation);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(h.document).toBe(doc);
  });

  it('keeps a stamp current while nothing has changed', () => {
    const doc = registerDoc();
    const h = nextGeneration(INITIAL_FRAME, doc);
    expect(isCurrent(h, stampOf(h), doc)).toBe(true);
  });

  it('treats a replaced document as not current even at the same Page_Version', () => {
    const first = registerDoc();
    const second = registerDoc();
    expect(pageVersion(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(pageVersion(second)).toBe(pageVersion(first));

    const h1 = nextGeneration(INITIAL_FRAME, first);
    const stamp = stampOf(h1);
    const h2 = nextGeneration(h1, second);
    expect(isCurrent(h2, stamp, second)).toBe(false);
  });

  it('treats the stamp as not current when the iframe already shows another document at the same generation', () => {
    // A navigation between the old document's unload and the next load event.
    const first = registerDoc();
    const second = registerDoc();
    const h = nextGeneration(INITIAL_FRAME, first);
    expect(isCurrent(h, stampOf(h), second)).toBe(false);
    expect(isCurrent(h, stampOf(h), null)).toBe(false);
  });

  it('treats a stamp from a document that is still loading as not current', () => {
    const doc = registerDoc();
    const loading = nextGeneration(INITIAL_FRAME, null);
    expect(isCurrent(loading, stampOf(loading), doc)).toBe(false);
  });

  it('treats an older generation as not current even on the same document', () => {
    const doc = registerDoc();
    const h1 = nextGeneration(INITIAL_FRAME, doc);
    const stamp = stampOf(h1);
    const h2 = nextGeneration(h1, doc);
    expect(isCurrent(h2, stamp, doc)).toBe(false);
    expect(isCurrent(h2, stampOf(h2), doc)).toBe(true);
  });
});
