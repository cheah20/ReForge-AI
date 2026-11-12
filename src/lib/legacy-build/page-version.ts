/**
 * src/lib/legacy-build/page-version.ts
 *
 * accessforge-skeleton task 4.4 (design Question 1): the Page_Version of a GET
 * template is the SHA-256 (lowercase hex) of its UTF-8 bytes with the
 * portal-page-version meta content set to the empty string. Computed once at
 * build time; the Worker never hashes per request.
 */

const VERSION_META = /(<meta name="portal-page-version" content=")[^"]*(">)/;

/** The HTML with the version stamp emptied, the form the hash is taken over. */
export function withEmptyVersion(html: string): string {
  return html.replace(VERSION_META, '$1$2');
}

export function stampVersion(html: string, version: string): string {
  if (!VERSION_META.test(html)) throw new Error('no portal-page-version meta to stamp');
  return html.replace(VERSION_META, `$1${version}$2`);
}

export async function computePageVersion(html: string): Promise<string> {
  const bytes = new TextEncoder().encode(withEmptyVersion(html));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
