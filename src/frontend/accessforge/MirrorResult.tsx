/**
 * src/frontend/accessforge/MirrorResult.tsx
 *
 * accessforge-skeleton task 16.8 (Requirements 3.3, 6.15, 10.8, 10.11,
 * 10.12, 11.1 to 11.5, 11.7). The end states of the agent loop: verified
 * completion with the Reference_Number exactly as read, not verified with
 * each difference by legacy label, unknown outcome with the duplicate
 * warning, and the stop, unreadable, page-changed and analysis-failed views.
 * The link to the FormBridge sample form is always shown and carries no answer.
 */

import { useId, useState } from 'react';
import type { AgentEvent, AgentState } from '../../lib/accessforge/agent-machine.js';
import { isValidReference, type Difference } from '../../lib/accessforge/verifier.js';
import { SAMPLE_FORM_PATH } from '../../shared/app-paths.js';
import { ScreenHeading } from '../components/ScreenHeading.js';
import { StatusMessage } from '../components/StatusMessage.js';
import { useTranslation } from '../i18n.js';
import { MIRROR_FORM_LANGUAGE, originalLabelOf } from './mirror-field-adapter.js';
import { DoItYourselfList } from './MirrorReview.js';

export interface MirrorResultProps {
  state: AgentState;
  dispatch: (e: AgentEvent) => void;
}

function SampleFormLink() {
  const { t } = useTranslation();
  return (
    <p>
      <a href={SAMPLE_FORM_PATH}>{t('accessforge.result.sampleForm')}</a>
    </p>
  );
}

function labelFor(state: AgentState, name: string): string {
  const f = state.fields.find((x) => x.entry.name === name);
  return f ? originalLabelOf(f) || name : name;
}

function DifferenceList({ state, differences }: { state: AgentState; differences: Difference[] }) {
  const { t } = useTranslation();
  return (
    <ul className="difference-list">
      {differences.map((d, i) => (
        <li key={i}>
          {d.kind === 'reference' ? (
            t('accessforge.result.reference', { reference: d.reference ?? '' })
          ) : d.kind === 'value' ? (
            <>
              <span lang={MIRROR_FORM_LANGUAGE}>{labelFor(state, d.name)}</span>{t('accessforge.error.mismatchRow', { label: '', intended: d.intended, readBack: d.received })}
            </>
          ) : (
            <span lang={MIRROR_FORM_LANGUAGE}>{labelFor(state, d.name)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Fields the app did not fill: skipped and do it yourself, or "every field was filled". */
function NotFilled({ state }: { state: AgentState }) {
  const { t } = useTranslation();
  const titleId = useId();
  const open = state.fields.filter((f) => f.status !== 'filled');
  return (
    <section aria-labelledby={titleId} className="stack">
      <h2 id={titleId}>{t('accessforge.result.notFilledTitle')}</h2>
      {open.length === 0 ? <p>{t('accessforge.result.allFilled')}</p> : <DoItYourselfList fields={open} />}
    </section>
  );
}

export function MirrorResult({ state, dispatch }: MirrorResultProps) {
  const { t } = useTranslation();
  const [showOriginal, setShowOriginal] = useState(false);
  const originalId = useId();
  const r = state.result;

  switch (state.phase) {
    case 'done': {
      const reference = r && isValidReference(r.reference) ? r.reference : null;
      return (
        <div className="mirror-result stack">
          <ScreenHeading focusKey="done">{t('accessforge.result.title')}</ScreenHeading>
          <StatusMessage tone="success">{t('accessforge.result.received')}</StatusMessage>
          <p>{t('accessforge.result.notAppointment')}</p>
          {reference && <p className="mirror-result__reference">{t('accessforge.result.reference', { reference })}</p>}
          {r?.originalText ? (
            <div className="stack">
              <button type="button" className="button button--quiet" aria-expanded={showOriginal} aria-controls={originalId} onClick={() => setShowOriginal((v) => !v)}>
                {showOriginal ? t('accessforge.result.hideOriginal') : t('accessforge.result.showOriginal')}
              </button>
              <div id={originalId} hidden={!showOriginal}>
                <p lang={MIRROR_FORM_LANGUAGE}>{r.originalText}</p>
              </div>
            </div>
          ) : (
            <StatusMessage tone="caution">{t('accessforge.result.originalUnavailable')}</StatusMessage>
          )}
          {state.pageNotice && <StatusMessage tone="caution">{t('accessforge.error.pageNotSupported')}</StatusMessage>}
          <NotFilled state={state} />
          <SampleFormLink />
        </div>
      );
    }
    case 'notVerified':
      return (
        <div className="mirror-result stack">
          <ScreenHeading focusKey="notVerified">{t('accessforge.result.title')}</ScreenHeading>
          <StatusMessage tone="error">{t('accessforge.result.notVerified')}</StatusMessage>
          <DifferenceList state={state} differences={r?.differences ?? []} />
          <SampleFormLink />
        </div>
      );
    case 'unknownOutcome':
      return (
        <div className="mirror-result stack">
          <ScreenHeading focusKey="unknown">{t('accessforge.result.title')}</ScreenHeading>
          <StatusMessage tone="caution">{t('accessforge.result.unknown')}</StatusMessage>
          <div className="actions">
            <button type="button" className="button button--secondary" onClick={() => dispatch({ type: 'TRY_AGAIN_PRESSED' })}>
              {t('accessforge.result.tryAgain')}
            </button>
          </div>
          <SampleFormLink />
        </div>
      );
    case 'stopped': {
      const key = state.stopReason === 'formTarget' ? 'accessforge.error.formTarget' : state.stopReason === 'pageChanged' ? 'accessforge.error.pageChanged' : 'accessforge.error.pageNotSupported';
      return (
        <div className="mirror-result stack">
          <ScreenHeading focusKey="stopped">{t('accessforge.title')}</ScreenHeading>
          <StatusMessage tone="error">{t(key)}</StatusMessage>
          <div className="actions">
            <button type="button" className="button" onClick={() => dispatch({ type: 'RELOAD_PRESSED' })}>
              {t('accessforge.error.reload')}
            </button>
          </div>
        </div>
      );
    }
    case 'analysisFailed':
      return (
        <div className="mirror-result stack">
          <ScreenHeading focusKey="analysisFailed">{t('accessforge.title')}</ScreenHeading>
          <StatusMessage tone="error">{t('accessforge.error.analysisFailed')}</StatusMessage>
          <div className="actions">
            <button type="button" className="button" onClick={() => dispatch({ type: 'RETRY_PRESSED' })}>
              {t('accessforge.error.retry')}
            </button>
            <button type="button" className="button button--quiet" onClick={() => dispatch({ type: 'CANCEL_PRESSED' })}>
              {t('accessforge.error.fillDirectly')}
            </button>
          </div>
        </div>
      );
    case 'unreadable':
    case 'versionUnsupported':
      return (
        <div className="mirror-result stack">
          <ScreenHeading focusKey={state.phase}>{t('accessforge.title')}</ScreenHeading>
          <StatusMessage tone="caution">{t(state.phase === 'unreadable' ? 'accessforge.error.cannotRead' : 'accessforge.error.pageChanged')}</StatusMessage>
        </div>
      );
    default:
      return null;
  }
}
