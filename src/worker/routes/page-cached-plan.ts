/**
 * src/worker/routes/page-cached-plan.ts
 *
 * accessforge-skeleton task 25.4 (Slice 2, Requirement 7.7).
 * GET /api/pages/cached-plan?version=<Page_Version>&lang=<tag>: the bundled
 * Precomputed_Page_Plan for exactly that version and language. It reads the
 * stored plans only and never calls the AI provider. The browser passes the
 * entries through its own Plan_Validator before using them.
 */
import { CachedPlanQuerySchema, PageAnalyzeResponseSchema } from '../../shared/page-schemas.js';
import { lookupPagePlanCache } from '../cache/page-plan-cache.js';
import { HttpError, json, schemaDetail } from '../http.js';
import type { RouteContext, RouteResult } from './types.js';

/** A GET has no body; the router passes the query as an object. */
export const PAGE_CACHED_PLAN_BODY_LIMIT = 0;

export async function pageCachedPlanRoute(query: unknown, ctx: RouteContext): Promise<RouteResult> {
  const parsed = CachedPlanQuerySchema.safeParse(query);
  if (!parsed.success) throw new HttpError('BAD_REQUEST', schemaDetail(parsed.error.issues));
  const plan = lookupPagePlanCache(parsed.data.version, parsed.data.lang, ...(ctx.pagePlans ? [ctx.pagePlans] : []));
  if (!plan) throw new HttpError('NOT_FOUND');
  return { response: json(PageAnalyzeResponseSchema.parse({ analysisMode: 'cached', entries: plan.entries })), servedFromCache: true };
}
