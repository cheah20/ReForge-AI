/**
 * src/frontend/screens/LanguagePicker.tsx
 *
 * Screen 1 (task 27.1): choose the interface language.
 * - Lists every registry language by its native name, each with its own `lang`.
 * - The browser language is pre-selected by the app; the user confirms it.
 * - Experimental languages carry a visible badge (2-L.7).
 * - Picking a language switches the screen at once, so the user can check it.
 * - Larger-text option (13.9).
 * - "Try a sample form" opens the bundled clinic form on the upload screen (28.5).
 */

import { useId, useState } from 'react';
import { LANGUAGE_REGISTRY } from '../../packs/language/registry.js';
import { ScreenHeading } from '../components/ScreenHeading.js';
import { useTranslation } from '../i18n.js';
import type { ChangeLanguage } from '../use-change-language.js';

export interface LanguagePickerProps {
  changeLanguage: ChangeLanguage;
  onContinue: () => void;
  /** "Try a sample form" (task 28.5): continue with the bundled clinic form. */
  onTrySample: () => void;
  /** Initial page load: do not steal focus from the top of the page. */
  firstScreen?: boolean;
}

function readLargeText(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset['textSize'] === 'large';
}

export function setLargeText(on: boolean): void {
  if (on) document.documentElement.dataset['textSize'] = 'large';
  else delete document.documentElement.dataset['textSize'];
}

export function LanguagePicker({ changeLanguage, onContinue, onTrySample, firstScreen = false }: LanguagePickerProps) {
  const { t, language } = useTranslation();
  const [largeText, setLarge] = useState(readLargeText);
  const subtitleId = useId();
  const sampleHintId = useId();

  return (
    <>
      <ScreenHeading autoFocus={!firstScreen}>{t('language.picker.title')}</ScreenHeading>
      <p className="page__lead" id={subtitleId}>
        {t('language.picker.subtitle')}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onContinue();
        }}
      >
        <fieldset className="language-list" aria-describedby={subtitleId}>
          <legend className="visually-hidden">{t('language.picker.title')}</legend>
          {LANGUAGE_REGISTRY.map((entry) => (
            <label key={entry.tag} className="language-option">
              <input
                type="radio"
                name="language"
                value={entry.tag}
                checked={language === entry.tag}
                disabled={changeLanguage.busy}
                onChange={() => void changeLanguage.change(entry.tag)}
              />
              <span className="language-option__name" lang={entry.tag} dir={entry.direction}>
                {entry.nativeName}
              </span>
              {entry.status === 'experimental' && (
                <span className="badge badge--caution">{t('language.picker.experimental')}</span>
              )}
            </label>
          ))}
        </fieldset>

        <div className="section">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={largeText}
              onChange={(e) => {
                setLarge(e.target.checked);
                setLargeText(e.target.checked);
              }}
            />
            <span>{t('language.picker.largerText')}</span>
          </label>
        </div>

        <div className="actions">
          <button type="submit" className="button">
            {t('language.picker.continue')}
          </button>
          <button type="button" className="button button--secondary" aria-describedby={sampleHintId} onClick={onTrySample}>
            {t('language.picker.trySample')}
          </button>
        </div>
        <p className="hint" id={sampleHintId}>
          {t('language.picker.trySampleHint')}
        </p>
      </form>
    </>
  );
}
