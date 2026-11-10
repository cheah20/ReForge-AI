/**
 * src/packs/language/registry.ts
 *
 * Language registry — the single source of truth for supported languages.
 * Adding a language: create a locale file + add one entry here.
 */

export interface LanguageEntry {
  /** BCP 47 tag, e.g. "zh-Hans" */
  tag: string;
  /** Native name shown in the language picker (read from the locale file's "language.nativeName" key) */
  nativeName: string;
  direction: 'ltr' | 'rtl';
  /** Noto font family name for UI rendering */
  uiFontFamily: string;
  /** Noto font family name for PDF appearance generation */
  pdfFontFamily: string;
  status: 'core' | 'experimental';
  /** Language name used in AI prompts, e.g. "Simplified Chinese" */
  modelLanguageName: string;
}

import en from './locales/en.json';
import ms from './locales/ms.json';
import zhHans from './locales/zh-Hans.json';
import zhHant from './locales/zh-Hant.json';
import ta from './locales/ta.json';
import es from './locales/es.json';
import id from './locales/id.json';

/** Locale files keyed by BCP 47 tag. Each holds its own "language.nativeName". */
const LOCALES: Readonly<Record<string, Record<string, string>>> = {
  en,
  ms,
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
  ta,
  es,
  id,
};

type RegistryEntryInput = Omit<LanguageEntry, 'nativeName'>;

/**
 * Registered languages. Core = fully translated + tested.
 * Experimental = partial translation; missing UI keys fall back to English.
 */
const ENTRIES: readonly RegistryEntryInput[] = [
  {
    tag: 'en',
    direction: 'ltr',
    uiFontFamily: 'Noto Sans',
    pdfFontFamily: 'Noto Sans',
    status: 'core',
    modelLanguageName: 'English',
  },
  {
    tag: 'ms',
    direction: 'ltr',
    uiFontFamily: 'Noto Sans',
    pdfFontFamily: 'Noto Sans',
    status: 'core',
    modelLanguageName: 'Malay',
  },
  {
    tag: 'zh-Hans',
    direction: 'ltr',
    uiFontFamily: 'Noto Sans SC',
    pdfFontFamily: 'Noto Sans SC',
    status: 'core',
    modelLanguageName: 'Simplified Chinese',
  },
  {
    tag: 'zh-Hant',
    direction: 'ltr',
    uiFontFamily: 'Noto Sans TC',
    pdfFontFamily: 'Noto Sans TC',
    status: 'core',
    modelLanguageName: 'Traditional Chinese',
  },
  {
    tag: 'ta',
    direction: 'ltr',
    uiFontFamily: 'Noto Sans Tamil',
    pdfFontFamily: 'Noto Sans Tamil',
    status: 'core',
    modelLanguageName: 'Tamil',
  },
  {
    tag: 'es',
    direction: 'ltr',
    uiFontFamily: 'Noto Sans',
    pdfFontFamily: 'Noto Sans',
    status: 'core',
    modelLanguageName: 'Spanish',
  },
  {
    tag: 'id',
    direction: 'ltr',
    uiFontFamily: 'Noto Sans',
    pdfFontFamily: 'Noto Sans',
    status: 'experimental',
    modelLanguageName: 'Indonesian',
  },
];

/** Native name from the language's own locale file; throws at load time if the key is missing. */
function nativeNameFor(tag: string): string {
  const name = LOCALES[tag]?.['language.nativeName'];
  if (!name) {
    throw new Error(`Locale file for "${tag}" is missing "language.nativeName"`);
  }
  return name;
}

export const LANGUAGE_REGISTRY: readonly LanguageEntry[] = ENTRIES.map((e) => ({
  ...e,
  nativeName: nativeNameFor(e.tag),
}));

export const FALLBACK_LANGUAGE = 'en';

/**
 * The keys a locale file actually contains, without fallback. Used by the
 * locale completeness test; UI code should use getLocaleStrings or translate.
 */
export function getOwnLocaleStrings(tag: string): Readonly<Record<string, string>> | undefined {
  return LOCALES[tag];
}

const merged = new Map<string, Readonly<Record<string, string>>>();

/**
 * UI strings for a tag: the locale's own strings over the English ones, so any
 * key missing from the locale shows in English. An unknown tag gives English.
 */
export function getLocaleStrings(tag: string): Readonly<Record<string, string>> {
  let strings = merged.get(tag);
  if (!strings) {
    strings = Object.freeze({ ...LOCALES[FALLBACK_LANGUAGE], ...(LOCALES[tag] ?? {}) });
    merged.set(tag, strings);
  }
  return strings;
}

/**
 * Translate one key, filling `{name}` placeholders from `params`.
 * A key missing everywhere returns the key itself so the gap is visible.
 */
export function translate(tag: string, key: string, params: Record<string, string | number> = {}): string {
  const template = getLocaleStrings(tag)[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/** Look up a language entry by BCP 47 tag. Returns undefined if not found. */
export function getLanguageEntry(tag: string): LanguageEntry | undefined {
  return LANGUAGE_REGISTRY.find((e) => e.tag === tag);
}

/** Returns all core languages. */
export function getCoreLanguages(): readonly LanguageEntry[] {
  return LANGUAGE_REGISTRY.filter((e) => e.status === 'core');
}
