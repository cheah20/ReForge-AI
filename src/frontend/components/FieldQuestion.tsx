/**
 * src/frontend/components/FieldQuestion.tsx
 *
 * One question (task 31.2), used by the wizard and by inline edit in review.
 * - Shows the AI-written question with the machine-translated badge, and the
 *   field's own label from the PDF (tooltip or nearby text, never invented)
 *   in the form's language.
 * - Low confidence (6.1): the user first checks the question against the PDF
 *   text and may change the answer type (5.9), then answers.
 * - Date fields without a printed format ask for the format first (7.5).
 * - Description fields offer a translation into the form language. The
 *   "Translate my answer" button is the only trigger for that request (8.6).
 */

import { useId, useState } from 'react';
import type { ValidationResult } from '../../packs/country/interface.js';
import { getCountryPack } from '../../packs/country/registry.js';
import { DATE_EXAMPLES, DATE_FORMATS, type DateFormat } from '../../packs/country/dates.js';
import { fallbackAnalysis } from '../../lib/analysis/reconcile.js';
import type { AnswerType } from '../../shared/types.js';
import { useServices, useSession } from '../app-context.js';
import { useTranslation } from '../i18n.js';
import {
  approveTranslation,
  discardTranslation,
  overrideAnswerType,
  setAnswer,
  translateDescription,
  type FieldState,
} from '../state.js';
import { answerTypeOf, CHECKED, needsDateFormatChoice, overrideChoices, pageTextOf, UNCHECKED } from '../wizard-logic.js';
import { errorKeyFor } from '../use-change-language.js';
import { MachineTranslatedLabel } from './MachineTranslatedLabel.js';
import { StatusMessage } from './StatusMessage.js';
import { ValidationMessage } from './ValidationMessage.js';

export interface FieldQuestionProps {
  field: FieldState;
  draft: string;
  onDraftChange: (value: string) => void;
  /** Validate now (blur, or a choice made). */
  onCommit: (value: string) => void;
  result: ValidationResult | null;
  formLanguage: string;
  formCountry: string;
  interfaceLanguage: string;
  /** The user has confirmed this low-confidence question. */
  confirmed: boolean;
  onConfirm: () => void;
  onChooseDateFormat: (format: DateFormat) => void;
  /** Heading level of the question text: 2 in the wizard, 3 inside review. */
  headingLevel?: 2 | 3;
}

/** Choice lists longer than this use a dropdown instead of radio buttons. */
const MAX_RADIOS = 7;

const INPUT_HINTS: Partial<Record<AnswerType, { type: string; inputMode?: 'tel' | 'numeric' | 'email'; autoComplete?: string }>> = {
  phone: { type: 'tel', inputMode: 'tel', autoComplete: 'tel' },
  email: { type: 'email', inputMode: 'email', autoComplete: 'email' },
  postcode: { type: 'text', autoComplete: 'postal-code' },
  ic: { type: 'text' },
  date: { type: 'text' },
};

/** Helper text key for formats the user must follow, per country where it differs. */
function hintKey(type: AnswerType, country: string): string | null {
  const c = country.toUpperCase();
  if (type === 'ic' && c === 'MY') return 'hint.ic.MY';
  if (type === 'phone') return c === 'MY' ? 'hint.phone.MY' : c === 'US' ? 'hint.phone.US' : 'hint.phone.other';
  if (type === 'postcode') return c === 'MY' ? 'hint.postcode.MY' : c === 'US' ? 'hint.postcode.US' : null;
  if (type === 'email') return 'hint.email';
  return null;
}

