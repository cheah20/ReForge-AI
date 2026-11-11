/**
 * src/frontend/components/AppHeader.tsx
 *
 * App name, the language switcher (after the picker) and the Demo mode banner
 * (requirement 12.4) when the mock provider answered.
 */

import { useId } from 'react';
import { LANGUAGE_REGISTRY } from '../../packs/language/registry.js';
import { useSession } from '../app-context.js';
import { useTranslation } from '../i18n.js';
import type { ChangeLanguage } from '../use-change-language.js';
import { StatusMessage } from './StatusMessage.js';

export interface AppHeaderProps {
  showLanguageSwitch: boolean;
  changeLanguage: ChangeLanguage;
}

export function AppHeader({ showLanguageSwitch, changeLanguage }: AppHeaderProps) {
  const { t, language } = useTranslation();
  const session = useSession();
  const selectId = useId();

  return (
    <header className="app-header">
      <div className="app-header__bar">
        <span className="app-header__name">{t('app.title')}</span>
        {showLanguageSwitch && (
          <div className="app-header__language">
            <label htmlFor={selectId}>{t('nav.pickLanguage')}</label>
            <select
              id={selectId}
              className="select"
              value={language}
              disabled={changeLanguage.busy}
              aria-busy={changeLanguage.busy}
              onChange={(e) => void changeLanguage.change(e.target.value)}
            >
              {LANGUAGE_REGISTRY.map((entry) => (
                <option key={entry.tag} value={entry.tag} lang={entry.tag}>
                  {entry.nativeName}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {session.demoMode && <p className="demo-banner">{t('analysis.demoMode')}</p>}
      <div aria-live="polite">
        {changeLanguage.errorKey && (
          <div className="app-header__bar">
            <StatusMessage tone="error">{t(changeLanguage.errorKey)}</StatusMessage>
          </div>
        )}
      </div>
    </header>
  );
}
