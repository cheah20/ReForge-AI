/**
 * src/lib/accessforge/extract.ts
 *
 * accessforge-skeleton task 8.1 (design "Page_Extractor" and Question 2,
 * Requirements 5.1 to 5.6, 5.10, 6.19). Builds the Page_Model of the legacy
 * registration page from the frame document.
 *
 * Privacy (Requirement 5.5): the extractor reads attributes and text nodes
 * only. It never reads `.value`, `.checked`, `.selected` or their defaults,
 * never reads the `value` attribute of a text input, the `checked` or
 * `selected` attributes, and skips `hidden` inputs entirely. Typed text lives
 * in `.value`, never in a text node, so it cannot reach the model. Textarea
 * and option text are kept out of every free-text evidence item.
 *
 * Pure DOM reading, no network (Requirement 5.1).
 *
 * Refusals beyond the design's list: a control whose `name` (or a radio or
 * select option value) is longer than the schema allows, or cannot form an
 * Element_Id, makes the whole page UNREADABLE. These strings locate controls,
 * so they are never cut short; the Mirror then says the page could not be read.
 */

import type { ControlType, PageEntry, PageModel, PageOption } from '../../shared/page-schemas.js';
import { ElementIdEncodingError, elementIdFor, radioOptionIdFor } from './element-id.js';

export type ExtractRefusal = 'UNREADABLE' | 'NO_FORM' | 'MULTIPLE_FORMS' | 'TOO_MANY_CONTROLS' | 'SUBMIT_COUNT';
export type ExtractResult = { ok: true; model: PageModel } | { ok: false; code: ExtractRefusal };

export const MAX_CONTROLS = 50;
const TEXT_LIMIT = 200;
const NAME_LIMIT = 100;
const ID_ATTR_LIMIT = 100;
const VALUE_LIMIT = 200;
const ELEMENT_ID_LIMIT = 256;
const OPTION_LIMIT = 50;
const MAXLENGTH_CAP = 524288;
const FORM_PATH = '/legacy/register' as const;

const CONTROL_TAGS = new Set(['input', 'select', 'textarea', 'button']);
/** Subtrees whose text is never page text: controls (their text is a value or a caption) and non-rendered content. */
const SKIP_TEXT_TAGS = new Set(['input', 'select', 'textarea', 'button', 'option', 'optgroup', 'datalist', 'script', 'style', 'template', 'noscript', 'head', 'title']);
/** Elements whose boundaries separate words when rendered. */
const BLOCK_TAGS = new Set(['td', 'th', 'tr', 'br', 'p', 'div', 'li', 'ul', 'ol', 'table', 'tbody', 'thead', 'tfoot', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'fieldset', 'legend']);

/** Input types the browser knows; any other or missing `type` behaves as text. */
const KNOWN_INPUT_TYPES = new Set([
  'hidden', 'text', 'search', 'tel', 'url', 'email', 'password', 'date', 'month', 'week', 'time', 'datetime-local',
  'number', 'range', 'color', 'checkbox', 'radio', 'file', 'submit', 'image', 'reset', 'button',
]);

class Unrepresentable extends Error {}

const tagOf = (el: Element) => el.localName.toLowerCase();

function inputType(el: Element): string {
  const raw = (el.getAttribute('type') ?? '').trim().toLowerCase();
  return KNOWN_INPUT_TYPES.has(raw) ? raw : 'text';
}

function isHiddenInput(el: Element): boolean {
  return tagOf(el) === 'input' && inputType(el) === 'hidden';
}

function controlTypeOf(el: Element): ControlType {
  const tag = tagOf(el);
  if (tag === 'select') return el.hasAttribute('multiple') ? 'unsupported' : 'select';
  if (tag === 'button') {
    const t = (el.getAttribute('type') ?? '').trim().toLowerCase();
    if (t === 'reset') return 'reset';
    if (t === 'button') return 'unsupported';
    return 'submit';
  }
  if (tag === 'input') {
    const t = inputType(el);
    if (t === 'text' || t === 'radio' || t === 'checkbox' || t === 'submit' || t === 'reset') return t;
    return 'unsupported';
  }
  return 'unsupported';
}

/** Controls that submit the form: counted for Requirement 6.19 whatever their entry type. */
function isSubmitter(el: Element): boolean {
  const tag = tagOf(el);
  if (tag === 'button') return controlTypeOf(el) === 'submit';
  return tag === 'input' && (inputType(el) === 'submit' || inputType(el) === 'image');
}

