/**
 * src/worker/routes/page-retranslate.ts
 *
 * accessforge-skeleton task 25.3 (Slice 2, Requirements 7.7, 7.9, 13.1).
 * POST /api/pages/retranslate: new wording for the labels and questions of a
 * Page_Plan after the user changes the interface language. The body holds only
 * the existing wording in plan order and the target language: no Page_Model,
 * no Element_Id and no answer. The reply must hold exactly one item for each
 * item sent; the router logs only the allowed operational fields.
 */
import { PageRetranslateRequestSchema, PageRetranslateResponseSchema } from '../../shared/page-schemas.js';
import { runPageRetranslate } from '../../lib/analysis/run-page.js';
import { getLanguageEntry } from '../../packs/language/registry.js';
import { HttpError, json, schemaDetail } from '../http.js';
import type { RouteContext, RouteResult } from './types.js';

/** 50 items of at most 280 characters each stay under this, even in CJK. */
export const PAGE_RETRANSLATE_BODY_LIMIT = 48 * 1024;

export async function pageRetranslateRoute(body: unknown, ctx: RouteContext): Promise<RouteResult> {
  const parsed = PageRetranslateRequestSchema.safeParse(body);
  if (!parsed.success) throw new HttpError('BAD_REQUEST', schemaDetail(parsed.error.issues));
  const language = getLanguageEntry(parsed.data.targetLanguage);
  if (!language) throw new HttpError('UNSUPPORTED_LANGUAGE');
  const outcome = await runPageRetranslate(ctx.provider, parsed.data, language.modelLanguageName);
  if (!outcome.ok) throw new HttpError(outcome.reason === 'timeout' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE');
  return { response: json(PageRetranslateResponseSchema.parse({ items: outcome.items })), meta: outcome.meta };
}
