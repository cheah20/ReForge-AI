/**
 * src/worker/routes/analyze-labels.ts
 *
 * POST /api/documents/analyze-labels (formbridge-any-document Requirement 13,
 * design Q2): Kept_Labels in, AI-written questions out. The request carries
 * only the labels the user kept on the Label_Review and the language and
 * country settings; `.strict()` rejects any other key. There is no fixture
 * cache for this route: Original_Label_Mode in the browser is the fallback.
 *
 * Errors name schema paths only. Logging is done by the router with the
 * existing LogEntry fields; this module logs nothing.
 */

import { LabelAnalysisRequestSchema } from '../../shared/schemas.js';
import { AiError } from '../../lib/ai/interface.js';
import { runAnalyzeLabels } from '../../lib/analysis/run-labels.js';
import { getLanguageEntry } from '../../packs/language/registry.js';
import { HttpError, json, schemaDetail } from '../http.js';
import type { RouteContext, RouteResult } from './types.js';

/** 150 labels of 200 code points each, escaped, fit with room to spare (design Q2). */
export const ANALYZE_LABELS_BODY_LIMIT = 160 * 1024;

export async function analyzeLabelsRoute(body: unknown, ctx: RouteContext): Promise<RouteResult> {
  const parsed = LabelAnalysisRequestSchema.safeParse(body);
  if (!parsed.success) throw new HttpError('BAD_REQUEST', schemaDetail(parsed.error.issues));
  const request = parsed.data;

  const language = getLanguageEntry(request.interfaceLanguage);
  if (!language) throw new HttpError('UNSUPPORTED_LANGUAGE');
  const formLanguageName = request.formLanguage ? getLanguageEntry(request.formLanguage)?.modelLanguageName : undefined;

  try {
    const { value, meta } = await runAnalyzeLabels(ctx.provider, request, {
      interfaceLanguageName: language.modelLanguageName,
      ...(formLanguageName ? { formLanguageName } : {}),
    });
    return { response: json(value), meta };
  } catch (err) {
    if (err instanceof AiError) throw new HttpError(err.code === 'AI_TIMEOUT' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE');
    throw err;
  }
}
