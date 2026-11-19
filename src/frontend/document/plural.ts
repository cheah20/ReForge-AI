/** Picks `base.one` or `base.other` by the plural rule of the interface language. */
export function pluralKey(base: string, count: number, language: string): string {
  let category = 'other';
  try {
    category = new Intl.PluralRules(language).select(count);
  } catch {
    // An unknown language tag uses the general form.
  }
  return category === 'one' ? `${base}.one` : `${base}.other`;
}
