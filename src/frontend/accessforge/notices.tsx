/**
 * src/frontend/accessforge/notices.tsx
 *
 * accessforge-skeleton task 16.5 (Requirements 3.8, 6.14, 7.5, 7.11, 13.7,
 * 13.8, 18.6). The data notice (before analysis and again on review), the
 * analysis-mode notice above the current content, the scope notice and the
 * language-locked note. Every notice has an icon and words, never colour alone.
 */

import { useId } from 'react';
import type { AnalysisMode } from '../../shared/page-schemas.js';
import { StatusMessage } from '../components/StatusMessage.js';
import { useTranslation } from '../i18n.js';

/** The data notice. With `onAcknowledge` it is the step before analysis; without, a reminder on review. */
export function DataNotice({ onAcknowledge, onDismiss }: { onAcknowledge?: () => void; onDismiss?: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <section className="notice stack" aria-labelledby={titleId}>
      <h2 id={titleId}>{t('accessforge.notice.title')}</h2>
      <ul className="notice__list">
        <li>{t('accessforge.notice.pageText')}</li>
        <li>{t('accessforge.notice.answersStay')}</li>
        <li>{t('accessforge.notice.legacyOnly')}</li>
        <li>{t('accessforge.notice.retranslate')}</li>
      </ul>
      {onAcknowledge && (
        <div className="actions">
          <button type="button" className="button" onClick={onAcknowledge}>
            {t('accessforge.notice.acknowledge')}
          </button>
          {onDismiss && (
            <button type="button" className="button button--quiet" onClick={onDismiss}>
              {t('accessforge.cancel.decline')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

const MODE_TONE: Record<AnalysisMode, 'info' | 'caution'> = { live: 'info', mock: 'caution', cached: 'caution', heuristic: 'caution' };

/** Requirement 7.5: which kind of analysis produced the questions. */
export function ModeNotice({ mode }: { mode: AnalysisMode | null }) {
  const { t } = useTranslation();
  if (mode === null) return null;
  return (
    <div className="mode-notice">
      <StatusMessage tone={MODE_TONE[mode]}>{t(`accessforge.mode.${mode}`)}</StatusMessage>
    </div>
  );
}

/** Requirement 3.5: the registration page is not the version that was tested; the revival goes on. */
export function PageChangedNotice({ show }: { show: boolean }) {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <div className="mode-notice">
      <StatusMessage tone="caution">{t('accessforge.notice.pageChanged')}</StatusMessage>
    </div>
  );
}
/** Requirements 7.7 and 7.9: a language switch is running, or failed and the earlier wording stays. */
export function LanguageSwitchNotice({ translating, failed }: { translating: boolean; failed: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="mode-notice" aria-live="polite">
      {translating && <StatusMessage tone="info">{t('accessforge.language.translating')}</StatusMessage>}
      {failed && !translating && <StatusMessage tone="caution">{t('accessforge.language.translateFailed')}</StatusMessage>}
    </div>
  );
}
export function ScopeNotice({ foreignAddress }: { foreignAddress: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="stack">
      {foreignAddress && <StatusMessage tone="caution">{t('accessforge.scope.onlyDemo')}</StatusMessage>}
      <StatusMessage tone="info">{t('accessforge.scope.notice')}</StatusMessage>
    </div>
  );
}
