/**
 * src/frontend/screens/ReviewScreen.tsx
 *
 * Screen 7 (task 32.1): every field, its question, the original PDF label,
 * the value that will be written and a status in words. Inline edit reuses
 * FieldQuestion with the same validation. Nothing is written or downloaded
 * until the user presses "Confirm and download PDF" (human in control).
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { ValidationResult } from '../../packs/country/interface.js';
import { fallbackAnalysis } from '../../lib/analysis/reconcile.js';
import { useServices, useSession } from '../app-context.js';
import { FieldQuestion } from '../components/FieldQuestion.js';
import { ScreenHeading } from '../components/ScreenHeading.js';
import { StatusMessage, type StatusTone } from '../components/StatusMessage.js';
import { resultOnChange, resultOnCommit } from './QuestionWizard.js';
import { useTranslation } from '../i18n.js';
import { setAnswer, setDateFormat, skipField, type FieldState } from '../state.js';
import { answerTypeOf, answersForFill, needsDateFormatChoice, reviewStatus, validateFieldAnswer, type ReviewStatus } from '../wizard-logic.js';

const STATUS: Record<ReviewStatus, { key: string; tone: StatusTone }> = {
  filled: { key: 'review.field.status.filled', tone: 'success' },
  skipped: { key: 'review.field.status.skipped', tone: 'info' },
  skippedRequired: { key: 'review.field.status.skippedRequired', tone: 'caution' },
  unanswered: { key: 'review.field.status.unanswered', tone: 'info' },
  fillYourself: { key: 'review.field.status.fillYourself', tone: 'caution' },
  readOnly: { key: 'review.field.status.readOnly', tone: 'info' },
  signed: { key: 'review.field.status.signed', tone: 'caution' },
  missingRequired: { key: 'review.required.warning', tone: 'error' },
};

export interface ReviewScreenProps {
  onConfirm: () => void;
  onBack: () => void;
}

function writtenValue(field: FieldState, t: (k: string) => string): string {
  const answer = answersForFill([field]).get(field.evidence.fieldId);
  if (!answer) return '';
  if (answer.kind === 'text') return answer.value;
  if (answer.kind === 'checkbox') return answer.state === 'checked' ? t('wizard.checkbox.checked') : t('wizard.checkbox.unchecked');
  return field.evidence.options?.find((o) => o.exportValue === answer.exportValue)?.displayLabel ?? answer.exportValue;
}

function InlineEdit({ field, onClose }: { field: FieldState; onClose: () => void }) {
  const { t } = useTranslation();
  const { store } = useServices();
  const session = useSession();
  const [draft, setDraft] = useState(field.rawAnswer ?? '');
  const [result, setResult] = useState<ValidationResult | null>(null);
  const validate = (v: string) => validateFieldAnswer(field, v, { formCountry: session.formCountry });

  return (
    <form
      noValidate
      className="inline-edit stack"
      onSubmit={(e) => {
        e.preventDefault();
        const r = validate(draft);
        setResult(r);
        if (!r.valid) return;
        if (draft.trim() === '' && answerTypeOf(field) !== 'checkbox') skipField(store, field.evidence.fieldId);
        else setAnswer(store, field.evidence.fieldId, draft, r.normalizedValue ?? draft);
        onClose();
      }}
    >
      <FieldQuestion
        field={field}
        draft={draft}
        onDraftChange={(v) => {
          setDraft(v);
          setResult((previous) => resultOnChange(validate(v), previous));
        }}
        onCommit={(v) => setResult((previous) => resultOnCommit(answerTypeOf(field), v, validate(v), previous))}
        result={result}
        formLanguage={session.formLanguage}
        formCountry={session.formCountry}
        interfaceLanguage={session.interfaceLanguage}
        confirmed
        onConfirm={() => {}}
        onChooseDateFormat={(format) =>
          setDateFormat(
            store,
            store
              .get()
              .fields.filter((f) => needsDateFormatChoice(f))
              .map((f) => f.evidence.fieldId),
            format,
          )
        }
        headingLevel={2}
      />
      <div className="actions">
        <button type="submit" className="button">
          {t('review.save')}
        </button>
        <button type="button" className="button button--quiet" onClick={onClose}>
          {t('review.cancel')}
        </button>
      </div>
    </form>
  );
}

export function ReviewScreen({ onConfirm, onBack }: ReviewScreenProps) {
  const { t } = useTranslation();
  const session = useSession();
  const [editing, setEditing] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const summaryId = useId();
  const missing = session.fields.filter((f) => reviewStatus(f) === 'missingRequired');

  useEffect(() => {
    if (showSummary) summaryRef.current?.focus();
  }, [showSummary]);

  const rowId = (f: FieldState) => `review-${f.evidence.fieldId.replace(/[^A-Za-z0-9_-]/g, '_')}`;

  return (
    <>
      <ScreenHeading>{t('review.title')}</ScreenHeading>
      <div className="notice">
        <p>{t('review.privacyNotice')}</p>
      </div>

      {showSummary && missing.length > 0 && (
        <div className="error-panel stack section" tabIndex={-1} ref={summaryRef} aria-labelledby={summaryId}>
          <h2 id={summaryId}>{t('review.errorSummary')}</h2>
          <ul>
            {missing.map((f) => (
              <li key={f.evidence.fieldId}>
                <a href={`#${rowId(f)}`}>{f.analysis?.humanLabel ?? fallbackAnalysis(f.evidence).humanLabel}</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol className="review-list">
        {session.fields.map((f) => {
          const status = reviewStatus(f);
          const analysis = f.analysis ?? fallbackAnalysis(f.evidence);
          const original = f.evidence.tooltip?.trim() || f.evidence.widgets.find((w) => w.pageSnippet.trim())?.pageSnippet.trim();
          const value = writtenValue(f, t);
          const editable = status !== 'fillYourself' && status !== 'readOnly' && status !== 'signed';
          return (
            <li key={f.evidence.fieldId} id={rowId(f)} className="review-item">
              {editing === f.evidence.fieldId ? (
                <InlineEdit field={f} onClose={() => setEditing(null)} />
              ) : (
                <>
                  <h2 className="review-item__label">{analysis.humanLabel}</h2>
                  <p className="hint">{analysis.question}</p>
                  {original && (
                    <p className="hint">
                      {t('wizard.originalLabel', { label: '' })}
                      <span lang={session.formLanguage || undefined}>{original}</span>
                    </p>
                  )}
                  {value && (
                    <p
                      className="review-item__value"
                      lang={f.evidence.fieldType === 'checkbox' ? undefined : session.formLanguage || undefined}
                    >
                      {value}
                    </p>
                  )}
                  <StatusMessage tone={STATUS[status].tone}>
                    {status === 'fillYourself' ? t('wizard.fillYourself') : t(STATUS[status].key)}
                  </StatusMessage>
                  {editable && (
                    <button type="button" className="button button--quiet" onClick={() => setEditing(f.evidence.fieldId)}>
                      {t('review.edit')}
                      <span className="visually-hidden">: {analysis.humanLabel}</span>
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>

      <div className="actions">
        <button type="button" className="button button--secondary" onClick={onBack}>
          {t('wizard.back')}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            if (missing.length > 0) {
              setShowSummary(true);
              summaryRef.current?.focus();
              return;
            }
            onConfirm();
          }}
        >
          {t('review.confirm')}
        </button>
      </div>
    </>
  );
}
