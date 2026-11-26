/**
 * src/frontend/accessforge/PlanText.tsx
 *
 * accessforge-skeleton task 25.5 (Requirement 7.9). A label or question from
 * the Page_Plan, as plain text. When a language switch failed, the wording is
 * still in the earlier language, so the text carries that language in `lang`
 * and screen readers read it correctly.
 */
import type { ReactNode } from 'react';
import type { MirrorField } from '../../lib/accessforge/agent-machine.js';
import { useTranslation } from '../i18n.js';

/** The `lang` the wording of a field needs, or undefined when it matches the interface language. */
export function useWordingLang(field: MirrorField): string | undefined {
  const { language } = useTranslation();
  return field.wordingLanguage && field.wordingLanguage !== language ? field.wordingLanguage : undefined;
}

export function PlanText({ field, children }: { field: MirrorField; children: ReactNode }) {
  const lang = useWordingLang(field);
  return lang ? <span lang={lang}>{children}</span> : <>{children}</>;
}
