/**
 * src/frontend/i18n.tsx
 *
 * React i18n provider. Every UI string goes through `t(key, params)`:
 * - strings come from the active locale, with English for any missing key
 * - `<html lang>` and `<html dir>` follow the active language, so screen
 *   readers pronounce the text in the right language
 * - the language's Noto UI font is loaded lazily when it is selected
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FALLBACK_LANGUAGE, getLanguageEntry, translate, type LanguageEntry } from '../packs/language/registry.js';
import { loadUiFont } from './fonts.js';

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export interface I18nValue {
  /** Active interface language (BCP 47 tag). */
  language: string;
  entry: LanguageEntry;
  setLanguage: (tag: string) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nValue | null>(null);

export interface I18nProviderProps {
  initialLanguage?: string;
  children: ReactNode;
  /** Replaces the font loader (tests). */
  fontLoader?: (family: string) => Promise<boolean>;
}

function entryFor(tag: string): LanguageEntry {
  return getLanguageEntry(tag) ?? getLanguageEntry(FALLBACK_LANGUAGE)!;
}

export function I18nProvider({ initialLanguage = FALLBACK_LANGUAGE, children, fontLoader = loadUiFont }: I18nProviderProps) {
  const [language, setLanguageState] = useState(() => entryFor(initialLanguage).tag);
  const entry = entryFor(language);

  // Unknown tags fall back to English instead of leaving the UI without strings.
  const setLanguage = useCallback((tag: string) => setLanguageState(entryFor(tag).tag), []);

  useEffect(() => {
    const html = document.documentElement;
    html.lang = entry.tag;
    html.dir = entry.direction;
    void fontLoader(entry.uiFontFamily);
  }, [entry, fontLoader]);

  const t = useCallback<TranslateFn>((key, params) => translate(language, key, params), [language]);
  const value = useMemo(() => ({ language, entry, setLanguage, t }), [language, entry, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useTranslation must be used inside <I18nProvider>');
  return value;
}
