/**
 * tests/unit/accessforge-page-cache-generator.test.ts
 *
 * accessforge-skeleton task 20.1: the `--pages` step of the fixture cache
 * script, with a fake Worker. Valid replies write plan files that the page-plan
 * cache accepts; an invalid reply writes nothing for its key and fails.
 * Validates: Requirement 7.6
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { generatePagePlans, PAGE_CACHE_DIR } from '../../scripts/generate-fixture-cache.js';
import { lookupPagePlanCache, bundledPagePlanStore } from '../../src/worker/cache/page-plan-cache.js';
import { PAGE_VERSIONS } from '../../src/worker/legacy/generated/templates.js';

const FIELD_IDS = ['f0:text:nama', 'f0:text:nokp', 'f0:text:tlahir', 'f0:radio:jantina', 'f0:text:tel', 'f0:text:poskod', 'f0:select:tujuan', 'f0:checkbox:akuan'];
const TYPES = ['text', 'ic', 'date', 'radio', 'phone', 'postcode', 'dropdown', 'checkbox'];
const entries = (ids = FIELD_IDS) => ids.map((elementId) => ({ elementId, humanLabel: 'Label', question: 'Question?', answerType: TYPES[FIELD_IDS.indexOf(elementId)], confidence: 0.9 }));

function fakeWorker(reply: (language: string) => { mode?: string; body: unknown; status?: number }) {
  const bodies: Array<{ pageModel: { pageVersion: string }; interfaceLanguage: string }> = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    const r = reply(body.interfaceLanguage);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'x-reforge-ai-mode': r.mode ?? 'real' } });
  }) as unknown as typeof fetch;
  return { fetchFn, bodies };
}

function run(reply: Parameters<typeof fakeWorker>[0], languages?: string[]) {
  const files = new Map<string, string>();
  const { fetchFn, bodies } = fakeWorker(reply);
  const logs: string[] = [];
  const done = generatePagePlans({ baseUrl: 'http://worker.test', fetchFn, writeFile: (f, t) => files.set(f, t), log: (l) => logs.push(l), ...(languages ? { languages } : {}) });
  return { done, files, bodies, logs };
}

describe('generatePagePlans', () => {
  it('writes one file per language for valid live replies, and the page-plan cache accepts them', async () => {
    const { done, files, bodies } = run(() => ({ body: { analysisMode: 'live', entries: entries() } }));
    const result = await done;
    expect(result.failed).toEqual([]);
    expect(bodies.map((b) => b.interfaceLanguage)).toEqual(['en', 'zh-Hans']);
    expect(bodies[0]!.pageModel.pageVersion).toBe(PAGE_VERSIONS.register);
    expect([...files.keys()].map((f) => path.basename(f))).toEqual([`${PAGE_VERSIONS.register}-en.json`, `${PAGE_VERSIONS.register}-zh-Hans.json`]);
    expect([...files.keys()].every((f) => path.dirname(f) === PAGE_CACHE_DIR)).toBe(true);
    const store = bundledPagePlanStore(Object.fromEntries([...files].map(([f, t]) => [`./precomputed/pages/${path.basename(f)}`, JSON.parse(t)])));
    expect(lookupPagePlanCache(PAGE_VERSIONS.register, 'zh-Hans', store)?.entries).toHaveLength(8);
  });

  it('writes nothing for an invalid reply, writes the valid language, and reports the failure', async () => {
    const { done, files } = run((lang) => (lang === 'en' ? { body: { analysisMode: 'live', entries: 'nope' } } : { body: { analysisMode: 'live', entries: entries() } }));
    const result = await done;
    expect(result.failed).toEqual([{ language: 'en', reason: 'reply does not match PageAnalyzeResponseSchema' }]);
    expect([...files.keys()].map((f) => path.basename(f))).toEqual([`${PAGE_VERSIONS.register}-zh-Hans.json`]);
  });

  it.each([
    ['a mock Worker', { mode: 'mock', body: { analysisMode: 'mock', entries: entries() } }, 'the Worker answered with the mock provider'],
    ['a cached reply', { body: { analysisMode: 'cached', entries: entries() } }, 'analysis mode was cached, not live'],
    ['a plan that maps too few fields', { body: { analysisMode: 'live', entries: entries(FIELD_IDS.slice(0, 5)) } }, 'plan leaves 3 field(s) unmapped'],
    ['an HTTP error', { status: 503, body: { error: { code: 'AI_UNAVAILABLE', message: 'x' } } }, 'HTTP 503'],
  ])('writes nothing and fails for %s', async (_label, reply, reason) => {
    const { done, files } = run(() => reply, ['en']);
    const result = await done;
    expect(files.size).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.reason).toContain(reason);
  });

  it('stores only the five plan properties, validated and in page order whatever the reply order', async () => {
    const { done, files } = run(() => ({ body: { analysisMode: 'live', entries: [...entries()].reverse() } }), ['en']);
    await done;
    const stored = JSON.parse([...files.values()][0]!);
    expect(Object.keys(stored).sort()).toEqual(['entries', 'interfaceLanguage', 'pageVersion']);
    expect(stored.entries.map((e: { elementId: string }) => e.elementId)).toEqual(FIELD_IDS);
    expect(Object.keys(stored.entries[0]).sort()).toEqual(['answerType', 'confidence', 'elementId', 'humanLabel', 'question']);
  });
});
