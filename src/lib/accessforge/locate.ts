/**
 * src/lib/accessforge/locate.ts
 *
 * Finds the frame controls an Element_Id names (design Question 2, Requirement
 * 8.3), for the Executor and the Verifier. Location goes through the one
 * form's `elements` collection, filtered by control type, exact `name` and,
 * for a radio option, exact `value`. No selector is ever built from a plan
 * or an Element_Id string.
 */

import type { ElementKey } from './element-id.js';
import { controlTypeOf, isHiddenInput } from './extract.js';

/** The only form of the document, or null when there is none or more than one. */
export function theForm(doc: Document): Element | null {
  const forms = doc.getElementsByTagName('form');
  return forms.length === 1 ? forms[0]! : null;
}

function formControls(form: Element): Element[] {
  // `elements` exists on a real form; the Worker typings do not describe it.
  const elements = (form as unknown as { elements: ArrayLike<Element> }).elements;
  return Array.from(elements).filter((el) => !isHiddenInput(el));
}

/** Every control of the form matching the key (zero, one or several). */
export function locate(doc: Document, key: ElementKey): Element[] {
  const form = theForm(doc);
  if (!form) return [];
  return formControls(form).filter((el) => {
    if (controlTypeOf(el) !== key.control) return false;
    if ((el.getAttribute('name') ?? '') !== key.name) return false;
    if (key.optionValue !== undefined) return (el.getAttribute('value') ?? 'on') === key.optionValue;
    return true;
  });
}

/** The page's Page_Version meta, or null. */
export function pageVersionOf(doc: Document): string | null {
  for (const meta of Array.from(doc.getElementsByTagName('meta'))) {
    if (meta.getAttribute('name') === 'portal-page-version') return meta.getAttribute('content');
  }
  return null;
}

/** DOM properties the Executor and Verifier use; the Worker and DOM typings disagree on these element types. */
export type ValueControl = { value: string };
export type CheckControl = { checked: boolean };
export type SelectControl = { value: string; selectedIndex: number; options: ArrayLike<{ value: string; selected: boolean }> };
