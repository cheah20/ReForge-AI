/**
 * src/worker/index.ts
 *
 * Cloudflare Worker entry: the API routes plus the static frontend.
 * `/api/*` runs here first (assets.run_worker_first); every other path is served
 * from the built frontend with SPA fallback.
 *
 * Per request: method check -> body size limit -> JSON parse -> zod validation
 * (inside the route) -> per-IP rate limit -> AI call. Every error uses the shared
 * error shape, and only metadata is logged.
 */

import { CfWorkersAiProvider, type AiBinding } from '../lib/ai/cf-workers.js';
import type { AiProvider } from '../lib/ai/interface.js';
import { MockAiProvider } from '../lib/ai/mock.js';
import { resolveAiMode } from './ai-mode.js';
import type { FixtureCacheStore } from './cache/fixture-cache.js';
import { consoleLogger, errorResponse, HttpError, readJson, type LogEntry, type Logger } from './http.js';
import { analyzeRoute, ANALYZE_BODY_LIMIT } from './routes/analyze.js';
import { analyzeLabelsRoute, ANALYZE_LABELS_BODY_LIMIT } from './routes/analyze-labels.js';
import { retranslateRoute, RETRANSLATE_BODY_LIMIT } from './routes/retranslate.js';
import { translateRoute, TRANSLATE_BODY_LIMIT } from './routes/translate.js';
import { pageAnalyzeRoute, PAGE_ANALYZE_BODY_LIMIT } from './routes/page-analyze.js';
import { pageRetranslateRoute, PAGE_RETRANSLATE_BODY_LIMIT } from './routes/page-retranslate.js';
import { pageCachedPlanRoute, PAGE_CACHED_PLAN_BODY_LIMIT } from './routes/page-cached-plan.js';
import type { PagePlanStore } from './cache/page-plan-cache.js';
import type { RouteContext, RouteResult } from './routes/types.js';
import { handleLegacy, legacyLogRoute, type LegacyDeps } from './legacy/handler.js';
import { cryptoDigits } from './legacy/reference.js';

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  AI?: AiBinding;
  AI_MODE?: string;
  AI_MODEL?: string;
  /** 20 requests per minute per IP (design: Common Worker behaviours). */
  RATE_LIMITER_ANALYZE?: RateLimiter;
  /** 60 requests per minute per IP and route, for translate and retranslate. */
  RATE_LIMITER_TRANSLATE?: RateLimiter;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

/** Header telling the browser whether answers came from the mock (Demo mode banner). */
export const AI_MODE_HEADER = 'x-reforge-ai-mode';

interface RouteDef {
  /** HTTP method; POST when absent. A GET route receives its query string as an object. */
  method?: 'GET';
  limit: number;
  /** Which rate-limiting binding counts this route. */
  rateLimiter: 'RATE_LIMITER_ANALYZE' | 'RATE_LIMITER_TRANSLATE';
  handle: (body: unknown, ctx: RouteContext, cache?: FixtureCacheStore) => Promise<RouteResult>;
}

const ROUTES: Record<string, RouteDef> = {
  '/api/forms/analyze': { limit: ANALYZE_BODY_LIMIT, rateLimiter: 'RATE_LIMITER_ANALYZE', handle: analyzeRoute },
  '/api/forms/retranslate': { limit: RETRANSLATE_BODY_LIMIT, rateLimiter: 'RATE_LIMITER_TRANSLATE', handle: retranslateRoute },
  '/api/forms/translate': { limit: TRANSLATE_BODY_LIMIT, rateLimiter: 'RATE_LIMITER_TRANSLATE', handle: translateRoute },
  // FormBridge Document_Path (formbridge-any-document task 2.16).
  '/api/documents/analyze-labels': { limit: ANALYZE_LABELS_BODY_LIMIT, rateLimiter: 'RATE_LIMITER_ANALYZE', handle: analyzeLabelsRoute },
  // AccessForge page analysis (accessforge-skeleton task 13.7).
  '/api/pages/analyze': { limit: PAGE_ANALYZE_BODY_LIMIT, rateLimiter: 'RATE_LIMITER_ANALYZE', handle: pageAnalyzeRoute },
  // AccessForge Slice 2: language switching after analysis (tasks 25.3 and 25.4).
  '/api/pages/retranslate': { limit: PAGE_RETRANSLATE_BODY_LIMIT, rateLimiter: 'RATE_LIMITER_TRANSLATE', handle: pageRetranslateRoute },
  '/api/pages/cached-plan': { method: 'GET', limit: PAGE_CACHED_PLAN_BODY_LIMIT, rateLimiter: 'RATE_LIMITER_TRANSLATE', handle: pageCachedPlanRoute },
};

