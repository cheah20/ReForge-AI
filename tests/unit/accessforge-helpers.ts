/**
 * tests/unit/accessforge-helpers.ts
 *
 * Shared inputs for the AccessForge executor and verifier tests (jsdom): the
 * registration page, its Page_Model and a fully valid plan. Not a test file.
 */

import { extractPageModel } from '../../src/lib/accessforge/extract.js';
import { validatePlan, type ValidatedPlan } from '../../src/lib/accessforge/plan-validator.js';
import { nextGeneration, INITIAL_FRAME, type FrameHandle } from '../../src/lib/accessforge/generation.js';
import type { ExecutorContext } from '../../src/lib/accessforge/executor.js';
import { TEMPLATES, PAGE_VERSIONS } from '../../src/worker/legacy/generated/templates.js';
import { fill } from '../../src/worker/legacy/render.js';
import type { PageModel } from '../../src/shared/page-schemas.js';

export const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
export const registerDoc = () => parse(fill(TEMPLATES.register, {}));

const r = extractPageModel(registerDoc(), PAGE_VERSIONS.register);
if (!r.ok) throw new Error('registration page did not extract');
export const MODEL: PageModel = r.model;

const TYPES: Record<string, string> = {
  'f0:text:nama': 'text',
  'f0:text:nokp': 'ic',
  'f0:text:tlahir': 'date',
  'f0:radio:jantina': 'radio',
  'f0:text:tel': 'phone',
  'f0:text:poskod': 'postcode',
  'f0:select:tujuan': 'dropdown',
  'f0:checkbox:akuan': 'checkbox',
};

/** A valid plan entry for each listed field id (all fields by default). */
export function planFor(ids: readonly string[] = Object.keys(TYPES)): ValidatedPlan {
  return validatePlan(
    MODEL,
    ids.map((elementId) => ({ elementId, humanLabel: 'Label', question: 'Question?', answerType: TYPES[elementId], confidence: 0.9 })),
  );
}

export const APP_ORIGIN = () => window.location.origin;

/** A frame showing `doc` at generation 1, and an Executor context on it. */
export function contextFor(doc: Document, over: Partial<ExecutorContext> = {}): ExecutorContext {
  const frame: FrameHandle = nextGeneration(INITIAL_FRAME, doc);
  return {
    frame,
    actionGeneration: frame.generation,
    liveDocument: doc,
    appOrigin: APP_ORIGIN(),
    model: MODEL,
    plan: planFor(),
    submitArmed: false,
    submissionDone: false,
    consentGiven: true,
    ...over,
  };
}

/** Every control's value, checked and selected state, in form order. */
export function snapshot(doc: Document): Array<{ name: string; state: string }> {
  const form = doc.getElementsByTagName('form')[0]!;
  const elements = Array.from((form as unknown as { elements: ArrayLike<Element> }).elements);
  return elements.map((el) => {
    const c = el as unknown as { value?: string; checked?: boolean; selectedIndex?: number };
    return { name: el.getAttribute('name') ?? '', state: JSON.stringify([c.value, c.checked, c.selectedIndex]) };
  });
}
