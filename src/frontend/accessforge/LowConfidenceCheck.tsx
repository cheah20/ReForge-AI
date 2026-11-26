/**
 * src/frontend/accessforge/LowConfidenceCheck.tsx
 *
 * accessforge-skeleton task 26.2 (Slice 2, Requirement 6.18). A question whose
 * confidence is below 0.7 is shown with the original wording of the old page
 * and two choices before any answer input appears: accept the question, or
 * decline it and fill the field in yourself on the old page. Declining marks
 * the field do it yourself; nothing is written either way.
 * Plan text is rendered as React text only.
 */

import { useTranslation } from '../i18n.js';
import { ScreenHeading } from '../components/ScreenHeading.js';
import { MachineTranslatedLabel } from '../components/MachineTranslatedLabel.js';
import { stepInfo, type AgentEvent, type AgentState, type MirrorField } from '../../lib/accessforge/agent-machine.js';
import { LowConfidenceEvidence } from './MirrorStep.js';
import { PlanText } from './PlanText.js';

export interface LowConfidenceCheckProps {
  state: AgentState;
  field: MirrorField;
  dispatch: (event: AgentEvent) => void;
}

export function LowConfidenceCheck({ state, field, dispatch }: LowConfidenceCheckProps) {
  const { t } = useTranslation();
  const info = stepInfo(state);
  return (
    <form className="mirror-step stack" data-element-id={field.elementId} data-low-confidence-check="" onSubmit={(e) => e.preventDefault()} noValidate>
      <p className="mirror-step__counter">{info ? t('accessforge.step', { current: info.index, total: info.total }) : null}</p>
      <ScreenHeading focusKey={field.elementId}>
        <PlanText field={field}>{field.plan!.humanLabel}</PlanText>
      </ScreenHeading>
      <LowConfidenceEvidence field={field} />
      <div className="question__text">
        <h2 className="question__title">
          <PlanText field={field}>{field.plan!.question}</PlanText>
        </h2>
        {state.analysisMode !== 'heuristic' && <MachineTranslatedLabel />}
      </div>
      <div className="actions actions--split">
        <button type="button" className="button" onClick={() => dispatch({ type: 'LOW_CONFIDENCE_ACCEPTED' })}>
          {t('wizard.confirmQuestion')}
        </button>
        <button type="button" className="button button--secondary" onClick={() => dispatch({ type: 'LOW_CONFIDENCE_DECLINED' })}>
          {t('accessforge.lowConfidence.decline')}
        </button>
      </div>
      <button type="button" className="button button--quiet" onClick={() => dispatch({ type: 'CANCEL_PRESSED' })}>
        {t('accessforge.step.cancel')}
      </button>
    </form>
  );
}
