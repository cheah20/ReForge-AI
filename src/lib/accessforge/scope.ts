/**
 * src/lib/accessforge/scope.ts
 *
 * accessforge-skeleton task 16.2 (Requirements 18.1, 18.2). AccessForge
 * revives only the demonstration portal. The frame source is the constant
 * `/legacy/register`; nothing from the address bar can change it. This
 * helper only tells the screen whether the address names another site, so
 * it can say that nothing was loaded from it. Pure, no I/O.
 */

export const REVIVAL_FRAME_SRC = '/legacy/register';

/** Decodes up to three layers of percent-encoding, stopping at the first value that does not decode. */
function decodings(value: string): string[] {
  const out = [value];
  let v = value;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(v);
    } catch (e) {
      if (e instanceof URIError) break;
      throw e;
    }
    if (next === v) break;
    out.push(next);
    v = next;
  }
  return out;
}

/** A scheme (`https:`, `javascript:`), a protocol-relative or UNC start, `www.`, or a dotted host name. */
function looksLikeAddress(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === '') return false;
  if (/^[a-z][a-z0-9+.-]*:/.test(v)) return true;
  if (/^[\\/]{2}/.test(v)) return true;
  if (/(^|[^a-z0-9])www\./.test(v)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]|$)/.test(v);
}

/**
 * True when any query parameter (name or value), the hash, or a path segment
 * after the AccessForge route names an address other than the portal.
 */
export function namesForeignAddress(url: URL, routePrefix: string): boolean {
  const parts: string[] = [];
  for (const [k, v] of url.searchParams) parts.push(k, v);
  if (url.hash.length > 1) parts.push(url.hash.slice(1));
  if (url.pathname.startsWith(routePrefix)) {
    parts.push(...url.pathname.slice(routePrefix.length).split('/').filter(Boolean));
  }
  // The raw query as well, so "?https://evil.example" without a key is caught.
  if (url.search.length > 1) parts.push(url.search.slice(1));
  return parts.some((p) => decodings(p).some(looksLikeAddress));
}