export function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** First `limit` UTF-16 units, never ending on half of a surrogate pair. */
function cut(s: string, limit = TEXT_LIMIT): string {
  if (s.length <= limit) return s;
  const code = s.charCodeAt(limit - 1);
  return s.slice(0, code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit);
}

/**
 * Visible text under `root` in tree order, skipping control and non-rendered
 * subtrees, `hidden` elements, and any node `exclude` returns true for.
 */
function textOf(root: Node, exclude: (n: Node) => boolean = () => false): string {
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (exclude(n)) return;
    if (n.nodeType === 3) {
      parts.push(n.nodeValue ?? '');
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const tag = tagOf(el);
    if (SKIP_TEXT_TAGS.has(tag) || el.hasAttribute('hidden')) {
      if (BLOCK_TAGS.has(tag) || CONTROL_TAGS.has(tag)) parts.push(' ');
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block) parts.push(' ');
    for (let c = el.firstChild; c; c = c.nextSibling) walk(c);
    if (block) parts.push(' ');
  };
  walk(root);
  return normalizeText(parts.join(''));
}

function closestTag(el: Element, tags: readonly string[]): Element | null {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    if (tags.includes(tagOf(cur))) return cur;
  }
  return null;
}

function cellOf(el: Element): Element | null {
  return closestTag(el, ['td', 'th']);
}

function previousCell(cell: Element): Element | null {
  for (let s = cell.previousElementSibling; s; s = s.previousElementSibling) {
    const t = tagOf(s);
    if (t === 'td' || t === 'th') return s;
  }
  return null;
}

/** The label tied by `for` (attribute compared as a string, no selector built) or by wrapping. */
function labelFor(el: Element, doc: Document): Element | null {
  const id = el.getAttribute('id');
  if (id !== null && id !== '') {
    for (const label of Array.from(doc.getElementsByTagName('label'))) {
      if (label.getAttribute('for') === id) return label;
    }
  }
  return closestTag(el, ['label']);
}

function containsControl(el: Element): boolean {
  for (const tag of CONTROL_TAGS) if (el.getElementsByTagName(tag).length > 0) return true;
  return false;
}

function within(node: Node, container: Node | null): boolean {
  return container !== null && (node === container || container.contains(node));
}

