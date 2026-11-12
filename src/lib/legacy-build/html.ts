/**
 * src/lib/legacy-build/html.ts
 *
 * Tree builder, sanitiser, serialiser and unsafe-construct scanner for the
 * legacy portal templates (accessforge-skeleton task 3.1, design Question 6).
 * Build and test only: never imported by src/worker/. No DOM dependency.
 *
 * - h() accepts only allow-listed tags.
 * - sanitizeTree() removes every element outside the allow-list together with
 *   its whole subtree, every attribute outside the allow-list, and URL
 *   attributes whose value is not an allowed target.
 * - serialize() escapes & < > " ' in text and attribute values, always quotes
 *   attributes, and turns each slot into a split point.
 * - findUnsafeConstructs() scans tag text only (<...>), never text between
 *   tags, so an escaped "javascript:" shown as text is not a finding.
 */

import { ALLOW_LIST_GET_PATHS, LEGACY_FORM_ACTION } from '../accessforge/allow-list.js';
import { SAMPLE_FORM_PATH } from '../../shared/app-paths.js';

export const ALLOWED_TAGS = [
  'html', 'head', 'meta', 'title', 'link', 'body', 'table', 'tbody', 'tr', 'td', 'th', 'div', 'span', 'p', 'b', 'small',
  'ul', 'li', 'a', 'form', 'input', 'select', 'option', 'label', 'br', 'hr', 'h1', 'h2',
] as const;
export type AllowedTag = (typeof ALLOWED_TAGS)[number];

/** Slots filled per request. `name` and `value` exist only in row templates. */
export type SlotName = 'reference' | 'summaryRows' | 'failingNames' | 'name' | 'value';

/** `tag` is a plain string so test-only hostile trees can hold any element; h() restricts it. */
export type Node = { tag: string; attrs: Record<string, string>; children: Node[] } | { text: string } | { slot: SlotName };

const GLOBAL_ATTRS = ['class', 'id', 'lang', 'colspan', 'width', 'scope', 'data-name', 'data-value'];
const TAG_ATTRS: Partial<Record<AllowedTag, string[]>> = {
  meta: ['charset', 'name', 'content'],
  link: ['rel', 'href'],
  a: ['href'],
  form: ['action', 'method', 'accept-charset'],
  input: ['type', 'name', 'value', 'maxlength', 'required'],
  select: ['name', 'required'],
  option: ['value'],
};
const INPUT_TYPES = ['text', 'radio', 'checkbox', 'submit', 'reset'];
const VOID = new Set(['meta', 'link', 'input', 'br', 'hr']);

const isAllowedTag = (tag: string): tag is AllowedTag => (ALLOWED_TAGS as readonly string[]).includes(tag);

export function h(tag: AllowedTag, attrs: Record<string, string> = {}, ...children: Array<Node | string>): Node {
  if (!isAllowedTag(tag)) throw new Error(`h(): "${String(tag)}" is not an allowed tag`);
  return { tag, attrs: { ...attrs }, children: children.map((c) => (typeof c === 'string' ? { text: c } : c)) };
}

export const text = (value: string): Node => ({ text: value });
export const slot = (name: SlotName): Node => ({ slot: name });

/** True when a URL attribute value is an allowed target for that tag. */
function allowedUrl(tag: AllowedTag, attr: string, value: string): boolean {
  if (tag === 'a' && attr === 'href') return ALLOW_LIST_GET_PATHS.includes(value) || value === SAMPLE_FORM_PATH;
  if (tag === 'link' && attr === 'href') return /^\/legacy-assets\/[A-Za-z0-9._-]+$/.test(value);
  if (tag === 'form' && attr === 'action') return value === LEGACY_FORM_ACTION;
  return true;
}

export function sanitizeTree(node: Node): Node {
  return sanitizeNode(node) ?? { text: '' };
}

