/**
 * src/worker/legacy/form-spec.ts
 *
 * The one legacy registration form (accessforge-skeleton task 4.1, design
 * "Legacy form specification"). It drives both the generated template and the
 * handler's validation, so the two cannot drift apart. Visible labels and
 * option texts come from the content file by key; these are the attribute
 * values only.
 */

export const LEGACY_FORM = {
  action: '/legacy/register',
  method: 'post',
  fields: [
    { name: 'nama', control: 'text', maxLength: 60, required: true },
    { name: 'nokp', control: 'text', maxLength: 12, required: true },
    { name: 'tlahir', control: 'text', maxLength: 10, required: true },
    { name: 'jantina', control: 'radio', values: ['L', 'P'], required: true },
    { name: 'tel', control: 'text', maxLength: 15, required: true },
    { name: 'poskod', control: 'text', maxLength: 5, required: true },
    { name: 'tujuan', control: 'select', values: ['', 'PERIKSA', 'SUSULAN', 'VAKSIN', 'LAIN'], required: true },
    { name: 'akuan', control: 'checkbox', value: 'YA', required: true },
  ],
} as const;

export type LegacyField = (typeof LEGACY_FORM)['fields'][number];
export type LegacyFieldName = LegacyField['name'];
export const LEGACY_FIELD_NAMES: readonly LegacyFieldName[] = LEGACY_FORM.fields.map((f) => f.name);
