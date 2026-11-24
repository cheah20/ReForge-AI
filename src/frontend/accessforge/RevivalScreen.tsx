/**
 * src/frontend/accessforge/RevivalScreen.tsx
 *
 * accessforge-skeleton task 16.10 (Requirements 9.3, 12.4, 12.6, 14.1 to
 * 14.5, 14.10 to 14.12, 18.4). The AccessForge screen: the original page in
 * the Revival_Frame beside the Mirror at 1024 px and wider, a show/hide
 * control below that; the header with the language picker (locked while the
 * loop runs) and the larger-text option (memory only); the cancel question
 * as a modal dialog that returns focus to the control that opened it.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { fieldById, languageLocked, type AgentEvent, type AgentState } from '../../lib/accessforge/agent-machine.js';
import { LANGUAGE_REGISTRY } from '../../packs/language/registry.js';
import { ScreenHeading } from '../components/ScreenHeading.js';
import { StatusMessage } from '../components/StatusMessage.js';
import { useTranslation } from '../i18n.js';
import type { ChangeLanguage } from '../use-change-language.js';
import { MIRROR_FORM_LANGUAGE, originalLabelOf } from './mirror-field-adapter.js';
import { MirrorResult } from './MirrorResult.js';
import { MirrorReview } from './MirrorReview.js';
import { MirrorStep } from './MirrorStep.js';
import { DataNotice, ModeNotice, ScopeNotice } from './notices.js';
import { RevivalFrame } from './RevivalFrame.js';
import { useAgentLoop } from './useAgentLoop.js';
import { useLeaveWarning } from './useLeaveWarning.js';
import type { LoopDeps } from './loop-runner.js';
import './accessforge.css';

export interface RevivalScreenProps {
  changeLanguage: ChangeLanguage;
  /** The address named another site; nothing was loaded from it (Requirement 18.2). */
  foreignAddress?: boolean;
  /** Test overrides for the effect runner. */
  loopDeps?: Partial<LoopDeps>;
}

/** Answers exist and no confirmation has arrived (Requirement 12.5). */
export function hasUnsentAnswers(s: AgentState): boolean {
  if (s.confirmationReceived) return false;
  return s.fields.some((f) => f.answer !== undefined) || Object.keys(s.keptAnswers).length > 0;
}

/** The legacy labels of the fields the legacy error page named; names that match no field are left out. */
export function failingLabels(s: AgentState): string {
  return s.failingNames
    .flatMap((n) => {
      const f = s.fields.find((x) => x.entry.name === n);
      return f ? [originalLabelOf(f) || n] : [];
    })
    .join(', ');
}

export function MirrorHeader({ state, changeLanguage, largeText, onLargeText }: { state: AgentState; changeLanguage: ChangeLanguage; largeText: boolean; onLargeText: (on: boolean) => void }) {
  const { t, language } = useTranslation();
  const selectId = useId();
  const lockedId = useId();
  const locked = languageLocked(state);
  return (
    <header className="app-header">
      <div className="app-header__bar revival-header">
        <span className="app-header__name">
          {t('app.title')} <span className="revival-header__module">AccessForge</span>
        </span>
        <div className="app-header__language">
          <label htmlFor={selectId}>{t('nav.pickLanguage')}</label>
          <select
            id={selectId}
            className="select"
            value={language}
            disabled={locked || changeLanguage.busy}
            aria-describedby={locked ? lockedId : undefined}
            onChange={(e) => void changeLanguage.change(e.target.value)}
          >
            {LANGUAGE_REGISTRY.map((entry) => (
              <option key={entry.tag} value={entry.tag} lang={entry.tag}>
                {entry.nativeName}
              </option>
            ))}
          </select>
          {locked && (
            <p className="hint" id={lockedId}>
              {t('accessforge.language.locked')}
            </p>
          )}
        </div>
        <label className="checkbox-row revival-header__large">
          <input type="checkbox" checked={largeText} onChange={(e) => onLargeText(e.target.checked)} />
          <span>{t('accessforge.largerText')}</span>
        </label>
      </div>
      {state.analysisMode === 'mock' && <p className="demo-banner">{t('analysis.demoMode')}</p>}
    </header>
  );
}

/** The cancel question (Requirement 12.6). A native modal dialog traps focus; focus returns to the opener on close. */
function CancelDialog({ open, dispatch }: { open: boolean; dispatch: (e: AgentEvent) => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const bodyId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      opener.current = document.activeElement;
      if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
      } else dialog.setAttribute('open', '');
      dialog.querySelector<HTMLButtonElement>('button')?.focus();
    } else if (dialog.open || dialog.hasAttribute('open')) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="revival-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(e) => {
        e.preventDefault();
        dispatch({ type: 'CANCEL_DECLINED' });
      }}
    >
      <h2 id={titleId}>{t('accessforge.cancel.title')}</h2>
      <p id={bodyId}>{t('accessforge.cancel.body')}</p>
      <div className="actions">
        <button type="button" className="button button--secondary" onClick={() => dispatch({ type: 'CANCEL_DECLINED' })}>
          {t('accessforge.cancel.decline')}
        </button>
        <button type="button" className="button" onClick={() => dispatch({ type: 'CANCEL_CONFIRMED' })}>
          {t('accessforge.cancel.confirm')}
        </button>
      </div>
    </dialog>
  );
}

