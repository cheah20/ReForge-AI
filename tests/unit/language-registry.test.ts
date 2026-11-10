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
} from '../../src/packs/language/registry.js';

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
