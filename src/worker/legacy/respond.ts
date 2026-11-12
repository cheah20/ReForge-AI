/**
 * src/worker/legacy/respond.ts
 *
 * accessforge-skeleton task 5.2 (design "Response headers on every /legacy/*
 * response"). The same headers on HTML documents and on the shared-error-shape
 * JSON rejections. No header ever carries a submitted value.
 */

export const LEGACY_CSP =
  "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";

export function legacyHeaders(contentType: 'html' | 'json'): Headers {
  return new Headers({
    'content-security-policy': LEGACY_CSP,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'SAMEORIGIN',
    'content-type': contentType === 'html' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
  });
}

export function legacyResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: legacyHeaders('html') });
}

/** Shared error shape, with the legacy headers. `message` is a fixed text, never a submitted value. */
export function legacyError(code: string, message: string, status: number, extra: Record<string, string> = {}): Response {
  const headers = legacyHeaders('json');
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers });
}
