/**
 * src/worker/cache/cache-key.ts
 *
 * The fixture cache file key, "<sha256>-<bcp47>". Kept free of Vite-only APIs
 * so Node scripts (the cache generator) can import it.
 */

export function cacheKey(contentHash: string, interfaceLanguage: string): string {
  return `${contentHash}-${interfaceLanguage}`;
}
