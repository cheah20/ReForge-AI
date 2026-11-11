/**
 * src/frontend/screens/QuestionWizard.tsx
 *
 * Screen 6 (tasks 31.1, 31.4, 31.6): one field per step.
 * - Fill-yourself, read-only and signature fields are not asked; review lists them.
 * - Validation runs on blur and on Next with the form's country pack; Next is
 *   blocked while the answer is invalid. "Skip this field" leaves it untouched.
 * - Back never loses answers. Focus moves to the step heading on every step.
 * - The language switch in the header changes questions, never answers.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ValidationResult } from '../../packs/country/interface.js';
import type { DateFormat } from '../../packs/country/dates.js';
import type { AnswerType } from '../../shared/types.js';
import { useServices, useSession } from '../app-context.js';
import { FieldQuestion } from '../components/FieldQuestion.js';
import { ScreenHeading } from '../components/ScreenHeading.js';
import { useTranslation } from '../i18n.js';
import { setAnswer, setDateFormat, setStep, skipField } from '../state.js';
import { answerTypeOf, needsDateFormatChoice, validateFieldAnswer, wizardSteps } from '../wizard-logic.js';

const isChoice = (type: AnswerType) => type === 'checkbox' || type === 'radio' || type === 'dropdown';

/**
 * The message after a blur or a choice. A blur only adds or changes a
 * problem; it never removes one. Removing the error on blur made the Next
 * button jump up under the pointer, so the click that caused the blur missed
 * it and a corrected IC number could not be submitted with the mouse.
 * Choices (a click on the option itself) update at once.
 */
export function resultOnCommit(
  type: AnswerType,
  value: string,
  result: ValidationResult,
  previous: ValidationResult | null,
): ValidationResult | null {
  if (isChoice(type)) return result;
  if (!result.valid && value !== '') return result;
  return previous;
}

/** While typing: the error goes away as soon as the answer is valid; a new error waits for blur or Next. */
export function resultOnChange(result: ValidationResult, previous: ValidationResult | null): ValidationResult | null {
  return previous && !previous.valid && result.valid ? null : previous;
}

export interface QuestionWizardProps {
  onDone: () => void;
  onBackToStart: () => void;
}

export function QuestionWizard({ onDone, onBackToStart }: QuestionWizardProps) {
  const { t } = useTranslation();
  const { store } = useServices();
  const session = useSession();
  const steps = useMemo(() => wizardSteps(session.fields), [session.fields]);
  const stepIndex = Math.min(session.currentStep, Math.max(steps.length - 1, 0));
  const field = steps.length ? session.fields[steps[stepIndex]!] : undefined;

  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');

  const fieldId = field?.evidence.fieldId;
  // Load the saved answer when the step changes (not when the language changes).
  useEffect(() => {
    const f = store.get().fields.find((x) => x.evidence.fieldId === fieldId);
    setDraft(f?.rawAnswer ?? '');
    setResult(null);
  }, [fieldId, store]);

  useEffect(() => {
    if (steps.length === 0) onDone();
  }, [steps.length, onDone]);

  if (!field) return null;

  const validate = (value: string) =>
    validateFieldAnswer(field, value, { formCountry: session.formCountry });

  function commit(value: string) {
    setResult((previous) => resultOnCommit(answerTypeOf(field!), value, validate(value), previous));
  }

  function go(to: number, dir: 'forward' | 'back') {
    setDirection(dir);
    if (to >= steps.length) onDone();
    else setStep(store, to);
  }

  function next() {
    const r = validate(draft);
    setResult(r);
    if (!r.valid) return;
    if (r.normalizedValue === '' && draft.trim() === '') {
      // An optional field left blank counts as skipped: nothing is written.
      skipField(store, field!.evidence.fieldId);
    } else {
      setAnswer(store, field!.evidence.fieldId, draft, r.normalizedValue ?? draft);
    }
    go(stepIndex + 1, 'forward');
  }

  function chooseDateFormat(format: DateFormat) {
    // Asked once per form: every date field still without a format gets this one.
    const ids = store
      .get()
      .fields.filter((f) => needsDateFormatChoice(f))
      .map((f) => f.evidence.fieldId);
    setDateFormat(store, ids, format);
  }

  const lowConfidencePending = field.status === 'low-confidence' && !confirmed.has(field.evidence.fieldId);
  const formatPending = needsDateFormatChoice(field);

  return (
    <>
      <p className="step-counter">{t('wizard.step', { current: stepIndex + 1, total: steps.length })}</p>
      <ScreenHeading focusKey={stepIndex}>{field.analysis?.humanLabel ?? field.evidence.fieldId}</ScreenHeading>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!lowConfidencePending && !formatPending) next();
        }}
      >
        <div key={stepIndex} className={`question-card question-card--${direction}`} data-field-id={field.evidence.fieldId}>
          <FieldQuestion
            field={field}
            draft={draft}
            onDraftChange={(v) => {
              setDraft(v);
              setResult((previous) => resultOnChange(validate(v), previous));
            }}
            onCommit={commit}
            result={result}
            formLanguage={session.formLanguage}
            formCountry={session.formCountry}
            interfaceLanguage={session.interfaceLanguage}
            confirmed={confirmed.has(field.evidence.fieldId)}
            onConfirm={() => setConfirmed((s) => new Set([...s, field.evidence.fieldId]))}
            onChooseDateFormat={chooseDateFormat}
          />
        </div>

        <div className="actions actions--wizard">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => (stepIndex === 0 ? onBackToStart() : go(stepIndex - 1, 'back'))}
          >
            {t('wizard.back')}
          </button>
          <button type="submit" className="button" disabled={lowConfidencePending || formatPending}>
            {t('wizard.next')}
          </button>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              skipField(store, field.evidence.fieldId);
              go(stepIndex + 1, 'forward');
            }}
          >
            {t('wizard.skip')}
          </button>
        </div>
      </form>
    </>
  );
}
