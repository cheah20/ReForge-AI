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
  let response: Response;
  try {
    response = await fetchFn(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
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
