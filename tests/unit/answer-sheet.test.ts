/**
 * tests/unit/answer-sheet.test.ts
 *
 * Answer_Sheet content (formbridge-any-document task 11.13): every Kept_Label
 * is listed in page and reading order, statuses and machine-translated marks
 * are right, and the Clerk_Summary falls back to English per key with lang="en".
 * Includes Property 15 and Property 28 (25 runs each, stated here).
 * Validates: Requirements 15.7, 16.4, 18.1, 19.1, 19.2, 19.4, 19.10
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { answerSheetPlainText, buildAnswerSheet, CLERK_KEYS, type LocaleLookup } from '../../src/lib/document/answer-sheet.js';
import type { FieldState } from '../../src/frontend/state.js';

interface Spec {
  id: string;
  page: number;
  line: number;
  text?: string;
  lang?: string;
  answer?: string;
  skipped?: boolean;
  signature?: boolean;
  translation?: { text: string; approved: boolean };
}

function field(s: Spec): FieldState {
  return {
    evidence: { fieldId: s.id, fieldType: s.signature ? 'signature' : 'text' },
    analysis: null,
    status: 'mapped',
    skipped: s.skipped ?? false,
    ...(s.answer !== undefined ? { normalizedOutput: s.answer } : {}),
    ...(s.translation ? { translation: { source: 'x', sourceLanguage: 'en', targetLanguage: 'ms', ...s.translation } } : {}),
    origin: { labelId: s.id, pageNumber: s.page, lineIndex: s.line, text: s.text ?? `Label ${s.id}`, textLang: s.lang ?? 'en', checkYourself: false },
  } as unknown as FieldState;
}

const tables: Record<string, Record<string, string>> = {};
for (const lang of ['en', 'ms']) {
  tables[lang] = JSON.parse(readFileSync(`src/packs/language/locales/${lang}.json`, 'utf8'));
}
const real: LocaleLookup = (lang, key) => tables[lang]?.[key];

describe('buildAnswerSheet rows (19.1)', () => {
  it('lists every field with an origin, ordered by page then reading order', () => {
    const sheet = buildAnswerSheet(
      [field({ id: 'p2-l0', page: 2, line: 0, answer: 'B' }), field({ id: 'p1-l5', page: 1, line: 5, answer: 'C' }), field({ id: 'p1-l1', page: 1, line: 1, answer: 'A' })],
      'en',
      real,
    );
    expect(sheet.rows.map((r) => r.labelId)).toEqual(['p1-l1', 'p1-l5', 'p2-l0']);
    expect(sheet.rows.map((r) => r.answer)).toEqual(['A', 'C', 'B']);
  });

  it('keeps the label text and its language for the lang attribute', () => {
    const [row] = buildAnswerSheet([field({ id: 'p1-l0', page: 1, line: 0, text: 'Nama penuh:', lang: 'ms', answer: 'Aisha' })], 'en', real).rows;
    expect(row).toMatchObject({ labelText: 'Nama penuh:', labelLang: 'ms', status: 'filled', answer: 'Aisha', machineTranslated: false });
  });

  it('marks signature as sign yourself, skipped and unanswered as skipped', () => {
    const rows = buildAnswerSheet(
      [
        field({ id: 'p1-l0', page: 1, line: 0, signature: true, answer: 'ignored' }),
        field({ id: 'p1-l1', page: 1, line: 1, skipped: true, answer: 'typed then skipped' }),
        field({ id: 'p1-l2', page: 1, line: 2 }),
      ],
      'en',
      real,
    ).rows;
    expect(rows.map((r) => r.status)).toEqual(['sign yourself', 'skipped', 'skipped']);
    expect(rows.every((r) => r.answer === undefined)).toBe(true);
  });

  it('leaves out a field with no origin (a fillable PDF field is never on the sheet)', () => {
    const { origin: _origin, ...rest } = field({ id: 'x', page: 1, line: 0, answer: 'v' });
    const plain = rest as unknown as FieldState;
    expect(buildAnswerSheet([plain], 'en', real).rows).toEqual([]);
  });

  it('uses an approved translation and marks it machine translated (19.4)', () => {
    const [row] = buildAnswerSheet([field({ id: 'a', page: 1, line: 0, answer: 'my text', translation: { text: 'teks saya', approved: true } })], 'ms', real).rows;
    expect(row).toMatchObject({ answer: 'teks saya', machineTranslated: true });
  });

  it('ignores a translation the user has not approved', () => {
    const [row] = buildAnswerSheet([field({ id: 'a', page: 1, line: 0, answer: 'my text', translation: { text: 'teks saya', approved: false } })], 'ms', real).rows;
    expect(row).toMatchObject({ answer: 'my text', machineTranslated: false });
  });

  it('is rebuilt from the fields: an edit after viewing shows up (19.10)', () => {
    const before = buildAnswerSheet([field({ id: 'a', page: 1, line: 0, answer: 'old' })], 'en', real);
    const after = buildAnswerSheet([field({ id: 'a', page: 1, line: 0, answer: 'new' })], 'en', real);
    expect(before.rows[0]!.answer).toBe('old');
    expect(after.rows[0]!.answer).toBe('new');
  });
});

describe('Clerk_Summary (19.2)', () => {
  it('uses the Form_Language strings with that lang when the table has the key', () => {
    const { clerk } = buildAnswerSheet([], 'ms', real);
    expect(clerk.lang).toBe('ms');
    for (const key of CLERK_KEYS) {
      expect(clerk.strings[key].lang).toBe('ms');
      expect(clerk.strings[key].text).toBe(tables.ms![`document.clerk.${key}`]);
    }
  });

  it('falls back to English per key and marks only that string lang="en"', () => {
    const lookup: LocaleLookup = (lang, key) => (lang === 'en' ? tables.en![key] : key === 'document.clerk.title' ? 'Judul' : undefined);
    const { clerk } = buildAnswerSheet([], 'xx', lookup);
    expect(clerk.strings.title).toEqual({ text: 'Judul', lang: 'xx' });
    expect(clerk.strings.statement).toEqual({ text: tables.en!['document.clerk.statement'], lang: 'en' });
  });

  it('every real locale table has all five clerk keys, or falls back to English', () => {
    for (const lang of ['en', 'es', 'id', 'ms', 'ta', 'zh-Hans', 'zh-Hant']) {
      const t = JSON.parse(readFileSync(`src/packs/language/locales/${lang}.json`, 'utf8')) as Record<string, string>;
      const sheet = buildAnswerSheet([], lang, (l, k) => (l === lang ? t[k] : tables.en![k]));
      for (const key of CLERK_KEYS) expect(sheet.clerk.strings[key].text.length).toBeGreaterThan(0);
    }
  });
});

describe('answerSheetPlainText (Share without a PDF)', () => {
  it('reads title, statement, then one line per row with statuses and the machine-translated mark', () => {
    const sheet = buildAnswerSheet(
      [
        field({ id: 'p1-l0', page: 1, line: 0, text: 'Full name:', answer: 'Aisha' }),
        field({ id: 'p1-l1', page: 1, line: 1, text: 'Reason:', answer: 'x', translation: { text: 'sebab', approved: true } }),
        field({ id: 'p1-l2', page: 1, line: 2, text: 'Signature:', signature: true }),
        field({ id: 'p1-l3', page: 1, line: 3, text: 'Phone:', skipped: true }),
      ],
      'en',
      real,
    );
    const lines = answerSheetPlainText(sheet).trimEnd().split('\n');
    expect(lines[0]).toBe('For the person at the desk');
    expect(lines.slice(3)).toEqual([
      '1. Full name: Aisha',
      '1. Reason: sebab (Machine translated)',
      '1. Signature: To be signed on the paper form',
      '1. Phone: Not answered',
    ]);
  });
});

describe('Property 15: the Answer_Sheet lists every Kept_Label (25 runs)', () => {
  const specArb = fc.record({
    page: fc.integer({ min: 1, max: 4 }),
    line: fc.integer({ min: 0, max: 40 }),
    answer: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
    skipped: fc.boolean(),
    signature: fc.boolean(),
  });

  it('has exactly one row per field, ordered by page then line, and never drops an answer', () => {
    fc.assert(
      fc.property(fc.uniqueArray(specArb, { selector: (s) => `${s.page}-${s.line}`, maxLength: 20 }), (specs) => {
        const fields = specs.map((s) => field({ id: `p${s.page}-l${s.line}`, page: s.page, line: s.line, skipped: s.skipped, signature: s.signature, ...(s.answer !== undefined ? { answer: s.answer } : {}) }));
        const sheet = buildAnswerSheet(fields, 'en', real);
        expect(sheet.rows.length).toBe(fields.length);
        const keys = sheet.rows.map((r) => [r.pageNumber, Number(r.labelId.split('-l')[1])] as const);
        for (let i = 1; i < keys.length; i++) {
          const [pa, la] = keys[i - 1]!;
          const [pb, lb] = keys[i]!;
          expect(pa < pb || (pa === pb && la <= lb)).toBe(true);
        }
        for (const row of sheet.rows) {
          const src = specs.find((s) => `p${s.page}-l${s.line}` === row.labelId)!;
          if (row.status === 'filled') expect(row.answer).toBe(src.answer);
          else expect(row.answer).toBeUndefined();
        }
      }),
      { numRuns: 25 },
    );
  });
});

describe('Property 28: Clerk_Summary strings and fallback (25 runs)', () => {
  it('takes each string from the Form_Language when it has the key, else from en with lang="en"', () => {
    fc.assert(
      fc.property(fc.subarray([...CLERK_KEYS]), (present) => {
        const lookup: LocaleLookup = (lang, key) => {
          if (lang === 'en') return tables.en![key];
          const short = key.replace('document.clerk.', '') as (typeof CLERK_KEYS)[number];
          return present.includes(short) ? `xx:${short}` : undefined;
        };
        const { clerk } = buildAnswerSheet([], 'xx', lookup);
        for (const key of CLERK_KEYS) {
          if (present.includes(key)) expect(clerk.strings[key]).toEqual({ text: `xx:${key}`, lang: 'xx' });
          else expect(clerk.strings[key]).toEqual({ text: tables.en![`document.clerk.${key}`], lang: 'en' });
        }
      }),
      { numRuns: 25 },
    );
  });
});
