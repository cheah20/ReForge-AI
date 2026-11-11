/**
 * tests/unit/precomputed-cache.test.ts
 *
 * Task 37.1 / 42.1 outputs: the committed fixture cache covers both acceptance
 * fixtures in every core language, every file passes the schema and covers
 * every field, and the Worker's lookup finds them.
 * Validates: Requirement 12.7
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { extractFields } from '../../src/lib/pdf-extract/index.js';
import { bundledStore, lookupFixtureCache } from '../../src/worker/cache/fixture-cache.js';
import { getCoreLanguages } from '../../src/packs/language/registry.js';
import { isCompatible } from '../../src/lib/analysis/reconcile.js';
import type { FieldEvidence } from '../../src/shared/types.js';

/** The acceptance fixtures, plus the blank "Try a sample form" copy (task 28.5). */
const FIXTURES = ['clinic-registration', 'us-community-clinic', 'clinic-registration-sample'] as const;
const evidence = new Map<string, { hash: string; fields: FieldEvidence[] }>();

beforeAll(async () => {
  for (const name of FIXTURES) {
    const r = await extractFields(new Uint8Array(readFileSync(`fixtures/${name}.pdf`)));
    if (!r.ok) throw new Error(name);
    evidence.set(name, { hash: r.fileHash, fields: r.fields });
  }
});

describe('precomputed fixture cache', () => {
  it('holds exactly one file per acceptance fixture and core language', () => {
    const expected = FIXTURES.flatMap((f) => getCoreLanguages().map((l) => `${evidence.get(f)!.hash}-${l.tag}`)).sort();
    expect(Object.keys(bundledStore()).sort()).toEqual(expected);
  });

  it.each(FIXTURES.flatMap((f) => getCoreLanguages().map((l) => [f, l.tag] as const)))(
    '%s / %s: served by the Worker lookup, every field answered with a compatible type',
    (fixture, tag) => {
      const { hash, fields } = evidence.get(fixture)!;
      const cached = lookupFixtureCache(hash, tag);
      expect(cached?.servedFromCache).toBe(true);
      const byId = new Map(cached!.fields.map((f) => [f.fieldId, f]));
      expect([...byId.keys()].sort()).toEqual(fields.map((f) => f.fieldId).sort());
      for (const f of fields) expect(isCompatible(f.fieldType, byId.get(f.fieldId)!.answerType), f.fieldId).toBe(true);
    },
  );

  it('the stale-file guard: a cache entry for a different PDF is never served', () => {
    expect(lookupFixtureCache('0'.repeat(64), 'ms')).toBeNull();
  });
});
