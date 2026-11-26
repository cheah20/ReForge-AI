/**
 * src/frontend/document/LabelReview.tsx
 *
 * The Label_Review (formbridge-any-document Requirements 12, 13): the user taps
 * the lines that are form labels; nothing is ticked at the start. Only the
 * ticked words, after the user's edits, go to the AI service, once the user
 * presses the send button. "Continue without AI" sends nothing at all.
 */

import { useId, useState } from 'react';
import { buildLabelAnalysisRequests } from '../../lib/document/request.js';
import { groupForReview } from '../../lib/document/review-order.js';
import { keptLabels, reduceReview, selectedCount, type ReviewAction } from '../../lib/document/review.js';
import { isValueLikeText } from '../../lib/document/value-rules.js';
import { PageCropButton } from '../components/PageCropButton.js';
import { ScreenHeading } from '../components/ScreenHeading.js';
import { StatusMessage } from '../components/StatusMessage.js';
import { useServices, useSession } from '../app-context.js';
import { useTranslation } from '../i18n.js';
import { detectionNeedsConfirmation } from '../state.js';
import { analyzeKeptLabels, type FetchFn } from './label-client.js';
import { pluralKey } from './plural.js';
import { labelRequestFetch } from './services.js';
import { buildDocumentFields } from './session.js';
import './document.css';

export interface LabelReviewProps {
  /** True when the form language and country must be confirmed before the questions. */
  onDone: (needsConfirmation: boolean) => void;
  onBack: () => void;
  /** Replaces the browser's fetch (tests). */
  fetchFn?: FetchFn;
}

