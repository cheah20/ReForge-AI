/**
 * src/worker/legacy/submission.ts
 *
 * accessforge-skeleton task 5.3. Parse a URL-encoded body (never the URL
 * query) and apply the legacy rules of Requirement 2.2 against LEGACY_FORM.
 * Lengths are counted in UTF-16 code units, as the browser counts maxlength
 * (decision I). Every failing name is returned at once; an unknown name is
 * only flagged, never named.
 */

import { LEGACY_FORM, type LegacyFieldName } from './form-spec.js';

export type Submission = { entries: Array<{ name: string; value: string }> };

export function parseSubmission(body: string): Submission {
  return { entries: [...new URLSearchParams(body)].map(([name, value]) => ({ name, value })) };
}

export type ValidationOutcome = { ok: true } | { ok: false; failing: LegacyFieldName[]; unknownPresent: boolean };

export function validateSubmission(s: Submission): ValidationOutcome {
  const known = new Set<string>(LEGACY_FORM.fields.map((f) => f.name));
  const unknownPresent = s.entries.some((e) => !known.has(e.name));
  const failing: LegacyFieldName[] = [];
  for (const field of LEGACY_FORM.fields) {
    const values = s.entries.filter((e) => e.name === field.name).map((e) => e.value);
    let ok = values.length === 1;
    const value = values[0] ?? '';
    if (ok && field.required && value.trim() === '') ok = false;
    if (ok && 'maxLength' in field && value.length > field.maxLength) ok = false;
    if (ok && field.control === 'radio' && !(field.values as readonly string[]).includes(value)) ok = false;
    if (ok && field.control === 'select' && !(field.values as readonly string[]).includes(value)) ok = false;
    if (ok && field.control === 'checkbox' && value !== field.value) ok = false;
    if (!ok) failing.push(field.name);
  }
  return failing.length === 0 && !unknownPresent ? { ok: true } : { ok: false, failing, unknownPresent };
}

/** The accepted entries in LEGACY_FORM order, values exactly as received. */
export function orderedEntries(s: Submission): Array<{ name: LegacyFieldName; value: string }> {
  return LEGACY_FORM.fields.map((f) => ({ name: f.name, value: s.entries.find((e) => e.name === f.name)!.value }));
}
