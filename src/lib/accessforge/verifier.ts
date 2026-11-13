/**
 * src/lib/accessforge/verifier.ts
 *
 * accessforge-skeleton task 11.4 (design "Verifier" and Question 8,
 * Requirements 10.1, 10.3, 10.10 to 10.12, 11.7). Reads written fields back
 * from the frame, compares by exact equality, and checks the legacy
 * confirmation against what the Mirror wrote.
 *
 * `readBack` also takes the iframe's live document, for the same
 * document-identity check as the Executor.
 */

import type { PageEntry, PageModel } from '../../shared/page-schemas.js';
import { parseElementId } from './element-id.js';
import type { FrameHandle } from './generation.js';
import { locate, type CheckControl, type SelectControl, type ValueControl } from './locate.js';

export type ReadBack = { kind: 'text' | 'select' | 'radio'; value: string | null } | { kind: 'checkbox'; checked: boolean };
export type ReadBackResult = ReadBack | 'NOT_FOUND' | 'AMBIGUOUS' | 'STALE_GENERATION';

/** Requirement 10.1: character-for-character, no trimming, case folding or normalization. */
export function sameValue(intended: string, read: string): boolean {
  return intended === read;
}

export function readBack(frame: FrameHandle, generation: number, entry: PageEntry, liveDocument: Document | null): ReadBackResult {
  if (generation !== frame.generation || frame.document === null || frame.document !== liveDocument) return 'STALE_GENERATION';
  const key = parseElementId(entry.elementId);
  if (!key) return 'NOT_FOUND';
  const found = locate(frame.document, key);
  if (found.length === 0) return 'NOT_FOUND';

  if (entry.control === 'radio') {
    const values = found.map((el) => el.getAttribute('value') ?? 'on');
    if (new Set(values).size !== values.length) return 'AMBIGUOUS';
    const checked = found.filter((el) => (el as unknown as CheckControl).checked);
    return { kind: 'radio', value: checked.length === 1 ? (checked[0]!.getAttribute('value') ?? 'on') : null };
  }
  if (found.length > 1) return 'AMBIGUOUS';
  const el = found[0]!;
  switch (entry.control) {
    case 'text':
      return { kind: 'text', value: (el as unknown as ValueControl).value };
    case 'select': {
      const s = el as unknown as SelectControl;
      return { kind: 'select', value: s.selectedIndex < 0 ? null : s.value };
    }
    case 'checkbox':
      return { kind: 'checkbox', checked: (el as unknown as CheckControl).checked };
    default:
      return 'NOT_FOUND';
  }
}

export interface ConfirmationRead {
  /** textContent of #rujukan, exact. */
  reference: string | null;
  /** textContent of #mesej-pengesahan. */
  originalText: string | null;
  /** Rows of #ringkasan-diterima in order. */
  entries: Array<{ name: string; value: string }>;
}

/** Null when the document has no received-fields summary. */
export function parseConfirmation(doc: Document): ConfirmationRead | null {
  const table = doc.getElementById('ringkasan-diterima');
  if (!table) return null;
  const entries: Array<{ name: string; value: string }> = [];
  for (const row of Array.from(table.getElementsByTagName('tr'))) {
    const th = Array.from(row.getElementsByTagName('th')).find((c) => c.hasAttribute('data-name'));
    const td = Array.from(row.getElementsByTagName('td')).find((c) => c.hasAttribute('data-value'));
    if (!th || !td) continue;
    entries.push({ name: th.getAttribute('data-name')!, value: td.textContent ?? '' });
  }
  return {
    reference: doc.getElementById('rujukan')?.textContent ?? null,
    originalText: doc.getElementById('mesej-pengesahan')?.textContent ?? null,
    entries,
  };
}

/** A field with status `filled`: written, and its latest read-back equals the Intended_Value. */
export interface FilledField {
  entry: PageEntry;
  intended: string | boolean;
}

export type Difference =
  | { kind: 'value'; name: string; intended: string; received: string }
  | { kind: 'missing'; name: string }
  | { kind: 'repeated'; name: string }
  | { kind: 'unknownName'; name: string }
  | { kind: 'reference'; reference: string | null };

const REFERENCE = /^SR-DEMO-\d{8}-\d{6}$/;

/** True when the reference matches `SR-DEMO-YYYYMMDD-NNNNNN` (Requirement 10.11). */
export function isValidReference(reference: string | null): reference is string {
  return reference !== null && REFERENCE.test(reference);
}

/** The value the handler receives for a filled field; null when the browser sends nothing (an unticked box). */
function expectedValue(f: FilledField): string | null {
  if (f.entry.control === 'checkbox') return f.intended === true ? (f.entry.checkboxValue ?? 'on') : null;
  return String(f.intended);
}

export function compareReceived(read: ConfirmationRead, filled: readonly FilledField[], model: PageModel): Difference[] {
  const diffs: Difference[] = [];
  const known = new Set(model.entries.filter((e) => e.control !== 'submit' && e.control !== 'reset').map((e) => e.name));
  const seen = new Map<string, string>();
  for (const { name, value } of read.entries) {
    if (!known.has(name)) diffs.push({ kind: 'unknownName', name });
    else if (seen.has(name)) diffs.push({ kind: 'repeated', name });
    else seen.set(name, value);
  }
  for (const f of filled) {
    const want = expectedValue(f);
    const got = seen.get(f.entry.name);
    if (want === null) {
      if (got !== undefined) diffs.push({ kind: 'value', name: f.entry.name, intended: '', received: got });
    } else if (got === undefined) {
      diffs.push({ kind: 'missing', name: f.entry.name });
    } else if (!sameValue(want, got)) {
      diffs.push({ kind: 'value', name: f.entry.name, intended: want, received: got });
    }
  }
  if (!isValidReference(read.reference)) diffs.push({ kind: 'reference', reference: read.reference });
  return diffs;
}
