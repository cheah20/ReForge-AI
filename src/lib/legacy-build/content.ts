/**
 * src/lib/legacy-build/content.ts
 *
 * Typed access to the Malay portal content (decision B). Every visible portal
 * string comes from this one file, which stays outside the Language_Registry.
 * Build and test only.
 */

import content from '../../packs/language/locales/legacy-portal/ms.json';

export type ContentKey = keyof typeof content;

export const CONTENT: Readonly<Record<ContentKey, string>> = content;

export function c(key: ContentKey): string {
  return CONTENT[key];
}

/** Every string of the content file (for "every text node comes from the content file" checks). */
export const CONTENT_STRINGS: readonly string[] = Object.values(content);
