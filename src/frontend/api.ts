/**
 * src/frontend/api.ts
 *
 * Browser client for the three Worker routes. Every reply is checked with the
 * shared zod schema before the app uses it. Errors keep only the error code
 * from the shared error shape, so the UI shows its own localized message.
 *
 * Privacy: `analyze` and `retranslate` carry field evidence and AI-written
 * wording only. `translate` is the one call that carries a user answer, and the
 * session state calls it only when the user presses the translate button.
 */

import type { z } from 'zod';
import {
  AnalyzeResponseSchema,
  ApiErrorSchema,
  RetranslateResponseSchema,
  TranslateResponseSchema,
} from '../shared/schemas.js';
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  RetranslateRequest,
  RetranslateResponse,
  TranslateRequest,
  TranslateResponse,
} from '../shared/types.js';
import {
  PageAnalyzeResponseSchema,
  PageRetranslateResponseSchema,
  type PageAnalyzeRequest,
  type PageAnalyzeResponse,
  type PageRetranslateRequest,
  type PageRetranslateResponse,
} from '../shared/page-schemas.js';

/** Same header name as the Worker's AI_MODE_HEADER (kept here so the browser bundle does not import Worker code). */
export const AI_MODE_HEADER = 'x-reforge-ai-mode';

/** Codes the Worker sends, plus the two the browser adds itself. */
export type ApiErrorCode = string | 'NETWORK_ERROR' | 'INVALID_RESPONSE';

export class ApiRequestError extends Error {
  constructor(readonly code: ApiErrorCode) {
    super(code);
    this.name = 'ApiRequestError';
  }
}

export interface ApiReply<T> {
  data: T;
  /** 'mock' when the Worker answered with the mock provider (Demo mode banner). */
  aiMode: string | null;
}

export interface ApiClient {
  analyze(request: AnalyzeRequest): Promise<ApiReply<AnalyzeResponse>>;
  retranslate(request: RetranslateRequest): Promise<ApiReply<RetranslateResponse>>;
  translate(request: TranslateRequest): Promise<ApiReply<TranslateResponse>>;
}

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

async function post<S extends z.ZodType>(fetchFn: FetchFn, path: string, body: unknown, schema: S): Promise<ApiReply<z.infer<S>>> {
  return send(fetchFn, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, schema);
}
async function send<S extends z.ZodType>(fetchFn: FetchFn, path: string, init: RequestInit, schema: S): Promise<ApiReply<z.infer<S>>> {
  let response: Response;
  try {
    response = await fetchFn(path, init);
  } catch {
    throw new ApiRequestError('NETWORK_ERROR');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiRequestError(response.ok ? 'INVALID_RESPONSE' : 'NETWORK_ERROR');
  }

  if (!response.ok) {
    const err = ApiErrorSchema.safeParse(payload);
    throw new ApiRequestError(err.success ? err.data.error.code : 'INVALID_RESPONSE');
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new ApiRequestError('INVALID_RESPONSE');
  return { data: parsed.data, aiMode: response.headers.get(AI_MODE_HEADER) };
}

export function createApiClient(fetchFn: FetchFn = (input, init) => fetch(input, init)): ApiClient {
  return {
    analyze: (request) => post(fetchFn, '/api/forms/analyze', request, AnalyzeResponseSchema),
    retranslate: (request) => post(fetchFn, '/api/forms/retranslate', request, RetranslateResponseSchema),
    translate: (request) => post(fetchFn, '/api/forms/translate', request, TranslateResponseSchema),
  };
}

// ---------------------------------------------------------------------------
// AccessForge page analysis (accessforge-skeleton task 16.1)
// ---------------------------------------------------------------------------

/** The browser gives up on a page analysis after 45 s (Requirement 6.15). */
export const PAGE_ANALYZE_TIMEOUT_MS = 45_000;

export interface AnalyzePageOptions {
  /** The AbortController signal of the current Revival_Generation. */
  signal?: AbortSignal;
  fetchFn?: FetchFn;
  timeoutMs?: number;
}

/**
 * POST /api/pages/analyze. Carries the Page_Model (structure and page text,
 * never an answer) and the interface language. Aborts after 45 s or when the
 * generation's signal aborts; a timeout throws `TIMEOUT`, an abort `ABORTED`.
 */
export async function analyzePage(request: PageAnalyzeRequest, options: AnalyzePageOptions = {}): Promise<ApiReply<PageAnalyzeResponse>> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? PAGE_ANALYZE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', onAbort);
  const base = options.fetchFn ?? ((input: string, init: RequestInit) => fetch(input, init));
  try {
    return await post((input, init) => base(input, { ...init, signal: controller.signal }), '/api/pages/analyze', request, PageAnalyzeResponseSchema);
  } catch (err) {
    if (controller.signal.aborted) throw new ApiRequestError(timedOut ? 'TIMEOUT' : 'ABORTED');
    throw err;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

// ---------------------------------------------------------------------------
// AccessForge language switching (accessforge-skeleton task 25.5)
// ---------------------------------------------------------------------------
/** The browser gives up on a re-translation after 45 s; the previous wording stays (Requirement 7.9). */
export const PAGE_RETRANSLATE_TIMEOUT_MS = 45_000;

async function withTimeout<T>(options: AnalyzePageOptions, run: (fetchFn: FetchFn) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? PAGE_RETRANSLATE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', onAbort);
  const base = options.fetchFn ?? ((input: string, init: RequestInit) => fetch(input, init));
  try {
    return await run((input, init) => base(input, { ...init, signal: controller.signal }));
  } catch (err) {
    if (controller.signal.aborted) throw new ApiRequestError(timedOut ? 'TIMEOUT' : 'ABORTED');
    throw err;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/** POST /api/pages/retranslate. The body holds the existing wording and the new language only. */
export function retranslatePage(request: PageRetranslateRequest, options: AnalyzePageOptions = {}): Promise<ApiReply<PageRetranslateResponse>> {
  return withTimeout(options, (fetchFn) => post(fetchFn, '/api/pages/retranslate', request, PageRetranslateResponseSchema));
}

/** GET /api/pages/cached-plan: the saved plan for this Page_Version and language, or a `NOT_FOUND` error. */
export function fetchCachedPlan(version: string, lang: string, options: AnalyzePageOptions = {}): Promise<ApiReply<PageAnalyzeResponse>> {
  const query = new URLSearchParams({ version, lang }).toString();
  return withTimeout(options, (fetchFn) => send(fetchFn, `/api/pages/cached-plan?${query}`, { method: 'GET' }, PageAnalyzeResponseSchema));
}