/**
 * tests/unit/accessforge-run-page.test.ts
 *
 * accessforge-skeleton tasks 13.5 and 13.6: the retry rule of runPageAnalyze
 * and the exact-key page-plan cache.
 * Validates: Requirements 6.10, 7.2
 */

import { describe, it, expect } from 'vitest';
import { runPageAnalyze } from '../../src/lib/analysis/run-page.js';
import { AiError, type AiProvider, type AiReply } from '../../src/lib/ai/interface.js';
import { bundledPagePlanStore, lookupPagePlanCache, pagePlanKey } from '../../src/worker/cache/page-plan-cache.js';
import type { PageAnalyzeRequest } from '../../src/shared/page-schemas.js';

const V = 'a'.repeat(64);
const REQUEST = {
  interfaceLanguage: 'en',
  pageModel: { path: '/legacy/register', pageVersion: V, entries: [] },
} as unknown as PageAnalyzeRequest;
const usage = { model: 'm', durationMs: 1 };

/** A provider whose analyzePage answers from a script, one item per call. */
function scripted(script: Array<unknown | AiError>): AiProvider & { calls: number } {
  const p = {
    kind: 'real' as const,
    calls: 0,
    async analyzePage(): Promise<AiReply> {
      const next = script[p.calls++];
      if (next instanceof AiError) throw next;
      return { value: next, usage };
    },
    analyze: () => Promise.reject(new Error('unused')),
    retranslate: () => Promise.reject(new Error('unused')),
    translate: () => Promise.reject(new Error('unused')),
    analyzeLabels: () => Promise.reject(new Error('unused')),
  };
  return p;
}

const VALID = { entries: [{ elementId: 'f0:text:nama' }] };

describe('runPageAnalyze', () => {
  it('returns the first valid reply after one call', async () => {
    const p = scripted([VALID]);
    expect(await runPageAnalyze(p, REQUEST, 'English')).toMatchObject({ ok: true, entries: VALID.entries, meta: { attempts: 1 } });
    expect(p.calls).toBe(1);
  });

  it.each([
    ['an invalid reply', { entries: 'x' }],
    ['an invalid-output error', new AiError('AI_INVALID_OUTPUT', 'x')],
    ['a timeout', new AiError('AI_TIMEOUT', 'x')],
  ])('retries once after %s', async (_label, first) => {
    const p = scripted([first, VALID]);
    expect(await runPageAnalyze(p, REQUEST, 'English')).toMatchObject({ ok: true, meta: { attempts: 2 } });
    expect(p.calls).toBe(2);
  });

  it('classifies by the last attempt: invalid then timeout is a timeout', async () => {
    const p = scripted([{ nope: 1 }, new AiError('AI_TIMEOUT', 'x')]);
    expect(await runPageAnalyze(p, REQUEST, 'English')).toMatchObject({ ok: false, reason: 'timeout', meta: { attempts: 2 } });
  });

  it.each([
    ['AI_QUOTA', 'quota'],
    ['AI_RATE_LIMITED', 'rate_limited'],
    ['AI_UNAVAILABLE', 'unavailable'],
  ] as const)('does not retry after %s', async (code, reason) => {
    const p = scripted([new AiError(code, 'x'), VALID]);
    expect(await runPageAnalyze(p, REQUEST, 'English')).toMatchObject({ ok: false, reason, meta: { attempts: 1 } });
    expect(p.calls).toBe(1);
  });

  it('rethrows an error that is not an AiError', async () => {
    const p = scripted([]);
    p.analyzePage = () => Promise.reject(new TypeError('bug'));
    await expect(runPageAnalyze(p, REQUEST, 'English')).rejects.toThrow(TypeError);
  });
});

describe('lookupPagePlanCache', () => {
  const plan = (pageVersion: string, interfaceLanguage: string) => ({
    pageVersion,
    interfaceLanguage,
    entries: [{ elementId: 'f0:text:nama', humanLabel: 'Full name', question: 'Your name?', answerType: 'text', confidence: 0.9 }],
  });
  const store = { [pagePlanKey(V, 'en')]: plan(V, 'en'), [pagePlanKey(V, 'zh-Hant')]: plan('b'.repeat(64), 'zh-Hant') };

  it('finds the plan for the exact version and language', () => {
    expect(lookupPagePlanCache(V, 'en', store)?.entries[0]?.humanLabel).toBe('Full name');
  });

  it('uses no plan for another version or language, and no fallback', () => {
    expect(lookupPagePlanCache('b'.repeat(64), 'en', store)).toBeNull();
    expect(lookupPagePlanCache(V, 'zh-Hans', store)).toBeNull();
    expect(lookupPagePlanCache(V, 'EN', store)).toBeNull();
  });

  it('refuses a file whose contents name another version than its key', () => {
    expect(lookupPagePlanCache(V, 'zh-Hant', store)).toBeNull();
  });

  it('refuses a file that fails the schema and a malformed version', () => {
    expect(lookupPagePlanCache(V, 'en', { [pagePlanKey(V, 'en')]: { ...plan(V, 'en'), extra: 1 } })).toBeNull();
    expect(lookupPagePlanCache('xyz', 'en', store)).toBeNull();
  });

  it('keys bundled files by file name and ships no plan yet', () => {
    expect(bundledPagePlanStore({ './precomputed/pages/abc-en.json': 1 })).toEqual({ 'abc-en': 1 });
    expect(bundledPagePlanStore()).toEqual({});
  });
});
