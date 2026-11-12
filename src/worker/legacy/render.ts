/**
 * src/worker/legacy/render.ts
 *
 * accessforge-skeleton task 5.1: join a generated template's segments with
 * slot values that the caller has already escaped. No sanitiser, no DOM, no
 * hash at request time (Requirement 2.11).
 */

import type { GeneratedTemplate, SlotName } from './generated/templates.js';

export function fill(template: GeneratedTemplate, values: Partial<Record<SlotName, string>> = {}): string {
  let out = template.segments[0] ?? '';
  template.slots.forEach((slot, i) => {
    out += (values[slot] ?? '') + (template.segments[i + 1] ?? '');
  });
  return out;
}
