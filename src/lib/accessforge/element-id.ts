/**
 * src/lib/accessforge/element-id.ts
 *
 * accessforge-skeleton task 7.1 (design Question 2, Requirements 5.3, 8.3,
 * 8.13). An Element_Id is built only from the form index, the control type,
 * the exact `name` and, for a radio option, its `value`:
 *
 *   Element_Id      = "f" + formIndex + ":" + controlType + ":" + enc(name)
 *   radio option id = Element_Id of the group + ":" + enc(value)
 *   enc             = encodeURIComponent
 *
 * `encodeURIComponent` turns ":" into "%3A", so a name can never fake a
 * separator. Nothing else enters the id (no `id` attribute, label, cell text
 * or position), so an AI reply cannot influence it. `parseElementId` is the
 * exact inverse and accepts only ids `elementIdFor` can produce.
 */

import type { ControlType } from '../../shared/page-schemas.js';

export interface ElementKey {
  formIndex: number;
  control: ControlType;
  name: string;
  /** Present only on a radio option id. */
  optionValue?: string;
}

const CONTROL_TYPES: readonly ControlType[] = ['text', 'select', 'radio', 'checkbox', 'submit', 'reset', 'unsupported'];

/**
 * Thrown when a name or value cannot be encoded (a lone UTF-16 surrogate).
 * The Page_Extractor treats such a control as one it cannot identify.
 */
export class ElementIdEncodingError extends Error {
  constructor(part: 'name' | 'optionValue') {
    super(`Element_Id ${part} cannot be encoded`);
    this.name = 'ElementIdEncodingError';
  }
}

function enc(value: string, part: 'name' | 'optionValue'): string {
  try {
    return encodeURIComponent(value);
  } catch (e) {
    if (e instanceof URIError) throw new ElementIdEncodingError(part);
    throw e;
  }
}

/** Decodes one id segment; null when it is not the canonical encoding of any string. */
function dec(segment: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch (e) {
    if (e instanceof URIError) return null;
    throw e;
  }
  // "%41" decodes to "A", but elementIdFor writes "A": only canonical segments are ids.
  return encodeURIComponent(decoded) === segment ? decoded : null;
}

export function elementIdFor(key: ElementKey): string {
  if (!Number.isSafeInteger(key.formIndex) || key.formIndex < 0) throw new RangeError('formIndex must be a non-negative integer');
  const base = `f${key.formIndex}:${key.control}:${enc(key.name, 'name')}`;
  if (key.optionValue === undefined) return base;
  if (key.control !== 'radio') throw new RangeError('only a radio control has option ids');
  return `${base}:${enc(key.optionValue, 'optionValue')}`;
}

/** The radio option id for one value of a radio group. */
export function radioOptionIdFor(formIndex: number, name: string, value: string): string {
  return elementIdFor({ formIndex, control: 'radio', name, optionValue: value });
}

export function parseElementId(id: string): ElementKey | null {
  const parts = id.split(':');
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [form, control, nameSeg, valueSeg] = parts as [string, string, string, string | undefined];
  const m = /^f(0|[1-9][0-9]*)$/.exec(form);
  if (!m) return null;
  const formIndex = Number(m[1]);
  if (!Number.isSafeInteger(formIndex)) return null;
  if (!(CONTROL_TYPES as readonly string[]).includes(control)) return null;
  const name = dec(nameSeg);
  if (name === null) return null;
  const key: ElementKey = { formIndex, control: control as ControlType, name };
  if (valueSeg === undefined) return key;
  if (control !== 'radio') return null;
  const optionValue = dec(valueSeg);
  if (optionValue === null) return null;
  return { ...key, optionValue };
}
