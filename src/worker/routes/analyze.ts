/**
 * src/worker/routes/analyze.ts
 *
 * POST /api/forms/analyze: one batch of field evidence in, field analysis out.
 * On quota, rate-limit or timeout failures the precomputed fixture cache is
 * tried (requirement 12.7); without a cache hit the route answers 503
 * AI_UNAVAILABLE (or 504 AI_TIMEOUT).
 */

import { AnalyzeRequestSchema } from '../../shared/schemas.js';
import { AiError, isCacheFallbackError } from '../../lib/ai/interface.js';
import { runAnalyze } from '../../lib/analysis/run.js';
import { getLanguageEntry } from '../../packs/language/registry.js';
import { lookupFixtureCache, type FixtureCacheStore } from '../cache/fixture-cache.js';
import { HttpError, json, schemaDetail } from '../http.js';
import type { RouteContext, RouteResult } from './types.js';

export const ANALYZE_BODY_LIMIT = 32 * 1024;

export async function analyzeRoute(
  body: unknown,
  ctx: RouteContext,
  cache?: FixtureCacheStore,
): Promise<RouteResult> {
  const parsed = AnalyzeRequestSchema.safeParse(body);
  if (!parsed.success) throw new HttpError('BAD_REQUEST', schemaDetail(parsed.error.issues));
  const request = parsed.data;

  const language = getLanguageEntry(request.interfaceLanguage);
  if (!language) throw new HttpError('UNSUPPORTED_LANGUAGE');

  try {
    const { value, meta } = await runAnalyze(ctx.provider, request, language.modelLanguageName);
    return { response: json(value), meta };
  } catch (err) {
    if (isCacheFallbackError(err)) {
      const cached = lookupFixtureCache(request.contentHash, request.interfaceLanguage, cache);
      if (cached) return { response: json(cached), servedFromCache: true };
      throw new HttpError((err as AiError).code === 'AI_TIMEOUT' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE');
    }
    if (err instanceof AiError) throw new HttpError('AI_UNAVAILABLE');
    throw err;
  }
}