export function LabelReview({ onDone, onBack, fetchFn }: LabelReviewProps) {
  const { t, language } = useTranslation();
  const { store } = useServices();
  const session = useSession();
  const doc = session.document;
  const [busy, setBusy] = useState<{ current: number; total: number } | null>(null);
  const [showNone, setShowNone] = useState(false);
  const countId = useId();

  if (!doc) return null;
  const items = doc.review;
  const count = selectedCount(items);
  const kept = keptLabels(items);
  const unreadable = doc.model.pages.filter((p) => p.status !== 'ready' && p.status !== 'low-quality');

  const dispatch = (action: ReviewAction) =>
    store.set((s) => (s.document ? { ...s, document: { ...s.document, review: reduceReview(s.document.review, action) } } : s));

  function finish(
    analyses: Map<string, import('../../shared/types.js').LabelAnalysis>,
    mode: 'ai' | 'original-label',
    nothingSent: boolean,
    detection: import('../state.js').Detection | null,
    demoMode: boolean,
  ) {
    const s = store.get();
    if (!s.document) return;
    const fields = buildDocumentFields({ model: s.document.model, kept, analyses, interfaceLanguage: s.interfaceLanguage });
    const needs = mode === 'original-label' || (detection ? detectionNeedsConfirmation(detection) : true);
    store.set((st) => ({
      ...st,
      fields,
      currentStep: 0,
      detection,
      formLanguage: detection ? detection.formLanguage : st.formLanguage,
      formCountry: detection ? detection.formCountry : st.formCountry || 'MY',
      needsConfirmation: needs,
      demoMode: st.demoMode || demoMode,
      document: st.document ? { ...st.document, mode, nothingSent } : st.document,
    }));
    onDone(needs);
  }

  async function send() {
    if (kept.length === 0) {
      setShowNone(true);
      return;
    }
    setShowNone(false);
    const s = store.get();
    const requests = buildLabelAnalysisRequests(kept, { interfaceLanguage: s.interfaceLanguage, ...(s.formLanguage ? { formLanguage: s.formLanguage } : {}), ...(s.formCountry ? { formCountry: s.formCountry } : {}) });
    setBusy({ current: 0, total: requests.length });
    const result = await analyzeKeptLabels(requests, fetchFn ?? labelRequestFetch(), (current, total) => setBusy({ current, total }));
    setBusy(null);
    if (result.mode === 'ai') finish(result.analyses, 'ai', false, result.detection, result.demoMode);
    else finish(new Map(), 'original-label', false, null, false);
  }

  function withoutAi() {
    if (kept.length === 0) {
      setShowNone(true);
      return;
    }
    finish(new Map(), 'original-label', true, null, false);
  }

  const groups = groupForReview(doc.model.candidates);
  const byId = new Map(items.map((i) => [i.labelId, i] as const));
  const isItem = (i: (typeof items)[number] | undefined): i is (typeof items)[number] => i !== undefined;
  const renderRow = (item: (typeof items)[number]) => {
    const textId = `lr-text-${item.labelId}`;
    const stateId = `lr-state-${item.labelId}`;
    const blocked = item.blockedValueLike || isValueLikeText(item.text);
    // The crop shows the line as it was read from the page, whatever the user has typed since (Requirement 12.2).
    const candidate = doc.model.candidates.find((c) => c.labelId === item.labelId);
    const page = candidate ? doc.model.pages.find((p) => p.pageNumber === candidate.pageNumber) : undefined;
    const line = candidate ? page?.lines.find((l) => l.index === candidate.lineIndex) : undefined;
    return (
      <li key={item.labelId} className="review-item label-review__row">
        {candidate && page?.preview && line && (
          <div className="label-review__crop">
            <PageCropButton text={candidate.text} textLang={candidate.textLang || undefined} pageNumber={candidate.pageNumber} page={page} preview={page.preview} box={line.box} />
          </div>
        )}
        <label htmlFor={textId}>{t('document.review.textLabel', { page: item.pageNumber })}</label>
        <input
          id={textId}
          className="input"
          type="text"
          value={item.text}
          lang={doc.model.candidates.find((c) => c.labelId === item.labelId)?.textLang || undefined}
          onChange={(e) => dispatch({ type: 'edit', labelId: item.labelId, text: e.target.value })}
        />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={item.selected}
            disabled={blocked && !item.selected}
            aria-labelledby={`${stateId} ${textId}`}
            onChange={() => dispatch({ type: 'toggle', labelId: item.labelId })}
          />
          <span id={stateId}>{t(item.selected ? 'document.review.selected' : 'document.review.notSelected')}</span>
        </label>
        {blocked && <p className="hint">{t('document.review.valueNotSent')}</p>}
        {item.text.trim() === '' && <p className="hint">{t('document.review.emptyText')}</p>}
      </li>
    );
  };

  return (
    <>
      <ScreenHeading>{t('document.review.title')}</ScreenHeading>
      <div className="notice">
        <p>{t('document.review.privacyNotice')}</p>
      </div>
      <p>{t('document.review.intro')}</p>
      <p>{t('document.review.instruction')}</p>
      <p className="hint">{t('document.review.valueNotSent')}</p>
      {unreadable.map((p) => (
        <StatusMessage key={p.pageNumber} tone="caution">
          {t('document.review.pageNotChecked', { page: p.pageNumber })}
        </StatusMessage>
      ))}

      <h2>{t('document.review.group.questions')}</h2>
      <ol className="review-list label-review">{groups.prompts.map((c) => byId.get(c.labelId)).filter(isItem).map(renderRow)}</ol>
      {groups.others.length > 0 && (
        <details className="label-review__others">
          <summary>{t('document.review.group.others')}</summary>
          <ol className="review-list label-review">{groups.others.map((c) => byId.get(c.labelId)).filter(isItem).map(renderRow)}</ol>
        </details>
      )}

      <p id={countId} aria-live="polite">
        {t(pluralKey('document.review.count', count, language), { count })}
      </p>
      {showNone && <StatusMessage tone="error">{t('document.review.selectAtLeastOne')}</StatusMessage>}
      <div aria-live="polite">{busy && <StatusMessage tone="info">{t('document.analysis.batch', busy)}</StatusMessage>}</div>

      <div className="actions">
        <button type="button" className="button" disabled={busy !== null} aria-describedby={countId} onClick={() => void send()}>
          {t(pluralKey('document.review.send', count, language), { count })}
        </button>
        <button type="button" className="button button--secondary" disabled={busy !== null} onClick={withoutAi}>
          {t('document.review.noAi')}
        </button>
        <button type="button" className="button button--quiet" disabled={busy !== null} onClick={onBack}>
          {t('document.ocr.backToStart')}
        </button>
      </div>
    </>
  );
}
