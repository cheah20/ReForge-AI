/**
 * tests/unit/hook-scripts.test.ts
 *
 * Review item 16: the test-on-save hook finds only related tests (no `tail`,
 * no full-suite run), and the locale-sync hook reports gaps without writing
 * English placeholders into locale files.
 */

import { describe, it, expect } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { relatedTests, savedFiles } = require('../../scripts/hooks/test-on-save.cjs') as {
  relatedTests: (file: string, root: string) => string[];
  savedFiles: (event: unknown) => string[];
};
const { coreTags, localeGaps } = require('../../scripts/hooks/locale-sync.cjs') as {
  coreTags: (root: string) => string[];
  localeGaps: (root: string) => Record<string, string[]>;
};

const ROOT = path.resolve(__dirname, '../..');
const names = (files: string[]) => files.map((f) => path.basename(f)).sort();

describe('test-on-save: related tests', () => {
  it('maps a source file to the tests that import it', () => {
    const tests = names(relatedTests('src/lib/pdf-extract/rejection.ts', ROOT));
    expect(tests).toContain('rejection.test.ts');
    expect(tests).not.toContain('schemas.test.ts');
  });

  it('accepts Windows backslash paths', () => {
    expect(names(relatedTests('src\\lib\\pdf-extract\\page-text.ts', ROOT))).toContain('page-text.test.ts');
  });

  it('finds tests that import through an @alias', () => {
    expect(names(relatedTests('src/lib/batch.ts', ROOT))).toContain('aliases.test.ts');
  });

  it('runs a saved test file itself', () => {
    expect(names(relatedTests('tests/unit/schemas.test.ts', ROOT))).toEqual(['schemas.test.ts']);
  });

  it('returns nothing for files outside the repository', () => {
    expect(relatedTests(path.join(tmpdir(), 'x.ts'), ROOT)).toEqual([]);
  });

  it('reads saved file paths from a hook payload', () => {
    expect(savedFiles({ event: { file: 'src/a.ts', other: 'README.md' } })).toEqual(['src/a.ts']);
  });

  // Review 2, item 7
  it('maps a .cjs script to the tests that require() it', () => {
    expect(names(relatedTests('scripts/commit-guard.cjs', ROOT))).toContain('commit-guard.test.ts');
    expect(names(relatedTests('scripts/hooks/locale-sync.cjs', ROOT))).toContain('hook-scripts.test.ts');
    expect(savedFiles({ file: 'scripts/commit-guard.cjs' })).toEqual(['scripts/commit-guard.cjs']);
  });

  it('runs a saved test file that lives under src/', () => {
    const file = path.join('src', 'lib', 'example.test.ts');
    expect(relatedTests(file, ROOT).map((f) => path.relative(ROOT, f))).toEqual([file]);
  });

  it('maps a locale JSON edit to the tests that use the locales', () => {
    const tests = names(relatedTests('src/packs/language/locales/ms.json', ROOT));
    expect(tests).toEqual(expect.arrayContaining(['language-registry.test.ts', 'hook-scripts.test.ts']));
    expect(tests).not.toContain('commit-guard.test.ts');
  });

  it('stops a test run that exceeds the timeout', () => {
    const { runVitest } = require('../../scripts/hooks/test-on-save.cjs') as {
      runVitest: (root: string, files: string[], timeoutMs: number) => number;
    };
    const root = mkdtempSync(path.join(tmpdir(), 'tos-timeout-'));
    try {
      // A fake "vitest" that never exits.
      mkdirSync(path.join(root, 'node_modules', 'vitest'), { recursive: true });
      writeFileSync(path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'setInterval(() => {}, 1000);\n');
      const started = Date.now();
      const errors: string[] = [];
      const original = console.error;
      console.error = (m: string) => errors.push(m);
      try {
        expect(runVitest(root, [], 500)).toBe(1);
      } finally {
        console.error = original;
      }
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(errors.join(' ')).toContain('did not finish');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('locale-sync: gap report', () => {
  it('reads the core languages from the registry', () => {
    expect(coreTags(ROOT).sort()).toEqual(['en', 'es', 'ms', 'ta', 'zh-Hans', 'zh-Hant']);
  });

  it('reports no gaps for the current core locales', () => {
    expect(localeGaps(ROOT)).toEqual({});
  });

  it('reports a missing key and an [MT] placeholder, and writes nothing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'locale-sync-'));
    try {
      const lang = path.join(root, 'src', 'packs', 'language');
      mkdirSync(lang, { recursive: true });
      cpSync(path.join(ROOT, 'src', 'packs', 'language'), lang, { recursive: true });
      const msFile = path.join(lang, 'locales', 'ms.json');
      const ms = JSON.parse(readFileSync(msFile, 'utf8'));
      delete ms['wizard.next'];
      ms['wizard.back'] = '[MT] Back';
      const before = JSON.stringify(ms, null, 2);
      writeFileSync(msFile, before);

      const gaps = localeGaps(root);
      expect(Object.keys(gaps)).toEqual(['ms']);
      expect([...gaps['ms']!].sort()).toEqual(['wizard.back', 'wizard.next']);
      expect(readFileSync(msFile, 'utf8')).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
