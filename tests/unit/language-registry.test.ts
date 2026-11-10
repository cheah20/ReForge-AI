/**
 * tests/unit/language-registry.test.ts
 *
 * The language registry reads each native name from that language's own
 * locale file, so non-English text lives only in locale files.
 * Validates: Requirements 2-L.1, 2-L.2
 */

import { describe, it, expect } from 'vitest';
import {
  LANGUAGE_REGISTRY,
  getLanguageEntry,
  getCoreLanguages,
  getLocaleStrings,
  getOwnLocaleStrings,
  translate,
} from '../../src/packs/language/registry.js';
import en from '../../src/packs/language/locales/en.json';

describe('language registry', () => {
  it('contains the Nov 17 languages with the expected status', () => {
    const status = Object.fromEntries(LANGUAGE_REGISTRY.map((e) => [e.tag, e.status]));
    expect(status).toEqual({
      en: 'core',
      ms: 'core',
      'zh-Hans': 'core',
      'zh-Hant': 'core',
      ta: 'core',
      es: 'core',
      id: 'experimental',
    });
  });

  it('takes every native name from the matching locale file', () => {
    for (const entry of LANGUAGE_REGISTRY) {
      const strings = getLocaleStrings(entry.tag);
      expect(strings, entry.tag).toBeDefined();
      expect(entry.nativeName.length).toBeGreaterThan(0);
      expect(entry.nativeName).toBe(strings?.['language.nativeName']);
    }
  });

  it('gives distinct native names to distinct languages', () => {
    const names = LANGUAGE_REGISTRY.map((e) => e.nativeName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('looks up entries by tag and returns undefined for unknown tags', () => {
    expect(getLanguageEntry('ms')?.modelLanguageName).toBe('Malay');
    expect(getLanguageEntry('xx')).toBeUndefined();
  });

  it('lists core languages only', () => {
    expect(getCoreLanguages().map((e) => e.tag)).not.toContain('id');
    expect(getCoreLanguages()).toHaveLength(6);
  });
});

describe('English fallback (review item 12)', () => {
  it('the experimental Indonesian locale really lacks the US-only keys', () => {
    expect(getOwnLocaleStrings('id')?.['validation.zip.invalid']).toBeUndefined();
  });

  it('a key missing from a locale shows the English text', () => {
    expect(getLocaleStrings('id')['validation.zip.invalid']).toBe(en['validation.zip.invalid']);
    expect(translate('id', 'validation.ssn.invalid')).toBe(en['validation.ssn.invalid']);
  });

  it('a key present in the locale is not replaced by English', () => {
    expect(translate('id', 'wizard.next')).toBe('Berikutnya');
  });

  it('an unknown tag gives English', () => {
    expect(translate('xx', 'wizard.next')).toBe(en['wizard.next']);
  });

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(translate('en', 'wizard.step', { current: 2, total: 22 })).toBe('Question 2 of 22');
    expect(translate('en', 'wizard.step', { current: 2 })).toBe('Question 2 of {total}');
  });

  it('returns the key itself when no locale has it', () => {
    expect(translate('ms', 'no.such.key')).toBe('no.such.key');
  });
});