/** The text nodes after a radio and before the next control in the same cell. */
function radioOptionNodes(radio: Element): Node[] {
  const cell = cellOf(radio) ?? radio.parentElement;
  if (!cell) return [];
  const nodes: Node[] = [];
  let started = false;
  let stop = false;
  const walk = (n: Node) => {
    if (stop) return;
    if (n === radio) {
      started = true;
      return;
    }
    if (n.nodeType === 3) {
      if (started) nodes.push(n);
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    if (started && CONTROL_TAGS.has(tagOf(el)) && !isHiddenInput(el)) {
      stop = true;
      return;
    }
    if (SKIP_TEXT_TAGS.has(tagOf(el)) || el.hasAttribute('hidden')) return;
    for (let c = el.firstChild; c; c = c.nextSibling) walk(c);
  };
  walk(cell);
  return nodes;
}

function radioOptionText(radio: Element): string {
  return cut(normalizeText(radioOptionNodes(radio).map((n) => n.nodeValue ?? '').join('')));
}

function parseMaxLength(el: Element): number | null {
  const raw = el.getAttribute('maxlength');
  if (raw === null) return null;
  const m = /^[\t\n\f\r ]*([0-9]+)/.exec(raw);
  if (!m) return null;
  return Math.min(Number(m[1]), MAXLENGTH_CAP);
}

function locator(value: string, limit: number): string {
  if (value.length > limit) throw new Unrepresentable();
  return value;
}

function buildId(build: () => string): string {
  let id: string;
  try {
    id = build();
  } catch (e) {
    if (e instanceof ElementIdEncodingError) throw new Unrepresentable();
    throw e;
  }
  if (id.length > ELEMENT_ID_LIMIT) throw new Unrepresentable();
  return id;
}

interface Group {
  control: ControlType;
  name: string;
  elements: Element[];
}

function groupControls(controls: readonly Element[]): Group[] {
  const groups: Group[] = [];
  const radioGroups = new Map<string, Group>();
  for (const el of controls) {
    const control = controlTypeOf(el);
    const name = el.getAttribute('name') ?? '';
    if (control === 'radio') {
      const existing = radioGroups.get(name);
      if (existing) {
        existing.elements.push(el);
        continue;
      }
      const g: Group = { control, name, elements: [el] };
      radioGroups.set(name, g);
      groups.push(g);
      continue;
    }
    groups.push({ control, name, elements: [el] });
  }
  return groups;
}

function selectOptions(select: Element): { options: PageOption[]; hasEmptyOption: boolean } {
  const options: PageOption[] = [];
  let hasEmptyOption = false;
  for (const opt of Array.from(select.getElementsByTagName('option'))) {
    const text = cut(normalizeText(opt.textContent ?? ''));
    // An option without a value attribute submits its text (HTML "value" default).
    const value = opt.getAttribute('value') ?? normalizeText(opt.textContent ?? '');
    if (value === '') {
      hasEmptyOption = true;
      continue;
    }
    options.push({ value: locator(value, VALUE_LIMIT), text });
  }
  if (options.length > OPTION_LIMIT) throw new Unrepresentable();
  return { options, hasEmptyOption };
}

function buildEntry(group: Group, position: number, doc: Document): PageEntry {
  const first = group.elements[0]!;
  const name = locator(group.name, NAME_LIMIT);
  const elementId = buildId(() => elementIdFor({ formIndex: 0, control: group.control, name }));
  const label = labelFor(first, doc);
  const cell = cellOf(first);
  const neighbour = cell ? previousCell(cell) : null;
  const row = cell ? closestTag(cell, ['tr']) : null;

  let options: PageOption[] = [];
  let hasEmptyOption = false;
  if (group.control === 'radio') {
    options = group.elements.map((radio) => {
      const value = locator(radio.getAttribute('value') ?? 'on', VALUE_LIMIT);
      return { value, text: radioOptionText(radio), elementId: buildId(() => radioOptionIdFor(0, name, value)) };
    });
    if (options.length > OPTION_LIMIT) throw new Unrepresentable();
  } else if (group.control === 'select') {
    ({ options, hasEmptyOption } = selectOptions(first));
  }

  const optionText = new Set<Node>(group.control === 'radio' ? group.elements.flatMap(radioOptionNodes) : []);
  const nearbyText = row
    ? cut(textOf(row, (n) => within(n, neighbour) || within(n, label) || optionText.has(n)))
    : '';

  let nextRowText = '';
  if (group.control === 'checkbox' && row) {
    let next = row.nextElementSibling;
    while (next && tagOf(next) !== 'tr') next = next.nextElementSibling;
    if (next && !containsControl(next)) nextRowText = cut(textOf(next));
  }

  const entry: PageEntry = {
    elementId,
    control: group.control,
    name,
    id: cut(first.getAttribute('id') ?? '', ID_ATTR_LIMIT),
    labelText: label ? cut(textOf(label)) : '',
    neighbourText: neighbour ? cut(textOf(neighbour)) : '',
    nearbyText,
    nextRowText,
    options,
    hasEmptyOption,
    required: group.elements.some((e) => e.hasAttribute('required')),
    maxLength: group.control === 'text' ? parseMaxLength(first) : null,
    position,
    duplicateId: false,
  };
  if (group.control === 'checkbox') entry.checkboxValue = locator(first.getAttribute('value') ?? 'on', VALUE_LIMIT);
  return entry;
}

function isSecurityError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'SecurityError';
}

export function extractPageModel(doc: Document | null, pageVersion: string): ExtractResult {
  if (!doc) return { ok: false, code: 'UNREADABLE' };
  let forms: Element[];
  try {
    forms = Array.from(doc.getElementsByTagName('form'));
  } catch (e) {
    // A cross-origin document throws on access.
    if (isSecurityError(e)) return { ok: false, code: 'UNREADABLE' };
    throw e;
  }
  if (forms.length === 0) return { ok: false, code: 'NO_FORM' };
  if (forms.length > 1) return { ok: false, code: 'MULTIPLE_FORMS' };
  const form = forms[0]!;

  // Every form control counts toward the limit, hidden inputs included.
  const all = Array.from(form.querySelectorAll('input, select, textarea, button'));
  if (all.length > MAX_CONTROLS) return { ok: false, code: 'TOO_MANY_CONTROLS' };
  if (all.filter(isSubmitter).length !== 1) return { ok: false, code: 'SUBMIT_COUNT' };

  const controls = all.filter((el) => !isHiddenInput(el));
  try {
    const entries = groupControls(controls).map((g, i) => buildEntry(g, i, doc));
    return { ok: true, model: { path: FORM_PATH, pageVersion, entries } };
  } catch (e) {
    if (e instanceof Unrepresentable) return { ok: false, code: 'UNREADABLE' };
    throw e;
  }
}
