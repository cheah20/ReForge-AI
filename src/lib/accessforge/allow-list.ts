/**
 * src/lib/accessforge/allow-list.ts
 *
 * accessforge-skeleton task 7.2 (design Question 1). The only four legacy
 * transitions the Revival_Frame may show, and two checks the browser runs.
 *
 * Defence in depth: the guarantee that the frame requests only these paths
 * comes earlier, from the generated templates, the CSP and the sandbox, which
 * act before any request. `checkFrameDocument` runs after a document has
 * loaded and catches anything that slipped through. `checkFormTarget` runs
 * before the first Action and again right before the submit click.
 */

export type PageType = 'home' | 'register' | 'confirmation' | 'error';

export const ALLOW_LIST = [
  { method: 'GET', path: '/legacy/', pageType: 'home' },
  { method: 'GET', path: '/legacy/register', pageType: 'register' },
  { method: 'POST', path: '/legacy/register', pageType: 'confirmation' },
  { method: 'POST', path: '/legacy/register', pageType: 'error' },
] as const;

export type AllowListEntry = (typeof ALLOW_LIST)[number];

/** The GET paths a legacy link may point to. */
export const ALLOW_LIST_GET_PATHS: readonly string[] = [...new Set(ALLOW_LIST.filter((e) => e.method === 'GET').map((e) => e.path))];

/** Where the one legacy form posts. */
export const LEGACY_FORM_ACTION = '/legacy/register';

export type FrameCheck =
  | { ok: true; entry: AllowListEntry; pageVersion: string | null }
  | { ok: false; reason: 'ORIGIN' | 'PATH' | 'QUERY' | 'PAGE_TYPE' | 'UNREADABLE' };

function metaContent(doc: Document, name: string): string | null {
  const el = doc.querySelector(`meta[name="${name}"]`);
  return el ? el.getAttribute('content') : null;
}

/** The four steps of design Question 1, on the frame's loaded document. */
export function checkFrameDocument(frame: HTMLIFrameElement, appOrigin: string): FrameCheck {
  let location: Location;
  let doc: Document;
  try {
    const win = frame.contentWindow;
    if (!win || !frame.contentDocument) return { ok: false, reason: 'UNREADABLE' };
    location = win.location;
    doc = frame.contentDocument;
    // Reading a property of a cross-origin location throws.
    void location.pathname;
  } catch {
    return { ok: false, reason: 'UNREADABLE' };
  }
  if (location.origin !== appOrigin) return { ok: false, reason: 'ORIGIN' };
  if (location.search !== '' || location.hash !== '') return { ok: false, reason: 'QUERY' };
  if (!ALLOW_LIST.some((e) => e.path === location.pathname)) return { ok: false, reason: 'PATH' };
  const pageType = metaContent(doc, 'portal-page');
  const entry = ALLOW_LIST.find((e) => e.path === location.pathname && e.pageType === pageType);
  if (!entry) return { ok: false, reason: 'PAGE_TYPE' };
  return { ok: true, entry, pageVersion: metaContent(doc, 'portal-page-version') };
}

/**
 * Requirement 4.4: the form posts to /legacy/register on the app's own origin
 * with method POST, and no submit button can change either.
 */
export function checkFormTarget(doc: Document, appOrigin: string): { ok: true } | { ok: false } {
  const forms = doc.querySelectorAll('form');
  if (forms.length !== 1) return { ok: false };
  const form = forms[0]!;
  const action = form.getAttribute('action');
  if (action === null) return { ok: false };
  let target: URL;
  try {
    target = new URL(action, doc.URL);
  } catch {
    return { ok: false };
  }
  if (target.origin !== appOrigin || target.pathname !== LEGACY_FORM_ACTION || target.search !== '' || target.hash !== '') return { ok: false };
  if ((form.getAttribute('method') ?? '').toLowerCase() !== 'post') return { ok: false };
  const submitters = doc.querySelectorAll('input[type="submit" i], button');
  for (const s of submitters) {
    if (s.hasAttribute('formaction') || s.hasAttribute('formmethod') || s.hasAttribute('formtarget')) return { ok: false };
  }
  return { ok: true };
}
