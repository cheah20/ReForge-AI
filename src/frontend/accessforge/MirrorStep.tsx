/**
 * src/frontend/accessforge/MirrorStep.tsx
 *
 * accessforge-skeleton task 16.7 (Requirements 6.9, 6.11, 6.17, 9.1, 9.2,
 * 9.5 to 9.8, 9.14, 14.1, 14.6, 14.7). One question step of the Mirror:
 * step indicator, the question, back, next and cancel.
 *
 * - Text, IC, phone, postcode, radio and select use FormBridge's
 *   `FieldQuestion` through the adapter; date and consent use their own
 *   small components built from the shared parts.
 * - Pressing next (or Enter) only asks the agent loop to validate and write;
 *   it can never submit the legacy form.
 * - Plan text is rendered as React text only, never as HTML or a link.
 */

import { useEffect, useId, useState, type FormEvent } from 'react';
import { DATE_EXAMPLES, DATE_FORMATS, type DateFormat } from '../../packs/country/dates.js';
import type { ValidationResult } from '../../packs/country/interface.js';
import { canSkip, isLowConfidence, needsConfidenceCheck, stepInfo, type AgentEvent, type AgentState, type MirrorField } from '../../lib/accessforge/agent-machine.js';
import { detectLegacyDateFormat, type DateParts, type MirrorAnswer } from '../../lib/accessforge/transformations.js';
import { FieldQuestion } from '../components/FieldQuestion.js';
import { MachineTranslatedLabel } from '../components/MachineTranslatedLabel.js';
import { ScreenHeading } from '../components/ScreenHeading.js';
import { StatusMessage } from '../components/StatusMessage.js';
import { ValidationMessage } from '../components/ValidationMessage.js';
import { useTranslation } from '../i18n.js';
import { LowConfidenceCheck } from './LowConfidenceCheck.js';
import { fixedQuestionProps, MIRROR_FORM_LANGUAGE, originalLabelOf, toFieldState } from './mirror-field-adapter.js';

export interface MirrorStepProps {
  state: AgentState;
  field: MirrorField;
  dispatch: (event: AgentEvent) => void;
}

/** The step's error as the shared ValidationMessage expects it. */
export function resultOf(field: MirrorField): ValidationResult | null {
  if (!field.error) return null;
  return {
    valid: false,
    messageKey: field.error.messageKey,
    ...(field.error.messageParams ? { messageParams: field.error.messageParams } : {}),
    ...(field.error.needs ? { needs: field.error.needs } : {}),
  };
}

