/**
 * tests/unit/fixture-cache-generator.test.ts
 *
 * Task 17.2: the generator only writes real-AI, schema-valid, complete replies,
 * under <sha256>-<tag>.json, and the Worker can read what it writes.
 * The Worker runs in-process with a stand-in "real" provider; no network.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { createHandler } from '../../src/worker/index.js';
import { MockAiProvider } from '../../src/lib/ai/mock.js';
import type { AiProvider } from '../../src/lib/ai/interface.js';
import { generateFixtureCache } from '../../scripts/generate-fixture-cache.js';
import { lookupFixtureCache } from '../../src/worker/cache/fixture-cache.js';
import { extractFields } from '../../src/lib/pdf-extract/index.js';
import { getCoreLanguages } from '../../src/packs/language/registry.js';

/** A Worker that reports itself as real AI while answering with the deterministic mock tables. */
function fakeRealProvider(): AiProvider {
  const mock = new MockAiProvider();
  return { kind: 'real', analyze: (c) => mock.analyze(c), retranslate: (c) => mock.retranslate(c), translate: (c) => mock.translate(c) };
}

function workerFetch(provider: AiProvider): typeof fetch {
  const handler = createHandler({ provider, logger: () => {}, cache: {} });
  return ((input: RequestInfo | URL, init?: RequestInit) => handler.fetch(new Request(String(input), init), {})) as typeof fetch;
}

const run = (fetchFn: typeof fetch, extra: Partial<Parameters<typeof generateFixtureCache>[0]> = {}) => {
  const files = new Map<string, string>();
  return generateFixtureCache({
    baseUrl: 'http://worker.test',
    fixtures: ['clinic-registration'],
    languages: ['ms', 'zh-Hans'],
    fetchFn,
    writeFile: (f, t) => files.set(f.replace(/\\/g, '/'), t),
    log: () => {},
    ...extra,
  }).then((result) => ({ result, files }));
};

describe('generateFixtureCache', () => {
  it('writes one <sha256>-<tag>.json per language, and the Worker can read them back', async () => {
    const { result, files } = await run(workerFetch(fakeRealProvider()));
    expect(result.failed).toEqual([]);
    expect(result.written).toHaveLength(2);

    const extracted = await extractFields(new Uint8Array(readFileSync('fixtures/clinic-registration.pdf')));
    if (!extracted.ok) throw new Error('fixture');
    const names = [...files.keys()].map((f) => f.split('/').pop());
    expect(names.sort()).toEqual([`${extracted.fileHash}-ms.json`, `${extracted.fileHash}-zh-Hans.json`]);

    const store = Object.fromEntries([...files].map(([f, text]) => [f.split('/').pop()!.replace(/\.json$/, ''), JSON.parse(text)]));
    const cached = lookupFixtureCache(extracted.fileHash, 'zh-Hans', store);
    expect(cached?.servedFromCache).toBe(true);
    expect(cached?.fields).toHaveLength(22);
    // The stored file does not carry the cache marker itself.
    expect(JSON.parse([...files.values()][0]!)).not.toHaveProperty('servedFromCache');
  });

  it('refuses mock answers and writes nothing', async () => {
    const { result, files } = await run(workerFetch(new MockAiProvider()));
    expect(files.size).toBe(0);
    expect(result.written).toEqual([]);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]!.reason).toContain('mock provider');
  });

  it('refuses replies that fail the schema, omit a field, or come from a cache', async () => {
    const real = (body: unknown, status = 200): typeof fetch =>
      (async () => new Response(JSON.stringify(body), { status, headers: { 'x-reforge-ai-mode': 'real', 'content-type': 'application/json' } })) as typeof fetch;
    const valid = {
      fields: [{ fieldId: 'patient.fullName', humanLabel: 'Name', question: 'Name?', answerType: 'text', confidence: 0.9 }],
      formLanguage: 'ms',
      formLanguageConfidence: 0.9,
      formCountry: 'MY',
      formCountryConfidence: 0.9,
    };
    expect((await run(real({ nope: 1 }))).result.failed[0]!.reason).toContain('AnalyzeResponseSchema');
    expect((await run(real(valid))).result.failed[0]!.reason).toContain('omits 21 field(s)');
    expect((await run(real({ ...valid, servedFromCache: true }))).result.failed[0]!.reason).toContain('cache');
    expect((await run(real({ error: { code: 'AI_UNAVAILABLE', message: 'x' } }, 503))).result.failed[0]!.reason).toBe('HTTP 503');
    for (const r of [await run(real(valid))]) expect(r.files.size).toBe(0);
  });

  it('reports a network failure per language instead of crashing', async () => {
    const down = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as typeof fetch;
    const { result } = await run(down);
    expect(result.failed.map((f) => f.reason)).toEqual(['connect ECONNREFUSED', 'connect ECONNREFUSED']);
  });

  it('defaults to every core language', async () => {
    const { result } = await run(workerFetch(fakeRealProvider()), { languages: undefined as never });
    expect(result.written).toHaveLength(getCoreLanguages().length);
  });

  // Found on the first real run: under plain tsx the script crashed on import.meta.glob.
  it('runs as a plain Node script (outside Vite) and prints its usage', () => {
    const r = spawnSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/generate-fixture-cache.ts'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.stderr).not.toContain('is not a function');
    expect(r.stderr).toContain('Usage: npm run generate-fixture-cache');
    expect(r.status).toBe(2);
  }, 70_000);

  it('throws for a fixture that the extractor rejects', async () => {
    await expect(run(workerFetch(fakeRealProvider()), { fixtures: ['no-fields'] })).rejects.toThrow('rejected: NO_FIELDS');
  });
});
