/**
 * src/worker/routes/page-analyze.ts
 *
 * POST /api/pages/analyze (accessforge-skeleton task 13.7, design Question 5
 * and "API Routes"). The Page_Model of the legacy registration page and the
 * interface language in, a validated Page_Plan and its Analysis_Mode out.
 *
 * Slice 1 rows of the decision table:
 * - mock provider: valid reply -> `mock`; invalid twice -> 500 INTERNAL_ERROR,
 *   so no response claims a mode that did not produce the plan.
 * - real provider: valid reply -> `live`; any failure -> the precomputed plan
 *   for the exact (Page_Version, language) -> `cached`; none -> 503 AI_UNAVAILABLE.
 * Every plan passes the Plan_Validator against the submitted Page_Model
 * before it is returned. Errors name schema paths only; the router logs.
 */

import { PageAnalyzeRequestSchema, PageAnalyzeResponseSchema, type AnalysisMode, type PageModel, type PageAnalyzeResponse } from '../../shared/page-schemas.js';
import { validatePlan } from '../../lib/accessforge/plan-validator.js';
import { runPageAnalyze } from '../../lib/analysis/run-page.js';
import { getLanguageEntry } from '../../packs/language/registry.js';
import { lookupPagePlanCache } from '../cache/page-plan-cache.js';
import { HttpError, json, schemaDetail } from '../http.js';
import type { RouteContext, RouteResult } from './types.js';

/** The ten-entry registration model is about 4 KB; this allows the schema maximum of 50 short entries. */
export const PAGE_ANALYZE_BODY_LIMIT = 48 * 1024;

/** The validated plan's entries in Page_Model order. */
function respond(model: PageModel, raw: readonly unknown[], analysisMode: AnalysisMode): PageAnalyzeResponse {
  const plan = validatePlan(model, raw);
  const entries = model.entries.flatMap((e) => {
    const p = plan.mapped.get(e.elementId);
    return p ? [p] : [];
  });
  return PageAnalyzeResponseSchema.parse({ analysisMode, entries });
}

export async function pageAnalyzeRoute(body: unknown, ctx: RouteContext): Promise<RouteResult> {
  const parsed = PageAnalyzeRequestSchema.safeParse(body);
  if (!parsed.success) throw new HttpError('BAD_REQUEST', schemaDetail(parsed.error.issues));
  const request = parsed.data;
  const language = getLanguageEntry(request.interfaceLanguage);
  if (!language) throw new HttpError('UNSUPPORTED_LANGUAGE');

  const outcome = await runPageAnalyze(ctx.provider, request, language.modelLanguageName);
  if (outcome.ok) {
    const mode: AnalysisMode = ctx.provider.kind === 'mock' ? 'mock' : 'live';
    return { response: json(respond(request.pageModel, outcome.entries, mode)), meta: outcome.meta };
  }
  if (ctx.provider.kind === 'mock') throw new HttpError('INTERNAL_ERROR');

  const cached = lookupPagePlanCache(request.pageModel.pageVersion, request.interfaceLanguage, ...(ctx.pagePlans ? [ctx.pagePlans] : []));
  if (!cached) throw new HttpError('AI_UNAVAILABLE');
  return { response: json(respond(request.pageModel, cached.entries, 'cached')), meta: outcome.meta, servedFromCache: true };
}