/** Requirement 6.11: below 0.7, the original legacy wording with lang="ms" and a check notice. */
export function LowConfidenceEvidence({ field }: { field: MirrorField }) {
  const { t } = useTranslation();
  if (!isLowConfidence(field)) return null;
  const { labelText, neighbourText, nearbyText } = field.entry;
  const items = [labelText, neighbourText, nearbyText].map((s) => s.trim()).filter((s, i, all) => s !== '' && all.indexOf(s) === i);
  return (
    <div className="notice notice--caution stack">
      <StatusMessage tone="caution">{t('accessforge.lowConfidence')}</StatusMessage>
      {items.length > 0 && (
        <ul className="mirror-evidence">
          {items.map((text) => (
            <li key={text} lang={MIRROR_FORM_LANGUAGE}>
              {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuestionTitle({ field, id, machineTranslated = true }: { field: MirrorField; id?: string; machineTranslated?: boolean }) {
  const { t } = useTranslation();
  const original = originalLabelOf(field);
  return (
    <div className="question__text">
      <h2 className="question__title" id={id}>
        {field.plan!.question}
      </h2>
      {machineTranslated && <MachineTranslatedLabel />}
      {original && (
        <p className="hint">
          {t('wizard.originalLabel', { label: '' })}
          <span lang={MIRROR_FORM_LANGUAGE}>{original}</span>
        </p>
      )}
      {field.entry.required && <p className="hint">{t('wizard.required')}</p>}
    </div>
  );
}

interface DateQuestionProps {
  field: MirrorField;
  parts: DateParts;
  onChange: (parts: DateParts) => void;
  chosenFormat: DateFormat | null;
  onChooseFormat: (format: DateFormat) => void;
  /** False in `heuristic` mode: the question is the page's own wording, not a machine translation. */
  machineTranslated?: boolean;
}

/** Requirement 9.7: three inputs, the stated format, and a format choice when the page states none or several. */
export function DateQuestion({ field, parts, onChange, chosenFormat, onChooseFormat, machineTranslated = true }: DateQuestionProps) {
  const { t } = useTranslation();
  const ids = { title: useId(), day: useId(), month: useId(), year: useId(), format: useId(), message: useId() };
  const detected = detectLegacyDateFormat(field.entry);
  const format = chosenFormat ?? (detected === 'ambiguous' ? undefined : detected);
  const result = resultOf(field);
  const invalid = !!result && !result.needs;
  const describedBy = [format ? ids.format : '', ids.message].filter(Boolean).join(' ');
  const input = (key: keyof DateParts, id: string, label: string, size: number) => (
    <div className="date-part">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input input--short"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        size={size}
        value={parts[key]}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange({ ...parts, [key]: e.target.value })}
      />
    </div>
  );
  return (
    <div className="question">
      <fieldset className="date-group" aria-describedby={describedBy}>
        <legend className="question__legend">
          <QuestionTitle field={field} id={ids.title} machineTranslated={machineTranslated} />
        </legend>
        {format && (
          <p className="hint" id={ids.format}>
            {t('accessforge.date.format', { format })}
          </p>
        )}
        <div className="date-parts">
          {input('day', ids.day, t('accessforge.date.day'), 2)}
          {input('month', ids.month, t('accessforge.date.month'), 2)}
          {input('year', ids.year, t('accessforge.date.year'), 4)}
        </div>
      </fieldset>
      {!format && (
        <fieldset className="choice-group">
          <legend>{t('validation.date.chooseFormat')}</legend>
          {DATE_FORMATS.map((f) => (
            <label key={f} className="choice-option">
              <input type="radio" name={`${ids.title}-format`} value={f} checked={chosenFormat === f} onChange={() => onChooseFormat(f)} />
              <span>
                {f} <span className="hint">({DATE_EXAMPLES[f]})</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <ValidationMessage id={ids.message} result={result} />
    </div>
  );
}

/** Requirement 9.8: one unticked checkbox, the statement in the interface language, the original wording on request. */
export function ConsentQuestion({ field, checked, onChange, machineTranslated = true }: { field: MirrorField; checked: boolean; onChange: (checked: boolean) => void; machineTranslated?: boolean }) {
  const { t } = useTranslation();
  const ids = { box: useId(), message: useId(), original: useId() };
  const [showOriginal, setShowOriginal] = useState(false);
  const result = resultOf(field);
  const original = [originalLabelOf(field), field.entry.nextRowText.trim()].filter(Boolean).join(' ');
  return (
    <div className="question">
      <div className="question__text">
        <h2 className="question__title">{field.plan!.question}</h2>
        {machineTranslated && <MachineTranslatedLabel />}
      </div>
      <label className="checkbox-row" htmlFor={ids.box}>
        <input
          id={ids.box}
          type="checkbox"
          checked={checked}
          aria-describedby={ids.message}
          aria-invalid={(!!result && !result.needs) || undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{field.plan!.humanLabel}</span>
      </label>
      <ValidationMessage id={ids.message} result={result} />
      {original && (
        <div className="stack">
          <button type="button" className="button button--quiet" aria-expanded={showOriginal} aria-controls={ids.original} onClick={() => setShowOriginal((v) => !v)}>
            {showOriginal ? t('accessforge.step.hideOriginal') : t('accessforge.step.showOriginal')}
          </button>
          <div id={ids.original} hidden={!showOriginal}>
            <p lang={MIRROR_FORM_LANGUAGE}>{original}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function initialDraft(field: MirrorField): { text: string; parts: DateParts; checked: boolean } {
  const a = field.answer;
  return {
    text: a?.kind === 'text' || a?.kind === 'option' ? a.value : '',
    parts: a?.kind === 'date' ? a.parts : { day: '', month: '', year: '' },
    checked: a?.kind === 'consent' ? a.checked : false,
  };
}

export function MirrorStep({ state, field, dispatch }: MirrorStepProps) {
  const { t, language } = useTranslation();
  const [draft, setDraft] = useState(() => initialDraft(field));
  // A new step (or a re-opened one) starts from the kept answer.
  useEffect(() => setDraft(initialDraft(field)), [field.elementId]);
  const info = stepInfo(state);
  const busy = state.phase === 'writing' || state.phase === 'verifying';
  const type = field.plan!.answerType;
  const isDate = type === 'date';
  const isConsent = field.entry.control === 'checkbox';

  // Slice 2 (Requirement 6.18): a low-confidence question is accepted or declined before its input shows.
  if (needsConfidenceCheck(field)) return <LowConfidenceCheck state={state} field={field} dispatch={dispatch} />;

  function answer(): MirrorAnswer {
    if (isDate) return { kind: 'date', parts: draft.parts };
    if (isConsent) return { kind: 'consent', checked: draft.checked };
    if (field.entry.control === 'radio' || field.entry.control === 'select') return { kind: 'option', value: draft.text };
    return { kind: 'text', value: draft.text };
  }

  function next(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    dispatch({ type: 'NEXT_PRESSED', answer: answer() });
  }

  return (
    <form className="mirror-step stack" data-element-id={field.elementId} onSubmit={next} noValidate>
      <p className="mirror-step__counter">{info ? t('accessforge.step', { current: info.index, total: info.total }) : null}</p>
      <ScreenHeading focusKey={field.elementId}>{field.plan!.humanLabel}</ScreenHeading>
      <LowConfidenceEvidence field={field} />
      {isDate ? (
        <DateQuestion
          field={field}
          parts={draft.parts}
          onChange={(parts) => setDraft((d) => ({ ...d, parts }))}
          chosenFormat={state.dateFormat}
          onChooseFormat={(format) => dispatch({ type: 'DATE_FORMAT_CHOSEN', format })}
          machineTranslated={state.analysisMode !== 'heuristic'}
        />
      ) : isConsent ? (
        <ConsentQuestion field={field} checked={draft.checked} onChange={(checked) => setDraft((d) => ({ ...d, checked }))} machineTranslated={state.analysisMode !== 'heuristic'} />
      ) : (
        <FieldQuestion
          field={toFieldState(field)}
          draft={draft.text}
          onDraftChange={(text) => setDraft((d) => ({ ...d, text }))}
          onCommit={() => {}}
          result={resultOf(field)}
          {...fixedQuestionProps(language)}
        />
      )}
      <div className="actions actions--split">
        <button type="button" className="button button--secondary" disabled={!info || info.index === 1 || busy} onClick={() => dispatch({ type: 'BACK_PRESSED' })}>
          {t('accessforge.step.back')}
        </button>
        <button type="submit" className="button" disabled={busy} aria-busy={busy || undefined}>
          {t('accessforge.step.next')}
        </button>
      </div>
      {canSkip(field) && (
        <button type="button" className="button button--quiet" disabled={busy} onClick={() => dispatch({ type: 'SKIP_PRESSED' })}>
          {t('wizard.skip')}
        </button>
      )}
      <button type="button" className="button button--quiet" onClick={() => dispatch({ type: 'CANCEL_PRESSED' })}>
        {t('accessforge.step.cancel')}
      </button>
    </form>
  );
}