function sanitizeNode(node: Node): Node | null {
  if ('text' in node || 'slot' in node) return node;
  if (!isAllowedTag(node.tag)) return null; // the whole subtree goes
  const tag = node.tag;
  if (tag === 'input' && !INPUT_TYPES.includes((node.attrs['type'] ?? 'text').toLowerCase())) return null;
  const allowed = new Set([...GLOBAL_ATTRS, ...(TAG_ATTRS[tag] ?? [])]);
  const attrs: Record<string, string> = {};
  for (const [name, value] of Object.entries(node.attrs)) {
    const key = name.toLowerCase();
    if (!allowed.has(key)) continue;
    if (!allowedUrl(tag, key, value)) continue;
    // Requirement 4.1 forbids these in any attribute, not only in URL attributes.
    if (unsafeValue(value)) continue;
    if (tag === 'link' && key === 'rel' && value !== 'stylesheet') continue;
    attrs[key] = value;
  }
  // A link without its allowed stylesheet href has no purpose: drop it.
  if (tag === 'link' && (attrs['rel'] !== 'stylesheet' || attrs['href'] === undefined)) return null;
  // A meta is either charset or name/content. One that had only http-equiv (now removed)
  // would keep its content (for a refresh, a URL), so it goes entirely.
  if (tag === 'meta' && attrs['charset'] === undefined && attrs['name'] === undefined) return null;
  // Void elements have no content; anything nested in one never renders, so it goes too.
  const children = VOID.has(tag) ? [] : node.children.map(sanitizeNode).filter((c): c is Node => c !== null);
  return { tag, attrs, children };
}

export function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface SerializedParts {
  /** segments.length === slots.length + 1 */
  segments: string[];
  slots: SlotName[];
}

/** Serialise to segments split at every slot. */
export function serializeParts(node: Node): SerializedParts {
  const segments: string[] = [''];
  const slots: SlotName[] = [];
  const out = (s: string) => {
    segments[segments.length - 1] += s;
  };
  const walk = (n: Node) => {
    if ('text' in n) return out(escapeHtmlText(n.text));
    if ('slot' in n) {
      slots.push(n.slot);
      segments.push('');
      return;
    }
    if (n.tag === 'html') out('<!doctype html>\n');
    const attrs = Object.entries(n.attrs)
      .map(([k, v]) => ` ${k}="${escapeHtmlText(v)}"`)
      .join('');
    out(`<${n.tag}${attrs}>`);
    if (VOID.has(n.tag)) return;
    n.children.forEach(walk);
    out(`</${n.tag}>`);
  };
  walk(node);
  return { segments, slots };
}

/** The whole document with every slot left empty. */
export function serialize(node: Node): string {
  return serializeParts(node).segments.join('');
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*\/?>/g;
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
const FORBIDDEN_ELEMENTS = new Set(['script', 'noscript', 'iframe', 'frame', 'object', 'embed', 'base']);
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction']);

/** Decode the entities a browser would decode inside an attribute value. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&colon;/gi, ':')
    .replace(/&amp;/g, '&');
}

/** What a browser would act on: lower case, control characters and white space removed. */
const normalise = (value: string) => decodeEntities(value).toLowerCase().replace(/[\u0000-\u0020\u007f]/g, '');

/** An attribute value the scanner reports whatever attribute it is in. */
function unsafeValue(raw: string): boolean {
  const value = normalise(raw);
  return value.includes('javascript:') || value.startsWith('data:') || value.includes('url=data:') || value.includes('url(') || value.includes('@import');
}

/** Names of the unsafe constructs found in tag text, [] when clean. */
export function findUnsafeConstructs(html: string): string[] {
  const found: string[] = [];
  for (const tagMatch of html.matchAll(TAG_RE)) {
    if (tagMatch[0].startsWith('</')) continue;
    const tag = tagMatch[1]!.toLowerCase();
    if (FORBIDDEN_ELEMENTS.has(tag)) found.push(`${tag} element`);
    const attrs: Array<[string, string]> = [];
    for (const a of (tagMatch[2] ?? '').matchAll(ATTR_RE)) attrs.push([a[1]!.toLowerCase(), a[2] ?? a[3] ?? a[4] ?? '']);
    for (const [name, raw] of attrs) {
      const value = normalise(raw);
      if (name.startsWith('on')) found.push(`inline handler ${name} on ${tag}`);
      if (name === 'srcdoc') found.push(`srcdoc attribute on ${tag}`);
      if (name === 'formaction' || name === 'formmethod' || name === 'formtarget') found.push(`${name} attribute on ${tag}`);
      if (tag === 'meta' && name === 'http-equiv' && value === 'refresh') found.push('meta refresh');
      if (value.includes('javascript:')) found.push(`javascript: URL in ${name} on ${tag}`);
      if (value.startsWith('data:') || value.includes('url=data:')) found.push(`data: URL in ${name} on ${tag}`);
      if (URL_ATTRS.has(name) && (/^[a-z][a-z0-9+.-]*:/.test(value) || value.startsWith('//') || value.startsWith('\\\\') || value.startsWith('/\\')))
        found.push(`external URL in ${name} on ${tag}`);
      if (value.includes('url(') || value.includes('@import')) found.push(`CSS url( or @import in ${name} on ${tag}`);
    }
  }
  return found;
}
