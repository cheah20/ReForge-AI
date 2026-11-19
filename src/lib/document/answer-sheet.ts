/**
 * src/lib/document/answer-sheet.ts
 *
 * The content of the Answer_Sheet (formbridge-any-document task 11.13,
 * design Q7). Pure: the sheet is a function of the session fields, so the
 * screen rebuilds it on every render and an edit is always included
 * (Requirement 19.10). No network, no storage.
 *
 * Validates: Requirements 16.4, 19.1, 19.2, 19.4
 */

import type { FieldState } from '../../frontend/state.js';

/** The fixed strings of the Clerk_Summary, each a `document.clerk.*` locale key. */
export const CLERK_KEYS = ['title', 'statement', 'skipped', 'signYourself', 'machineTranslated'] as const;
export type ClerkKey = (typeof CLERK_KEYS)[number];

/** The locale table of one language: the text of a key, or undefined when that table lacks the key. */
export type LocaleLookup = (language: string, key: string) => string | undefined;

export type AnswerSheetStatus = 'filled' | 'skipped' | 'sign yourself';

export interface AnswerSheetRow {
  labelId: string;
  pageNumber: number;
  labelText: string;
  /** Language of the label text, for the `lang` attribute (Requirement 10.3). */
  labelLang: string;
  status: AnswerSheetStatus;
  /** The normalised answer, or the approved translation. Only when `status` is `filled`. */
  answer?: string;
  /** True when `answer` is an approved machine translation (Requirement 19.4). */
  machineTranslated: boolean;
}

export interface ClerkString {
  text: string;
  /** The Form_Language, or `en` when the key fell back to the English table (Requirement 19.2). */
  lang: string;
}

export interface AnswerSheet {
  /** One row per Kept_Label, in page then reading order. */
  rows: AnswerSheetRow[];
  clerk: { lang: string; strings: Record<ClerkKey, ClerkString> };
}

const FALLBACK_LANGUAGE = 'en';

function clerkString(key: ClerkKey, formLanguage: string, locales: LocaleLookup): ClerkString {
  const fullKey = `document.clerk.${key}`;
  const own = locales(formLanguage, fullKey);
  if (own !== undefined && own !== '') return { text: own, lang: formLanguage };
  // The English table is the complete one; a key it lacks is a bug, shown as the key itself.
  return { text: locales(FALLBACK_LANGUAGE, fullKey) ?? fullKey, lang: FALLBACK_LANGUAGE };
}

function rowFrom(field: FieldState): AnswerSheetRow | null {
  const origin = field.origin;
  if (!origin) return null; // not a Kept_Label: never on the sheet
  const base = { labelId: origin.labelId, pageNumber: origin.pageNumber, labelText: origin.text, labelLang: origin.textLang };

  if (field.evidence.fieldType === 'signature') return { ...base, status: 'sign yourself', machineTranslated: false };
  if (field.skipped) return { ...base, status: 'skipped', machineTranslated: false };

  const translated = field.translation?.approved ? field.translation.text.trim() : '';
  if (translated !== '') return { ...base, status: 'filled', answer: translated, machineTranslated: true };

  const answer = field.normalizedOutput ?? '';
  if (answer === '') return { ...base, status: 'skipped', machineTranslated: false };
  return { ...base, status: 'filled', answer, machineTranslated: false };
}

export function buildAnswerSheet(fields: readonly FieldState[], formLanguage: string, locales: LocaleLookup): AnswerSheet {
  const rows: AnswerSheetRow[] = [];
  const lineOf = new Map<string, number>();
  for (const f of fields) {
    const row = rowFrom(f);
    if (!row) continue;
    rows.push(row);
    lineOf.set(row.labelId, f.origin!.lineIndex);
  }
  // Requirement 4.6: page number, then reading order. Array.sort is stable.
  rows.sort((a, b) => a.pageNumber - b.pageNumber || (lineOf.get(a.labelId)! - lineOf.get(b.labelId)!));

  const strings = {} as Record<ClerkKey, ClerkString>;
  for (const key of CLERK_KEYS) strings[key] = clerkString(key, formLanguage, locales);
  return { rows, clerk: { lang: formLanguage, strings } };
}

/** The status text of a row in the Clerk_Summary (answers are never altered). */
export function rowStatusText(row: AnswerSheetRow, clerk: AnswerSheet['clerk']): ClerkString | null {
  if (row.status === 'skipped') return clerk.strings.skipped;
  if (row.status === 'sign yourself') return clerk.strings.signYourself;
  return null;
}

/**
 * Plain text of the sheet, for Share when no PDF can be made (design Q7).
 * Built from the Clerk_Summary strings so it reads in the Form_Language.
 */
export function answerSheetPlainText(sheet: AnswerSheet): string {
  const { clerk, rows } = sheet;
  const lines: string[] = [clerk.strings.title.text, clerk.strings.statement.text, ''];
  for (const row of rows) {
    const value =
      row.status === 'filled'
        ? `${row.answer ?? ''}${row.machineTranslated ? ` (${clerk.strings.machineTranslated.text})` : ''}`
        : (rowStatusText(row, clerk)?.text ?? '');
    lines.push(`${row.pageNumber}. ${row.labelText} ${value}`.trimEnd());
  }
  return lines.join('\n') + '\n';
}