export interface HandlerDeps {
  /** Provider override (tests); otherwise chosen from env (mock unless AI_MODE=real). */
  provider?: AiProvider;
  cache?: FixtureCacheStore;
  /** Precomputed page plans override (tests). */
  pagePlans?: PagePlanStore;
  logger?: Logger;
  now?: () => number;
  requestId?: () => string;
  /** Clock and random digits for the legacy reference number (tests). */
  legacy?: LegacyDeps;
}

export function providerFor(env: Env): AiProvider {
  if (resolveAiMode(env) === 'real' && env.AI) {
    return new CfWorkersAiProvider(env.AI, env.AI_MODEL ? { model: env.AI_MODEL } : {});
  }
  return new MockAiProvider();
}

/** Client key for rate limiting: the connecting IP as Cloudflare reports it. */
function clientKey(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

export function createHandler(deps: HandlerDeps = {}) {
  const log = deps.logger ?? consoleLogger;
  const now = deps.now ?? (() => Date.now());
  const newId = deps.requestId ?? (() => crypto.randomUUID());

  async function api(request: Request, env: Env, route: string): Promise<Response> {
    const started = now();
    const requestId = newId();
    const provider = deps.provider ?? providerFor(env);
    const headers = { [AI_MODE_HEADER]: provider.kind, 'x-request-id': requestId };
    const entry: LogEntry = { requestId, route, status: 0, durationMs: 0, aiMode: provider.kind };

    let response: Response;
    try {
      const def = ROUTES[route];
      if (!def) throw new HttpError('NOT_FOUND');
      const method = def.method ?? 'POST';
      if (request.method !== method) throw new HttpError('METHOD_NOT_ALLOWED');

      const body = method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams) : await readJson(request, def.limit);

      const limiter = env[def.rateLimiter];
      if (limiter) {
        const { success } = await limiter.limit({ key: `${route}:${clientKey(request)}` });
        if (!success) throw new HttpError('RATE_LIMITED');
      }

      const result = await def.handle(body, { provider, requestId, ...(deps.pagePlans ? { pagePlans: deps.pagePlans } : {}) }, deps.cache);
      response = result.response;
      for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);

      const usage = result.meta?.usage.at(-1);
      if (result.meta) entry.attempts = result.meta.attempts;
      if (usage) {
        entry.model = usage.model;
        if (usage.promptTokens !== undefined) entry.promptTokens = usage.promptTokens;
        if (usage.completionTokens !== undefined) entry.completionTokens = usage.completionTokens;
        if (usage.neurons !== undefined) entry.neurons = usage.neurons;
      }
      if (result.servedFromCache) entry.servedFromCache = true;
      if (result.fallbackCode) entry.errorCode = result.fallbackCode;
    } catch (err) {
      const httpErr = err instanceof HttpError ? err : new HttpError('INTERNAL_ERROR');
      response = errorResponse(httpErr.code, httpErr.detail, {
        ...headers,
        ...(httpErr.code === 'METHOD_NOT_ALLOWED' ? { allow: ROUTES[route]?.method ?? 'POST' } : {}),
      });
      entry.errorCode = httpErr.code;
    }

    entry.status = response.status;
    entry.durationMs = now() - started;
    log(entry);
    return response;
  }

  /** The fictional legacy portal (accessforge-skeleton task 5.11). Logs route and status only. */
  async function legacy(request: Request, pathname: string): Promise<Response> {
    const started = now();
    const requestId = newId();
    const response = await handleLegacy(request, deps.legacy ?? { now: () => new Date(now()), randomDigits: cryptoDigits });
    const entry: LogEntry = { requestId, route: legacyLogRoute(pathname), status: response.status, durationMs: now() - started };
    if (response.status >= 400 && response.headers.get('content-type')?.startsWith('application/json')) {
      // The shared error shape: log its fixed code, never the body that caused it.
      entry.errorCode = ((await response.clone().json()) as { error: { code: string } }).error.code;
    }
    log(entry);
    return response;
  }

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return api(request, env, url.pathname);
      if (url.pathname === '/legacy' || url.pathname.startsWith('/legacy/')) return legacy(request, url.pathname);
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return errorResponse('NOT_FOUND');
    },
  };
}

export default createHandler();
