/**
 * src/lib/accessforge/heuristic.ts
 *
 * accessforge-skeleton task 24.2 (Slice 2, Requirement 7.4, design Question 3).
 * A plan made from the page alone, with no AI and no network: select, radio and
 * checkbox take the type their control implies, and a text input takes a type
 * only when its `name` or `maxlength` matches a rule of the table. Every
 * confidence is 0, so each question asks the user to accept or decline it
 * (Requirement 6.18). Pure, shared by the Worker and the browser, and the same
 * Page_Model and language always give the same plan.
 */

import { translate } from '../../packs/language/registry.js';
import type { PageEntry, PageModel, PagePlanEntry } from '../../shared/page-schemas.js';

const IC_NAMES = new Set(['nokp', 'kp', 'ic', 'nric', 'mykad']);
const PHONE_NAMES = new Set(['tel', 'telefon', 'notel', 'hp', 'phone', 'mobile']);
const POSTCODE_NAMES = new Set(['poskod', 'pos', 'postcode', 'zip']);

const HUMAN_LABEL_MAX = 80;
const QUESTION_MAX = 200;
const LABEL_IN_QUESTION_MAX = 100;

type PlanAnswerType = PagePlanEntry['answerType'];

const cut = (text: string, max: number): string => [...text.trim().replace(/\s+/gu, ' ')].slice(0, max).join('');

/** The first matching rule of the design table, on the lower-case `name` and `maxlength`. */
export function heuristicTextType(name: string, maxLength: number | null): PlanAnswerType {
  const n = name.toLowerCase();
  if (IC_NAMES.has(n) || (maxLength === 12 && (n.includes('kp') || n.includes('ic')))) return 'ic';
  if (PHONE_NAMES.has(n)) return 'phone';
  if (POSTCODE_NAMES.has(n) || (maxLength === 5 && n.includes('pos'))) return 'postcode';
  if (['lahir', 'dob', 'birth', 'tarikh'].some((w) => n.includes(w))) return 'date';
  if (n.includes('email') || n.includes('emel')) return 'email';
  return 'text';
}

function answerTypeOf(entry: PageEntry): PlanAnswerType | null {
  switch (entry.control) {
    case 'select':
      return 'dropdown';
    case 'radio':
      return 'radio';
    case 'checkbox':
      return 'checkbox';
    case 'text':
      return heuristicTextType(entry.name, entry.maxLength);
    default:
      return null; // buttons and unsupported controls are never mapped
  }
}

/** The legacy label, else the neighbouring-cell text, else the field name. */
function legacyText(entry: PageEntry): string {
  return entry.labelText.trim() || entry.neighbourText.trim() || entry.name.trim() || entry.elementId;
}

export function heuristicPlan(model: PageModel, language: string): PagePlanEntry[] {
  const plan: PagePlanEntry[] = [];
  for (const entry of model.entries) {
    const answerType = answerTypeOf(entry);
    // A repeated id cannot be told apart, so it is left to the user (Requirement 5.8).
    if (answerType === null || entry.duplicateId) continue;
    const text = legacyText(entry);
    plan.push({
      elementId: entry.elementId,
      humanLabel: cut(text, HUMAN_LABEL_MAX),
      question: cut(translate(language, 'accessforge.heuristic.question', { label: cut(text, LABEL_IN_QUESTION_MAX) }), QUESTION_MAX),
      answerType,
      confidence: 0,
    });
  }
  return plan;
}
