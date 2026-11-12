/**
 * tests/unit/accessforge-page-versions.test.ts
 *
 * accessforge-skeleton task 5.9: the served GET pages carry the Page_Version
 * that the build recorded, the supported list agrees, and no precomputed page
 * plan is keyed by an unsupported version.
 * Validates: Requirement 3.4
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { computePageVersion } from '../../src/lib/legacy-build/page-version.js';
import { SUPPORTED_PAGE_VERSIONS } from '../../src/lib/accessforge/supported-versions.js';
import { PAGE_VERSIONS } from '../../src/worker/legacy/generated/templates.js';
import { body, get, post, VALID } from './legacy-helpers.js';

const metaVersion = (html: string) => html.match(/<meta name="portal-page-version" content="([^"]*)">/)?.[1];

describe('Page_Version', () => {
  it.each([
    ['home', '/legacy/'],
    ['register', '/legacy/register'],
  ] as const)('%s: recomputed hash of the served HTML = served meta = PAGE_VERSIONS = SUPPORTED_PAGE_VERSIONS', async (name, path) => {
    const served = await (await get(path)).text();
    const recomputed = await computePageVersion(served);
    expect(recomputed).toMatch(/^[0-9a-f]{64}$/);
    expect(metaVersion(served)).toBe(recomputed);
    expect(PAGE_VERSIONS[name]).toBe(recomputed);
    expect(SUPPORTED_PAGE_VERSIONS[name]).toBe(recomputed);
  });

  it('the design table records the same two hashes', () => {
    const design = readFileSync('.kiro/specs/accessforge-skeleton/design.md', 'utf8');
    expect(design).toContain(SUPPORTED_PAGE_VERSIONS.home);
    expect(design).toContain(SUPPORTED_PAGE_VERSIONS.register);
  });

  it('confirmation, error and not-found documents carry no version meta', async () => {
    for (const res of [await post(body(VALID)), await post(body([['nama', 'x']])), await get('/legacy/nope')]) {
      expect(metaVersion(await res.text())).toBeUndefined();
    }
  });

  it('a changed byte changes the hash (the version identifies the template)', async () => {
    const served = await (await get('/legacy/register')).text();
    expect(await computePageVersion(served.replace('Hantar', 'Hantar.'))).not.toBe(SUPPORTED_PAGE_VERSIONS.register);
  });

  it('no precomputed page plan is keyed by an unsupported version (an absent folder passes)', () => {
    const dir = 'src/worker/cache/precomputed/pages';
    if (!existsSync(dir)) return;
    const supported = new Set<string>(Object.values(SUPPORTED_PAGE_VERSIONS));
    for (const file of readdirSync(dir)) {
      const version = file.match(/^([0-9a-f]{64})-/)?.[1];
      expect(version && supported.has(version), file).toBe(true);
    }
  });
});
