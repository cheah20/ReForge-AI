/**
 * src/frontend/accessforge/MirrorReview.tsx
 *
 * accessforge-skeleton task 16.9 (Requirements 10.4, 10.13, 12.2, 12.3,
 * 12.8, 13.7). The review screen: every field in Legacy_Form order with its
 * legacy label, the question, the Intended_Value and one status with an icon
 * and words; the confirm button, disabled with a stated reason while a
 * read-back is pending or differs or consent is missing. Pressing confirm is
 * the only way the legacy form is ever submitted.
 */

import { useId } from 'react';
import { canConfirm, requiredDoItYourself, reviewRows, type AgentEvent, type AgentState, type ConfirmBlock, type MirrorField, type ReviewRow } from '../../lib/accessforge/agent-machine.js';
import { ScreenHeading } from '../components/ScreenHeading.js';
import { StatusMessage, type StatusTone } from '../components/StatusMessage.js';
import { useTranslation, type TranslateFn } from '../i18n.js';
import { MIRROR_FORM_LANGUAGE, originalLabelOf } from './mirror-field-adapter.js';
import { DataNotice } from './notices.js';

const BLOCK_KEY: Partial<Record<ConfirmBlock, string>> = {
  PENDING: 'accessforge.review.pending',
  MISMATCH: 'accessforge.review.differs',
  CONSENT: 'accessforge.review.consentNeeded',
};

const STATUS: Record<ReviewRow['status'], { tone: StatusTone; key: string }> = {
  filled: { tone: 'success', key: 'accessforge.status.filled' },
  skipped: { tone: 'info', key: 'accessforge.status.skipped' },
  'do-it-yourself': { tone: 'caution', key: 'accessforge.status.diy' },
  mismatch: { tone: 'error', key: 'accessforge.status.mismatch' },
};

/** The value shown for a field: the option text for a choice, yes or no for consent, never a value for a do-it-yourself field. */
export function displayValue(field: MirrorField, t: TranslateFn): string {
  if (field.status === 'do-it-yourself' || field.intended === undefined) return '';
  if (typeof field.intended === 'boolean') return field.intended ? t('wizard.checkbox.checked') : t('wizard.checkbox.unchecked');
  const option = field.entry.options.find((o) => o.value === field.intended);
  return option ? option.text : field.intended;
}

/** Do-it-yourself fields with their legacy label and a plain reason; no value is proposed (Requirements 12.2, 12.3). */
export function DoItYourselfList({ fields, onShow }: { fields: readonly MirrorField[]; onShow?: ((elementId: string) => void) | undefined }) {
  const { t } = useTranslation();
  if (fields.length === 0) return null;
  return (
    <ul className="diy-list">
      {fields.map((f) => (
        <li key={f.elementId}>
          <span lang={MIRROR_FORM_LANGUAGE} className="diy-list__label">
            {originalLabelOf(f) || f.entry.name}
          </span>
          <span>{t(`accessforge.diy.reason.${f.diyReason ?? 'NO_PLAN'}`)}</span>
          {onShow && (
            <button type="button" className="button button--quiet" onClick={() => onShow(f.elementId)}>
              {t('accessforge.diy.show')}
              <span className="visually-hidden"> {originalLabelOf(f) || f.entry.name}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function MirrorReview({ state, dispatch, onShowField }: { state: AgentState; dispatch: (e: AgentEvent) => void; onShowField?: ((elementId: string) => void) | undefined }) {
  const { t } = useTranslation();
  const reasonId = useId();
  const rows = reviewRows(state);
  const confirm = canConfirm(state);
  const blockKey = !confirm.ok ? BLOCK_KEY[confirm.reason] : undefined;
  const required = requiredDoItYourself(state);
  const busy = state.phase === 'rereading' || state.phase === 'submitting';
  return (
    <div className="mirror-review stack">
      <ScreenHeading focusKey="review">{t('accessforge.review.title')}</ScreenHeading>
      <DataNotice />
      {required.map((f) => (
        <StatusMessage key={f.elementId} tone="caution">
          {t('accessforge.review.diyRequired', { label: originalLabelOf(f) || f.entry.name })}
        </StatusMessage>
      ))}
      <ul className="review-list">
        {rows.map(({ field, status }) => {
          const s = STATUS[status];
          return (
            <li key={field.elementId} className="review-row">
              <p className="review-row__label">
                <span className="visually-hidden">{t('accessforge.review.col.label')}: </span>
                <span lang={MIRROR_FORM_LANGUAGE}>{originalLabelOf(field) || field.entry.name}</span>
              </p>
              {field.plan && (
                <p className="review-row__question">
                  <span className="visually-hidden">{t('accessforge.review.col.question')}: </span>
                  {field.plan.question}
                </p>
              )}
              <p className="review-row__value">
                <span className="visually-hidden">{t('accessforge.review.col.value')}: </span>
                {displayValue(field, t)}
              </p>
              <StatusMessage tone={s.tone}>{t(s.key)}</StatusMessage>
              {field.status === 'do-it-yourself' && <DoItYourselfList fields={[field]} onShow={state.phase === 'review' ? onShowField : undefined} />}
              {field.plan && field.status !== 'do-it-yourself' && state.phase === 'review' && (
                <button type="button" className="button button--quiet" onClick={() => dispatch({ type: 'EDIT_PRESSED', elementId: field.elementId })}>
                  {t('accessforge.review.edit')}
                  <span className="visually-hidden"> {field.plan.humanLabel}</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div aria-live="polite">
        {blockKey && (
          <StatusMessage tone="caution" id={reasonId}>
            {t(blockKey)}
          </StatusMessage>
        )}
        {busy && <StatusMessage tone="info">{t('accessforge.review.sending')}</StatusMessage>}
      </div>
      <div className="actions">
        <button
          type="button"
          className="button"
          disabled={!confirm.ok || busy}
          aria-describedby={blockKey ? reasonId : undefined}
          onClick={() => dispatch({ type: 'CONFIRM_PRESSED' })}
        >
          {t('accessforge.review.confirm')}
        </button>
        <button type="button" className="button button--quiet" disabled={busy} onClick={() => dispatch({ type: 'CANCEL_PRESSED' })}>
          {t('accessforge.step.cancel')}
        </button>
      </div>
    </div>
  );
}
