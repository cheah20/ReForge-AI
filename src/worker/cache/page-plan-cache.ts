/**
 * src/worker/cache/page-plan-cache.ts
 *
 * accessforge-skeleton task 13.6 (design Question 5, Requirement 7.2).
 * Precomputed page plans for the legacy registration page, used only after a
 * failed live call. Files are `precomputed/pages/<pageVersion>-<bcp47>.json`,
 * each a PrecomputedPagePlanSchema object. Lookup is by exact Page_Version
 * and exact language tag; there is no fallback to another language or
 * version. The PDF cache glob (`./precomputed/*.json`) does not descend into
 * `pages/`, so the two caches cannot mix.
 */

import { PrecomputedPagePlanSchema, type PrecomputedPagePlan } from '../../shared/page-schemas.js';

const BUNDLED = import.meta.glob<unknown>('./precomputed/pages/*.json', { eager: true, import: 'default' });

export type PagePlanStore = Readonly<Record<string, unknown>>;

/** Store keyed by "<pageVersion>-<tag>" from the bundled files. */
export function bundledPagePlanStore(files: Record<string, unknown> = BUNDLED): PagePlanStore {
  const store: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(files)) {
    const name = path.split('/').pop()?.replace(/\.json$/, '');
    if (name) store[name] = value;
  }
  return store;
}

const DEFAULT_STORE = bundledPagePlanStore();

export function pagePlanKey(pageVersion: string, language: string): string {
  return `${pageVersion}-${language}`;
}

/**
 * The plan for exactly (pageVersion, language), or null when there is none,
 * the file fails the schema, or the file names another version or language.
 */
export function lookupPagePlanCache(pageVersion: string, language: string, store: PagePlanStore = DEFAULT_STORE): PrecomputedPagePlan | null {
  if (!/^[0-9a-f]{64}$/.test(pageVersion)) return null;
  const entry = store[pagePlanKey(pageVersion, language)];
  if (entry === undefined) return null;
  const parsed = PrecomputedPagePlanSchema.safeParse(entry);
  if (!parsed.success) return null;
  if (parsed.data.pageVersion !== pageVersion || parsed.data.interfaceLanguage !== language) return null;
  return parsed.data;
}