export function FieldQuestion(props: FieldQuestionProps) {
  const { field, draft, onDraftChange, onCommit, result, formLanguage, formCountry, interfaceLanguage } = props;
  const { t } = useTranslation();
  const { store, api } = useServices();
  const session = useSession();
  const ids = { input: useId(), hint: useId(), message: useId(), original: useId(), badge: useId(), type: useId(), translation: useId() };
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translationDraft, setTranslationDraft] = useState<string | null>(null);

  const ev = field.evidence;
  const type = answerTypeOf(field);
  const analysis = field.analysis ?? fallbackAnalysis(ev);
  const aiWritten = field.analysis !== null && field.analysis.question !== fallbackAnalysis(ev).question;
  const originalLabel = ev.tooltip?.trim() || ev.widgets.find((w) => w.pageSnippet.trim())?.pageSnippet.trim() || '';
  const nearby = pageTextOf(field);
  const lowConfidence = field.status === 'low-confidence' && !props.confirmed;
  const invalid = !!result && !result.valid && !result.needs;
  const hk = hintKey(type, formCountry);
  const describedBy = [hk ? ids.hint : '', ids.message, originalLabel ? ids.original : '', aiWritten ? ids.badge : '']
    .filter(Boolean)
    .join(' ');
  const Heading = props.headingLevel === 3 ? 'h3' : 'h2';
  const isChoiceGroup = type === 'radio' || type === 'checkbox' || (type === 'dropdown' && (ev.options?.length ?? 0) <= MAX_RADIOS);
  const labelsInput = !lowConfidence && !isChoiceGroup && !(type === 'date' && needsDateFormatChoice(field));

  const questionBlock = (
    <div className="question__text">
      <Heading className="question__title">
        {labelsInput ? <label htmlFor={ids.input}>{analysis.question}</label> : analysis.question}
      </Heading>
      {aiWritten && <MachineTranslatedLabel id={ids.badge} />}
      {originalLabel && (
        <p className="hint" id={ids.original}>
          {t('wizard.originalLabel', { label: '' })}
          <span lang={formLanguage || undefined}>{originalLabel}</span>
        </p>
      )}
      {ev.required && <p className="hint">{t('wizard.required')}</p>}
    </div>
  );

  if (lowConfidence) {
    const choices = overrideChoices(field);
    return (
      <div className="question">
        {questionBlock}
        <div className="notice notice--caution stack">
          <StatusMessage tone="caution">{t('wizard.lowConfidence')}</StatusMessage>
          {nearby && (
            <p>
              {t('wizard.nearbyText', { text: '' })}
              <span lang={formLanguage || undefined}>{nearby}</span>
            </p>
          )}
          {choices.length > 1 && (
            <div className="field-row">
              <label htmlFor={ids.type}>{t('wizard.answerType')}</label>
              <select
                id={ids.type}
                className="select"
                value={type}
                onChange={(e) => overrideAnswerType(store, ev.fieldId, e.target.value as AnswerType)}
              >
                {choices.map((c) => (
                  <option key={c} value={c}>
                    {t(`answerType.${c}`)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="actions">
            <button type="button" className="button button--secondary" onClick={props.onConfirm}>
              {t('wizard.confirmQuestion')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (type === 'date' && needsDateFormatChoice(field)) {
    const pack = getCountryPack(formCountry);
    const ordered = [pack.defaultDateFormat, ...DATE_FORMATS.filter((f) => f !== pack.defaultDateFormat)];
    return (
      <div className="question">
        {questionBlock}
        <fieldset className="choice-group">
          <legend>{t('validation.date.chooseFormat')}</legend>
          {ordered.map((f) => (
            <label key={f} className="choice-option">
              <input type="radio" name={`${ids.input}-format`} value={f} onChange={() => props.onChooseDateFormat(f)} />
              <span>
                {f} <span className="hint">({DATE_EXAMPLES[f]})</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    );
  }

  if (isChoiceGroup) {
    const options =
      type === 'checkbox'
        ? [
            { value: CHECKED, label: t('wizard.checkbox.checked'), lang: undefined },
            { value: UNCHECKED, label: t('wizard.checkbox.unchecked'), lang: undefined },
          ]
        : (ev.options ?? []).map((o) => ({ value: o.exportValue, label: o.displayLabel, lang: formLanguage || undefined }));
    return (
      <div className="question">
        <fieldset className="choice-group" aria-describedby={describedBy}>
          <legend className="question__legend">{questionBlock}</legend>
          {options.map((o) => (
            <label key={o.value} className="choice-option">
              <input
                type="radio"
                name={ids.input}
                value={o.value}
                checked={draft === o.value}
                aria-invalid={invalid || undefined}
                onChange={() => {
                  onDraftChange(o.value);
                  onCommit(o.value);
                }}
              />
              <span lang={o.lang}>{o.label}</span>
            </label>
          ))}
        </fieldset>
        <ValidationMessage id={ids.message} result={result} />
      </div>
    );
  }

  if (type === 'dropdown') {
    return (
      <div className="question">
        {questionBlock}
        <select
          id={ids.input}
          className="select select--wide"
          value={draft}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            onDraftChange(e.target.value);
            onCommit(e.target.value);
          }}
        >
          <option value="">{t('wizard.choose')}</option>
          {(ev.options ?? []).map((o) => (
            <option key={o.exportValue} value={o.exportValue} lang={formLanguage || undefined}>
              {o.displayLabel}
            </option>
          ))}
        </select>
        <ValidationMessage id={ids.message} result={result} />
      </div>
    );
  }

  // Typed answers: text, IC, phone, postcode, date, email, description.
  const multiline = type === 'description' || ev.multiline === true;
  const hints = INPUT_HINTS[type];
  const translation = field.translation;
  const pending = session.pendingTranslationFieldId === ev.fieldId;
  const canTranslate = type === 'description' && draft.trim() !== '' && !!formLanguage && formLanguage !== interfaceLanguage;

  async function translate() {
    setTranslateError(null);
    setAnswer(store, ev.fieldId, draft, draft.trim());
    try {
      const out = await translateDescription(store, ev.fieldId, { api });
      if (out === 'done') setTranslationDraft(null);
    } catch (err) {
      setTranslateError(errorKeyFor(err));
    }
  }

  return (
    <div className="question">
      {questionBlock}
      {hk && (
        <p className="hint" id={ids.hint}>
          {t(hk)}
        </p>
      )}
      {multiline ? (
        <textarea
          id={ids.input}
          className="textarea"
          rows={4}
          value={draft}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
        />
      ) : (
        <input
          id={ids.input}
          className="input"
          type={hints?.type ?? 'text'}
          inputMode={hints?.inputMode}
          autoComplete={hints?.autoComplete ?? 'off'}
          spellCheck={type === 'text' ? undefined : false}
          value={draft}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
        />
      )}
      <ValidationMessage id={ids.message} result={result} />

      {type === 'description' && (
        <div className="translation stack">
          {canTranslate && !translation && (
            <button type="button" className="button button--secondary" disabled={pending} aria-busy={pending} onClick={() => void translate()}>
              {pending ? t('wizard.translating') : t('wizard.translate')}
            </button>
          )}
          <div aria-live="polite">
            {translateError && <StatusMessage tone="error">{t(translateError)}</StatusMessage>}
          </div>
          {translation && (
            <div className="notice stack">
              <label htmlFor={ids.translation}>{t('wizard.translationLabel')}</label>
              <MachineTranslatedLabel />
              <textarea
                id={ids.translation}
                className="textarea"
                rows={4}
                lang={translation.targetLanguage}
                value={translationDraft ?? translation.text}
                readOnly={translation.approved}
                onChange={(e) => setTranslationDraft(e.target.value)}
              />
              {translation.approved ? (
                <StatusMessage tone="success">{t('wizard.translationApproved')}</StatusMessage>
              ) : (
                <div className="actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => approveTranslation(store, ev.fieldId, translationDraft ?? translation.text)}
                  >
                    {t('wizard.approveTranslation')}
                  </button>
                  <button type="button" className="button button--quiet" onClick={() => discardTranslation(store, ev.fieldId)}>
                    {t('wizard.rejectTranslation')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
