/**
 * tests/unit/document-binding-static.test.ts
 *
 * Static checks on the Document_Path code (formbridge-any-document tasks
 * 10.13 and 10.15): no copy of a validation rule, no storage, no cookie, no
 * history state with document data, no Cache Storage outside the OCR service,
 * and no use of the fillable-PDF widget snippet code. Plus: a typed page error
 * never carries document text.
 * Validates: Requirements 16.1, 16.5, 20.2, 24.10, 24.11
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PageError } from '../../src/frontend/document/decode.js';
import { OcrError } from '../../src/frontend/document/ocr.js';

const DIRS = ['src/lib/document', 'src/frontend/document'];

function sourceFiles(): Array<{ file: string; code: string }> {
  const out: Array<{ file: string; code: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push({ file: full.replace(/\\/g, '/'), code: readFileSync(full, 'utf8') });
    }
  };
  for (const d of DIRS) walk(d);
  return out;
}

/** Source without comments and string literals' contents, so a word in a doc comment is not a use. */
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const FILES = sourceFiles().map((f) => ({ ...f, code: stripComments(f.code) }));

describe('the scan covers the Document_Path', () => {
  it('finds the modules this spec has written so far', () => {
    const names = FILES.map((f) => path.basename(f.file));
    for (const n of ['sniff.ts', 'value-rules.ts', 'review.ts', 'request.ts', 'ocr.ts', 'decode.ts', 'pipeline.ts', 'session.ts', 'leave-guard.ts']) expect(names).toContain(n);
  });
});

describe('no copy of a validation rule (10.13, Requirements 16.1, 16.5)', () => {
  it('only value-rules.ts imports the country pack pattern exports, and no module imports a validator other than validateAnswer', () => {
    for (const f of FILES) {
      const packImports = [...f.code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'[^']*packs\/country\/[^']*'/g)];
      for (const m of packImports) {
        const names = m[1]!.split(',').map((s) => s.trim().replace(/^type\s+/, '')).filter(Boolean);
        if (f.file.endsWith('value-rules.ts')) {
          expect(names.every((n) => /^(MY_IC_SEARCH|US_SSN_SEARCH|EMAIL_SEARCH)$/.test(n)), `${f.file}: ${names.join(', ')}`).toBe(true);
        } else {
          expect(names.every((n) => n === 'validateAnswer'), `${f.file} imports ${names.join(', ')}`).toBe(true);
        }
      }
      expect(f.code, f.file).not.toMatch(/\bvalidate(Ic|MyPhone|UsPhone|InternationalPhone|Zip|Ssn|Email|Postcode|Date)\b/);
    }
  });

  it('no module outside value-rules.ts and digit-view.ts writes an IC, phone, postcode, email or date pattern', () => {
    // Regular expression literals with the shapes of those rules: 5, 6 or 12 digit runs, an @ class, a date with separators.
    const suspicious = [/\/[^/\n]*\\d\{(5|6|9|10|12)(,\d*)?\}[^/\n]*\//, /\/[^/\n]*\[\^\\s@\][^/\n]*\//, /\/[^/\n]*\\d\{1,2\}[^/\n]*[/.-][^/\n]*\\d\{1,2\}[^/\n]*\//];
    for (const f of FILES) {
      if (/value-rules\.ts$|digit-view\.ts$/.test(f.file)) continue;
      for (const re of suspicious) expect(f.code, `${f.file} matches ${re}`).not.toMatch(re);
    }
  });

  it('the analysis answers go through validateAnswer: the document session defines no validation of its own', () => {
    const session = FILES.find((f) => f.file.endsWith('session.ts'))!.code;
    expect(session).not.toMatch(/function validate/);
    expect(session).not.toMatch(/\.test\(/);
  });
});

describe('storage and the fillable-path snippet rules (10.15, Requirements 20.2, 24.10, 24.11)', () => {
  it('no localStorage, sessionStorage, IndexedDB, cookie or history state is used', () => {
    for (const f of FILES) {
      expect(f.code, f.file).not.toMatch(/\b(localStorage|sessionStorage|indexedDB|IDBFactory)\b/);
      expect(f.code, f.file).not.toMatch(/document\.cookie/);
      expect(f.code, f.file).not.toMatch(/history\.(pushState|replaceState)/);
    }
  });

  it('Cache Storage is used only by the OCR service, and only for the reforge-ocr cache', () => {
    for (const f of FILES) {
      if (f.file.endsWith('src/frontend/document/ocr.ts')) {
        expect(f.code).toMatch(/caches\.open\(name\)/);
        expect(f.code).toContain('`reforge-ocr-${version}`');
      } else {
        expect(f.code, f.file).not.toMatch(/\bcaches\b/);
        expect(f.code, f.file).not.toMatch(/CacheStorage/);
      }
    }
  });

  it('nothing imports the widget snippet code of the fillable path', () => {
    for (const f of FILES) {
      expect(f.code, f.file).not.toMatch(/page-text|computePageSnippets|pageGuardRects|pdf-extract\/index/);
    }
  });

  it('the Document_Path never calls fetch with a page, a label or an answer: the only fetch is the OCR service for engine files', () => {
    for (const f of FILES) {
      if (f.file.endsWith('src/frontend/document/ocr.ts')) continue;
      expect(f.code, f.file).not.toMatch(/\bfetch\(/);
      expect(f.code, f.file).not.toMatch(/XMLHttpRequest|sendBeacon|WebSocket/);
    }
  });
});

describe('typed errors carry no document text (10.15)', () => {
  const CANARY = 'ZQXERR 900101-14-5678';

  it('a PageError and an OcrError message hold only their code', () => {
    for (const code of ['decode-failed', 'encrypted', 'truncated', 'render-failed'] as const) {
      const e = new PageError(code);
      expect(e.message).toBe(code);
      expect(String(e)).not.toContain(CANARY);
    }
    for (const code of ['assets-unavailable', 'verification-failed', 'cancelled', 'unsupported'] as const) expect(new OcrError(code).message).toBe(code);
  });

  it('the decoder turns a browser failure that mentions the file into a code-only error', async () => {
    const { decodePhoto } = await import('../../src/frontend/document/decode.js');
    const png = new Uint8Array(readFileSync('fixtures/documents/clean-en.png'));
    const deps = {
      createImageBitmap: async () => Promise.reject(new Error(`cannot decode ${CANARY}`)),
      createCanvas: () => {
        throw new Error('unused');
      },
      createObjectURL: () => '',
      revokeObjectURL: () => {},
    };
    const err = await decodePhoto(new Blob([png as unknown as BlobPart]), deps, true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PageError);
    expect((err as Error).message).not.toContain('ZQXERR');
  });
});
