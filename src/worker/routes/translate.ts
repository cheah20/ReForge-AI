/**
 * src/worker/routes/translate.ts
 *
 * POST /api/forms/translate: translate one description answer into the form's
 * output language.
 *
 * This is the only route that receives text the user typed. The browser calls
 * it only after the user presses "Translate my answer" (requirement 8.6, tested
 * in the session-state tests); the route itself cannot tell, so it trusts that
 * gate. The text is used for the AI call only: it is never stored or logged.
 */

import { TranslateRequestSchema } from '../../shared/schemas.js';
import { AiError } from '../../lib/ai/interface.js';
import { runTranslate } from '../../lib/analysis/run.js';
import { getLanguageEntry } from '../../packs/language/registry.js';
import { HttpError, json, schemaDetail } from '../http.js';
import type { RouteContext, RouteResult } from './types.js';

export const TRANSLATE_BODY_LIMIT = 16 * 1024;

export async function translateRoute(body: unknown, ctx: RouteContext): Promise<RouteResult> {
  const parsed = TranslateRequestSchema.safeParse(body);
  if (!parsed.success) throw new HttpError('BAD_REQUEST', schemaDetail(parsed.error.issues));
  const source = getLanguageEntry(parsed.data.sourceLanguage);
  const target = getLanguageEntry(parsed.data.targetLanguage);
  if (!source || !target) throw new HttpError('UNSUPPORTED_LANGUAGE');

  try {
    const { value, meta } = await runTranslate(ctx.provider, parsed.data, source.modelLanguageName, target.modelLanguageName);
    return { response: json(value), meta };
  } catch (err) {
    if (err instanceof AiError) throw new HttpError(err.code === 'AI_TIMEOUT' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE');
    throw err;
  }
}
