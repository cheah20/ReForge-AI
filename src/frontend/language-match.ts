/**
 * src/frontend/language-match.ts
 *
 * Pre-select a registry language from the browser's preferred languages
 * (`navigator.languages`). The user always confirms the choice on the picker.
 */

import { FALLBACK_LANGUAGE, LANGUAGE_REGISTRY } from '../packs/language/registry.js';

/** Chinese regions that use Traditional characters by default. */
const TRADITIONAL_REGIONS = new Set(['TW', 'HK', 'MO']);

/** The registry tag for one browser tag, or undefined when no registry language fits. */
export function matchOne(browserTag: string): string | undefined {
  const parts = browserTag.trim().replace(/_/g, '-').split('-').filter(Boolean);
  const language = parts[0]?.toLowerCase();
  if (!language) return undefined;
  const rest = parts.slice(1);
  const known = (tag: string) => LANGUAGE_REGISTRY.some((e) => e.tag === tag);

  if (language === 'zh') {
    const script = rest.find((p) => p.length === 4)?.toLowerCase();
    if (script === 'hant') return 'zh-Hant';
    if (script === 'hans') return 'zh-Hans';
    const region = rest.find((p) => p.length === 2)?.toUpperCase();
    return region && TRADITIONAL_REGIONS.has(region) ? 'zh-Hant' : 'zh-Hans';
  }
  // Malay is also tagged "zsm" (Standard Malay) by some systems.
  if (language === 'zsm') return 'ms';
  return known(language) ? language : undefined;
}

/** First browser language the registry supports, else English. */
export function matchLanguage(browserTags: readonly string[]): string {
  for (const tag of browserTags) {
    const match = matchOne(tag);
    if (match) return match;
  }
  return FALLBACK_LANGUAGE;
}

/** The browser's preferred languages, or an empty list outside a browser. */
export function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}
