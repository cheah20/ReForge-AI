/**
 * tests/unit/locale-completeness.test.ts
 *
 * formbridge-pdf task 40.1, Property 12: core locale completeness. For every
 * language with status `core` in the registry, every key of `en.json` has a
 * non-empty entry. Two further checks stop the cheap ways of passing it: a
 * translation keeps the same `{placeholders}` as the English text, and no
 * translation is a copy of the English text unless the text is the same in
 * every language (a name, a format, a number).
 * Validates: Requirements 1.4, 2-L.1
 */

import { describe, it, expect } from 'vitest';
import { getCoreLanguages, getLanguageEntry, getOwnLocaleStrings } from '../../src/packs/language/registry.js';

const en = getOwnLocaleStrings('en')!;
const KEYS = Object.keys(en);
const OTHER_CORE = getCoreLanguages().map((l) => l.tag).filter((t) => t !== 'en');

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

/** Text that reads the same in every language, so a copy of the English is right. */
const SAME_EVERYWHERE = (key: string, text: string): boolean =>
  key === 'app.title' ||
  /^[\s\d.,:;/()+\-–—%{}A-Za-z]{0,3}$/.test(text) ||
  // A text made only of placeholders, numbers and punctuation.
  /^[\s\d.,:;/()+\-–—%]*(\{\w+\}[\s\d.,:;/()+\-–—%]*)*$/.test(text);

/** Words the language really spells like English (cognates and loan words), checked by a reader of that language. */
const COGNATES: Record<string, ReadonlySet<string>> = {
  ms: new Set(['review.edit', 'accessforge.review.edit', 'accessforge.review.col.status']),
  es: new Set(['language.picker.experimental']),
};

/** Plural categories some languages need beyond English's `one` and `other` (Spanish has `many`). */
const EXTRA_PLURAL = /^(.*)\.(zero|two|few|many)$/;
const isPluralExtra = (key: string) => {
  const m = EXTRA_PLURAL.exec(key);
  return m !== null && `${m[1]}.other` in en;
};

describe('core locale completeness (Property 12)', () => {
  it('there are core languages besides English to check', () => {
    expect(OTHER_CORE.length).toBeGreaterThanOrEqual(5);
    expect(KEYS.length).toBeGreaterThan(300);
  });

  it.each(OTHER_CORE)('%s has a non-empty entry for every key of en.json', (tag) => {
    const strings = getOwnLocaleStrings(tag);
    expect(strings, `no locale file for ${tag}`).toBeDefined();
    const missing = KEYS.filter((k) => typeof strings![k] !== 'string' || strings![k]!.trim() === '');
    expect(missing).toEqual([]);
  });

  it.each(OTHER_CORE)('%s has no key that en.json lacks, and no placeholder marker', (tag) => {
    const strings = getOwnLocaleStrings(tag)!;
    const extra = Object.keys(strings).filter((k) => !(k in en) && !isPluralExtra(k));
    expect(extra).toEqual([]);
    expect(Object.entries(strings).filter(([, v]) => v.startsWith('[MT]')).map(([k]) => k)).toEqual([]);
  });

  it.each(OTHER_CORE)('%s keeps the same {placeholders} as English in every entry', (tag) => {
    const strings = getOwnLocaleStrings(tag)!;
    const wrong = KEYS.filter((k) => JSON.stringify(placeholders(strings[k] ?? '')) !== JSON.stringify(placeholders(en[k]!)));
    expect(wrong).toEqual([]);
  });

  it.each(OTHER_CORE)('%s is not an English copy for any key that should differ', (tag) => {
    const strings = getOwnLocaleStrings(tag)!;
    const copies = KEYS.filter((k) => strings[k] === en[k] && !SAME_EVERYWHERE(k, en[k]!) && !COGNATES[tag]?.has(k));
    expect(copies, `${tag} repeats the English text for these keys`).toEqual([]);
  });

  it('every core language in the registry has a native name that comes from its own locale file', () => {
    for (const lang of getCoreLanguages()) {
      expect(getLanguageEntry(lang.tag)?.nativeName).toBe(getOwnLocaleStrings(lang.tag)!['language.nativeName']);
    }
  });
});
