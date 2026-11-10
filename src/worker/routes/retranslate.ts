/**
 * src/worker/routes/retranslate.ts
 *
 * POST /api/forms/retranslate: new wording for labels and questions after the
 * user switches interface language (requirement 5.8). No structural analysis
 * is repeated; only humanLabel and question come back.
 */

import { RetranslateRequestSchema } from '../../shared/schemas.js';
import { AiError } from '../../lib/ai/interface.js';
import { runRetranslate } from '../../lib/analysis/run.js';
import { getLanguageEntry } from '../../packs/language/registry.js';
import { HttpError, json, schemaDetail } from '../http.js';
import type { RouteContext, RouteResult } from './types.js';

/** 30 fields with CJK labels and questions stay well under this. */
export const RETRANSLATE_BODY_LIMIT = 48 * 1024;

export async function retranslateRoute(body: unknown, ctx: RouteContext): Promise<RouteResult> {
  const parsed = RetranslateRequestSchema.safeParse(body);
  if (!parsed.success) throw new HttpError('BAD_REQUEST', schemaDetail(parsed.error.issues));
  const language = getLanguageEntry(parsed.data.targetLanguage);
  if (!language) throw new HttpError('UNSUPPORTED_LANGUAGE');

  try {
    const { value, meta } = await runRetranslate(ctx.provider, parsed.data, language.modelLanguageName);
    return { response: json(value), meta };
  } catch (err) {
    if (err instanceof AiError) throw new HttpError(err.code === 'AI_TIMEOUT' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE');
    throw err;
  }
}