function MirrorContent({ state, dispatch, foreignAddress, onShowField }: { state: AgentState; dispatch: (e: AgentEvent) => void; foreignAddress: boolean; onShowField?: ((elementId: string) => void) | undefined }) {
  const { t } = useTranslation();
  const phase = state.phase === 'cancelConfirm' ? state.resumePhase ?? 'idle' : state.phase;
  const field = state.current ? fieldById(state, state.current) : undefined;

  if (phase === 'idle' || phase === 'notice') {
    return (
      <div className="stack">
        <ScreenHeading focusKey={phase}>{t('accessforge.title')}</ScreenHeading>
        <ScopeNotice foreignAddress={foreignAddress} />
        {phase === 'notice' ? (
          <DataNotice onAcknowledge={() => dispatch({ type: 'NOTICE_ACKNOWLEDGED' })} onDismiss={() => dispatch({ type: 'NOTICE_DISMISSED' })} />
        ) : (
          <div className="actions">
            <button type="button" className="button" disabled={state.frame !== 'register' || state.expectedLoad !== 'none'} onClick={() => dispatch({ type: 'REVIVE_PRESSED' })}>
              {t('accessforge.start')}
            </button>
          </div>
        )}
      </div>
    );
  }
  if (phase === 'extracting' || phase === 'analysing' || phase === 'reloading' || phase === 'errorReturned' || phase === 'verifyingResult') {
    const key = phase === 'errorReturned' ? 'accessforge.error.legacyRejected' : 'accessforge.analysing';
    const labels = failingLabels(state);

    return (
      <div className="stack" aria-busy="true">
        <ScreenHeading focusKey={phase}>{t('accessforge.title')}</ScreenHeading>
        <StatusMessage tone={phase === 'errorReturned' ? 'caution' : 'info'}>{t(key, { labels })}</StatusMessage>
      </div>
    );
  }
  if ((phase === 'asking' || phase === 'writing' || phase === 'verifying' || phase === 'halted') && field) {
    return (
      <div className="stack">
        {phase === 'halted' && (
          <div className="stack" role="alert">
            <StatusMessage tone="error">{t('accessforge.error.mismatch')}</StatusMessage>
            <ul>
              {state.mismatches.map((m) => {
                const f = fieldById(state, m.elementId);
                return (
                  <li key={m.elementId}>
                    <span lang={MIRROR_FORM_LANGUAGE}>{f ? originalLabelOf(f) : m.elementId}</span>
                    {t('accessforge.error.mismatchRow', { label: '', intended: String(m.intended), readBack: m.read === null ? '' : String(m.read) })}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {state.failingNames.length > 0 && phase === 'asking' && <StatusMessage tone="caution">{t('accessforge.error.legacyRejected', { labels: failingLabels(state) })}</StatusMessage>}
        <MirrorStep state={state} field={field} dispatch={dispatch} />
      </div>
    );
  }
  if (phase === 'review' || phase === 'rereading' || phase === 'submitting') return <MirrorReview state={state} dispatch={dispatch} onShowField={onShowField} />;
  return <MirrorResult state={state} dispatch={dispatch} />;
}

export function RevivalScreen({ changeLanguage, foreignAddress = false, loopDeps }: RevivalScreenProps) {
  const { t, language } = useTranslation();
  const { state, dispatch, frameRef, onFrameLoad, showField } = useAgentLoop(language, loopDeps);
  const [largeText, setLargeText] = useState(false);
  const [frameShown, setFrameShown] = useState(false);
  const frameId = useId();
  useLeaveWarning(hasUnsentAnswers(state));
  return (
    <div className={largeText ? 'revival revival--large' : 'revival'}>
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <MirrorHeader state={state} changeLanguage={changeLanguage} largeText={largeText} onLargeText={setLargeText} />
      <main id="main" className="revival__layout">
        <section className="revival__mirror stack" aria-label="AccessForge">
          <ModeNotice mode={state.analysisMode} />
          <MirrorContent
            state={state}
            dispatch={dispatch}
            foreignAddress={foreignAddress}
            onShowField={(elementId) => {
              // On a narrow screen the frame is hidden: show it now (not on the next render), then outline the field.
              flushSync(() => setFrameShown(true));
              showField(elementId);
            }}
          />
          <button type="button" className="button button--secondary revival__frame-toggle" aria-expanded={frameShown} aria-controls={frameId} onClick={() => setFrameShown((v) => !v)}>
            {frameShown ? t('accessforge.frame.hide') : t('accessforge.frame.show')}
          </button>
        </section>
        <div id={frameId} className={frameShown ? 'revival__frame revival__frame--shown' : 'revival__frame'}>
          {/* Hidden only by CSS below 1024 px: the frame stays loaded, so a toggle never changes a step or an answer. */}
          <RevivalFrame ref={frameRef} onLoad={onFrameLoad} />
        </div>
      </main>
      <CancelDialog open={state.phase === 'cancelConfirm'} dispatch={dispatch} />
    </div>
  );
}
