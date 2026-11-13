/**
 * tests/unit/fillable-golden.test.ts
 *
 * Fillable_Path golden request bodies (formbridge-any-document task 2.1). The
 * golden files in tests/golden/fillable-analyze/ were captured from the code
 * as it was before the first code change of that spec. For every bundled
 * fixture that the extractor reads as fillable, the analyze request body that
 * the browser puts on the wire must stay byte-identical, and every
 * precomputed fixture cache entry must still be found for its fixture and
 * pass the schema.
 * Validates: Requirement 5.3 (formbridge-any-document)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { extractFields } from '../../src/lib/pdf-extract/index.js';
import { analyzeForm, createSession, createSessionStore } from '../../src/frontend/state.js';
import { createApiClient } from '../../src/frontend/api.js';
import { AnalyzeRequestSchema, AnalyzeResponseSchema } from '../../src/shared/schemas.js';
import { lookupFixtureCache } from '../../src/worker/cache/fixture-cache.js';

const FIXTURE_DIR = 'fixtures';
const GOLDEN_DIR = path.join('tests', 'golden', 'fillable-analyze');
const PRECOMPUTED_DIR = path.join('src', 'worker', 'cache', 'precomputed');

/** A valid empty analyze reply, so analyzeForm completes after the first batch. */
const EMPTY_REPLY = {
  fields: [],
  formLanguage: 'en',
  formLanguageConfidence: 0.9,
  formCountry: 'MY',
  formCountryConfidence: 0.9,
};

interface Captured {
  path: string;
  body: string;
}

/**
 * The exact request bodies the current Fillable_Path sends for one fixture:
 * extraction as in Upload.tsx, then analyzeForm with the real API client, with
 * fetch replaced by a recorder. Null when the extractor rejects the fixture.
 */
async function capturedAnalyzeBodies(fixtureFile: string): Promise<Captured[] | null> {
  const bytes = new Uint8Array(readFileSync(path.join(FIXTURE_DIR, fixtureFile)));
  const extracted = await extractFields(bytes);
  if (!extracted.ok) return null;
  const captured: Captured[] = [];
  const api = createApiClient(async (requestPath, init) => {
    captured.push({ path: requestPath, body: String(init.body) });
    return new Response(JSON.stringify(EMPTY_REPLY), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const store = createSessionStore(createSession('en'));
  const outcome = await analyzeForm(extracted.fields, extracted.fileHash, store, { api, newId: () => 'golden' });
  expect(outcome).toEqual({ status: 'done', fromCache: false });
  return captured;
}

const pdfFixtures = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.pdf')).sort();
const goldenFiles = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json')).sort();
const bodies = new Map<string, Captured[]>();

beforeAll(async () => {
  for (const file of pdfFixtures) {
    const captured = await capturedAnalyzeBodies(file);
    if (captured) bodies.set(file.replace(/\.pdf$/, ''), captured);
  }
});

describe('Fillable_Path golden analyze request bodies (5.3)', () => {
  it('there is one golden file for every fixture the extractor reads as fillable, and no other', () => {
    expect(goldenFiles.map((f) => f.replace(/\.json$/, '')).sort()).toEqual([...bodies.keys()].sort());
    expect(goldenFiles.length).toBeGreaterThan(0);
  });

  it.each(goldenFiles.map((f) => f.replace(/\.json$/, '')))('%s: the body on the wire is byte-identical to its golden file', (name) => {
    const captured = bodies.get(name);
    expect(captured, `${name} is no longer read as fillable`).toBeDefined();
    // Every bundled fillable fixture fits in one batch of 30 fields.
    expect(captured!.map((c) => c.path)).toEqual(['/api/forms/analyze']);
    const golden = readFileSync(path.join(GOLDEN_DIR, `${name}.json`), 'utf8');
    expect(captured![0]!.body).toBe(golden);
    expect(AnalyzeRequestSchema.safeParse(JSON.parse(golden)).success).toBe(true);
  });
});

describe('precomputed fixture cache entries still match their fixtures (5.3)', () => {
  const entries = readdirSync(PRECOMPUTED_DIR).filter((f) => f.endsWith('.json')).sort();

  it('the cache directory is not empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s: found for its fixture, valid, and covers exactly the fields of that fixture', (file) => {
    const m = /^([0-9a-f]{64})-(.+)\.json$/.exec(file);
    expect(m, file).not.toBeNull();
    const [, hash, tag] = m!;
    const golden = goldenFiles
      .map((g) => JSON.parse(readFileSync(path.join(GOLDEN_DIR, g), 'utf8')) as { contentHash: string; fields: Array<{ fieldId: string }> })
      .find((body) => body.contentHash === hash);
    expect(golden, `no golden body carries the hash of ${file}`).toBeDefined();

    const raw: unknown = JSON.parse(readFileSync(path.join(PRECOMPUTED_DIR, file), 'utf8'));
    expect(AnalyzeResponseSchema.safeParse(raw).success).toBe(true);
    const served = lookupFixtureCache(hash!, tag!);
    expect(served?.servedFromCache).toBe(true);
    expect(served!.fields.map((f) => f.fieldId).sort()).toEqual(golden!.fields.map((f) => f.fieldId).sort());
  });
});
