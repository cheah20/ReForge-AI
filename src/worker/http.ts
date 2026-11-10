/**
 * src/worker/http.ts
 *
 * Small HTTP helpers shared by the API routes.
 * - One error shape: { "error": { "code": "...", "message": "..." } }
 * - Bodies are read with a byte limit before any JSON parsing.
 * - Logs carry operational metadata only (request id, route, status, timing,
 *   error code, model, token counts). Never bodies, prompts, replies or answers.
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'INVALID_JSON'
  | 'UNSUPPORTED_LANGUAGE'
  | 'PAYLOAD_TOO_LARGE'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'AI_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'INTERNAL_ERROR';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  INVALID_JSON: 400,
  UNSUPPORTED_LANGUAGE: 400,
  PAYLOAD_TOO_LARGE: 413,
  METHOD_NOT_ALLOWED: 405,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  AI_TIMEOUT: 504,
  INTERNAL_ERROR: 500,
};

/** Plain English messages; the browser shows its own localized text by code. */
const MESSAGES: Record<ErrorCode, string> = {
  BAD_REQUEST: 'The request did not match the expected format.',
  INVALID_JSON: 'The request body is not valid JSON.',
  UNSUPPORTED_LANGUAGE: 'This language is not supported.',
  PAYLOAD_TOO_LARGE: 'The request is too large.',
  METHOD_NOT_ALLOWED: 'Use POST for this endpoint.',
  NOT_FOUND: 'There is no API endpoint at this address.',
  RATE_LIMITED: 'Too many requests. Wait a minute and try again.',
  AI_UNAVAILABLE: 'The AI service is not available right now. Try again later.',
  AI_TIMEOUT: 'The AI service took too long to answer. Try again.',
  INTERNAL_ERROR: 'Something went wrong on the server. Try again.',
};

export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail?: string,
  ) {
    super(code);
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

/**
 * Error response. `detail` is a safe, content-free hint (for example which
 * schema path failed); it never contains submitted values.
 */
export function errorResponse(code: ErrorCode, detail?: string, headers: Record<string, string> = {}): Response {
  const message = detail ? `${MESSAGES[code]} ${detail}` : MESSAGES[code];
  return json({ error: { code, message: message.slice(0, 500) } }, STATUS[code], headers);
}

/** Read the body as UTF-8 text, failing with PAYLOAD_TOO_LARGE past `limit` bytes. */
export async function readBody(request: Request, limit: number): Promise<string> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new HttpError('PAYLOAD_TOO_LARGE');
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new HttpError('PAYLOAD_TOO_LARGE');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

export async function readJson(request: Request, limit: number): Promise<unknown> {
  const text = await readBody(request, limit);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError('INVALID_JSON');
  }
}

/** A schema failure described by paths only, never by values. */
export function schemaDetail(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>): string {
  const paths = [...new Set(issues.map((i) => i.path.map(String).join('.') || '(root)'))].slice(0, 5);
  return `Check: ${paths.join(', ')}.`;
}

export interface LogEntry {
  requestId: string;
  route: string;
  status: number;
  durationMs: number;
  errorCode?: string;
  aiMode?: string;
  model?: string;
  attempts?: number;
  promptTokens?: number;
  completionTokens?: number;
  neurons?: number;
  servedFromCache?: boolean;
}

export type Logger = (entry: LogEntry) => void;

export const consoleLogger: Logger = (entry) => console.log(JSON.stringify(entry));
