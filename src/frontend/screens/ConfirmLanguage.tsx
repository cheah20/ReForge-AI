/**
 * src/frontend/screens/ConfirmLanguage.tsx
 *
 * Screen 5 (task 30.1), shown when the detected form language or country is
 * uncertain (5.3). The user confirms or corrects both before any question.
 * Chinese-language forms are blocked until CJK output is supported (5.3a):
 * Spike 2 has not passed, so the PDF fonts cannot write Chinese yet.
 */

import { useId, useState } from 'react';
import { LANGUAGE_REGISTRY } from '../../packs/language/registry.js';
import { registeredCountries } from '../../packs/country/registry.js';
import { useServices, useSession } from '../app-context.js';
import { ScreenHeading } from '../components/ScreenHeading.js';
import { StatusMessage } from '../components/StatusMessage.js';
import { useTranslation } from '../i18n.js';
import { confirmFormSettings } from '../state.js';

/** Becomes true only when Spike 2 (CJK font embedding) passes. */
export const CJK_FORMS_SUPPORTED = false;

export function isBlockedFormLanguage(tag: string): boolean {
  return !CJK_FORMS_SUPPORTED && (tag === 'zh-Hans' || tag === 'zh-Hant' || tag.toLowerCase().startsWith('zh'));
}

/** Language and country names in the reader's language, from the browser (no extra strings to translate). */
function displayName(kind: 'language' | 'region', code: string, inLanguage: string): string {
  try {
    return new Intl.DisplayNames([inLanguage, 'en'], { type: kind }).of(code) ?? code;
  } catch {
    return code;
  }
}

export interface ConfirmLanguageProps {
  onConfirmed: () => void;
}

export function ConfirmLanguage({ onConfirmed }: ConfirmLanguageProps) {
  const { t, language } = useTranslation();
  const { store } = useServices();
  const session = useSession();
  const detection = session.detection;
  const [formLanguage, setFormLanguage] = useState(session.formLanguage || 'en');
  const [formCountry, setFormCountry] = useState((session.formCountry || 'MY').toUpperCase());
  const languageId = useId();
  const countryId = useId();

  const languages = [...new Set([...(formLanguage ? [formLanguage] : []), ...LANGUAGE_REGISTRY.map((e) => e.tag)])];
  const countries = [...new Set([formCountry, ...registeredCountries()])];
  const blocked = isBlockedFormLanguage(formLanguage);

  return (
    <>
      <ScreenHeading>{t('confirm.title')}</ScreenHeading>
      {detection && (
        <div className="section stack">
          <p>
            {t('confirm.detected', { language: displayName('language', detection.formLanguage, language) })}{' '}
            {t('confirm.confidence', { percent: Math.round(detection.formLanguageConfidence * 100) })}
          </p>
          <p>
            {t('confirm.country', { country: displayName('region', detection.formCountry, language) })}{' '}
            {t('confirm.confidence', { percent: Math.round(detection.formCountryConfidence * 100) })}
          </p>
        </div>
      )}

      <form
        className="section stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (blocked) return;
          confirmFormSettings(store, formLanguage, formCountry);
          onConfirmed();
        }}
      >
        <div className="field-row">
          <label htmlFor={languageId}>{t('confirm.languageLabel')}</label>
          <select id={languageId} className="select select--wide" value={formLanguage} onChange={(e) => setFormLanguage(e.target.value)}>
            {languages.map((tag) => (
              <option key={tag} value={tag}>
                {displayName('language', tag, language)}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label htmlFor={countryId}>{t('confirm.countryLabel')}</label>
          <select id={countryId} className="select select--wide" value={formCountry} onChange={(e) => setFormCountry(e.target.value)}>
            {countries.map((code) => (
              <option key={code} value={code}>
                {displayName('region', code, language)}
              </option>
            ))}
          </select>
          <p className="hint">{t('confirm.countryHint')}</p>
        </div>

        <div aria-live="polite">{blocked && <StatusMessage tone="error">{t('confirm.cjkUnsupported')}</StatusMessage>}</div>

        <div className="actions">
          <button type="submit" className="button" disabled={blocked}>
            {t('confirm.continue')}
          </button>
        </div>
      </form>
    </>
  );
}
