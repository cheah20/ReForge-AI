/**
 * src/worker/legacy/handler.ts
 *
 * accessforge-skeleton task 5.5 (design "Request dispatch"). Serves the legacy
 * portal from the generated templates and handles the one form post.
 * - GET /legacy/ and GET /legacy/register: the templates unchanged.
 * - POST /legacy/register: URL-encoded body up to 16,384 bytes, parsed and
 *   validated; confirmation (200) or error page (422).
 * - Other methods on /legacy/register: METHOD_NOT_ALLOWED. Other GET paths:
 *   the not-found document (404).
 * Submitted values are escaped and rendered once; never logged, never put in
 * a header, URL or redirect, never stored. No sanitiser and no hash run here.
 */

import { escapeHtml } from './escape.js';
import { ROW_TEMPLATES, TEMPLATES } from './generated/templates.js';
import { fill } from './render.js';
import { newReferenceNumber } from './reference.js';
import { legacyError, legacyResponse } from './respond.js';
import { orderedEntries, parseSubmission, validateSubmission } from './submission.js';

export const LEGACY_BODY_LIMIT = 16_384;

export interface LegacyDeps {
  now(): Date;
  randomDigits(): string;
}

/** The route name for logs: the two documented routes, or "/legacy/" for every other legacy path. */
export function legacyLogRoute(pathname: string): '/legacy/' | '/legacy/register' {
  return pathname === '/legacy/register' ? '/legacy/register' : '/legacy/';
}

async function readLimited(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > LEGACY_BODY_LIMIT) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > LEGACY_BODY_LIMIT) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

async function handlePost(request: Request, deps: LegacyDeps): Promise<Response> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return legacyError('BAD_REQUEST', 'The form body must be URL-encoded.', 400);
  const body = await readLimited(request);
  if (body === null) return legacyError('PAYLOAD_TOO_LARGE', 'The request is too large.', 413);

  const submission = parseSubmission(body);
  const outcome = validateSubmission(submission);
  if (!outcome.ok) {
    const rows = outcome.failing.map((name) => fill(ROW_TEMPLATES.failingName, { name: escapeHtml(name) }));
    if (outcome.unknownPresent) rows.push(fill(ROW_TEMPLATES.unknownField));
    return legacyResponse(fill(TEMPLATES.error, { failingNames: rows.join('') }), 422);
  }
  const summaryRows = orderedEntries(submission)
    .map(({ name, value }) => fill(ROW_TEMPLATES.summaryRow, { name: escapeHtml(name), value: escapeHtml(value) }))
    .join('');
  const reference = newReferenceNumber(deps.now(), deps.randomDigits);
  return legacyResponse(fill(TEMPLATES.confirmation, { summaryRows, reference: escapeHtml(reference) }), 200);
}

export async function handleLegacy(request: Request, deps: LegacyDeps): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/legacy/register') {
    if (request.method === 'GET' || request.method === 'HEAD') return legacyResponse(TEMPLATES.register.segments.join(''));
    if (request.method === 'POST') return handlePost(request, deps);
    return legacyError('METHOD_NOT_ALLOWED', 'Use GET or POST for this page.', 405, { allow: 'GET, POST' });
  }
  if (pathname === '/legacy/' && (request.method === 'GET' || request.method === 'HEAD')) return legacyResponse(TEMPLATES.home.segments.join(''));
  if (request.method !== 'GET' && request.method !== 'HEAD') return legacyError('METHOD_NOT_ALLOWED', 'Use GET for this page.', 405, { allow: 'GET' });
  return legacyResponse(TEMPLATES.notFound.segments.join(''), 404);
}
