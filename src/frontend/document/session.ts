/**
 * src/frontend/document/session.ts
 *
 * The Document_Path session (formbridge-any-document Requirements 4.4, 4.5,
 * 4.8, 10.1, 10.2, 13.8, 13.9, 14.2, 16.2, design "Session additions"). Turns
 * the labels the user kept into ordinary wizard fields, so the existing
 * question wizard, validation and review run unchanged. Memory only: nothing
 * here touches storage or the network.
 */

import { DESCRIPTION_ANSWER_MAX, TEXT_ANSWER_MAX, type OcrLanguage } from '../../lib/document/limits.js';
import { initialReview, type KeptLabelItem, type ReviewItem } from '../../lib/document/review.js';
import type { Box, DocumentModel } from '../../lib/document/types.js';
import { translate } from '../../packs/language/registry.js';
import type { FieldAnalysis, FieldEvidence, LabelAnalysis } from '../../shared/types.js';
import { createSession, type FieldState, type SessionState } from '../state.js';

/** Where a wizard question came from: the Kept_Label and its page. Local only, never sent. */
export interface DocumentLabelOrigin {
  labelId: string;
  pageNumber: number;
  lineIndex: number;
  /** The Kept_Label text shown on the Label_Review at confirm time. */
  text: string;
  textLang: string;
  checkYourself: boolean;
  /** Validated AI explanation, at most 200 characters. */
  explanation?: string;
  /** Validated AI Fictional_Example, at most 60 characters. */
  example?: string;
}

export type DocumentMode = 'ai' | 'original-label';

export interface DocumentSession {
  model: DocumentModel;
  review: ReviewItem[];
  /** The OCR_Language, a separate setting from the Interface_Language and the Form_Language (10.1). */
  ocrLanguage: OcrLanguage | null;
  mode: DocumentMode;
  /** True when no request was sent at all (12.8): the review notice says nothing was sent. */
  nothingSent: boolean;
}

export function startDocumentSession(model: DocumentModel, ocrLanguage: OcrLanguage | null): DocumentSession {
  return { model, review: initialReview(model.candidates), ocrLanguage, mode: 'ai', nothingSent: false };
}

/** Changing the OCR_Language changes nothing else (Requirement 10.1). */
export function setOcrLanguage(state: SessionState, ocrLanguage: OcrLanguage): SessionState {
  return state.document ? { ...state, document: { ...state.document, ocrLanguage } } : state;
}

/**
 * A new file, a reload or a close discards the previous model, its previews,
 * its answers and its fields (Requirement 4.8). The interface language stays.
 * `revoke` is called for every preview URL.
 */
export function discardDocument(state: SessionState, revoke: (url: string) => void): SessionState {
  for (const page of state.document?.model.pages ?? []) if (page.preview) revoke(page.preview.url);
  return { ...createSession(state.interfaceLanguage), analysisCache: state.analysisCache, demoMode: state.demoMode };
}

const clip = (s: string, max: number) => [...s].slice(0, max).join('');

/** The question asked in Original_Label_Mode: a locale sentence that quotes the label unchanged (14.2). */
export function originalLabelQuestion(labelText: string, interfaceLanguage: string): string {
  return translate(interfaceLanguage, 'document.originalMode.question', { label: labelText });
}

/** Original_Label_Mode analysis: the label as the human label, the quoting sentence as the question, type text, confidence 0. */
export function originalLabelAnalysis(item: KeptLabelItem, interfaceLanguage: string): FieldAnalysis {
  return {
    fieldId: item.labelId,
    humanLabel: clip(item.text, 40),
    question: originalLabelQuestion(item.text, interfaceLanguage),
    answerType: 'text',
    confidence: 0,
  };
}

function analysisFrom(a: LabelAnalysis): FieldAnalysis {
  return { fieldId: a.fieldId, humanLabel: a.humanLabel, question: a.question, answerType: a.answerType, confidence: a.confidence };
}

export interface FieldSource {
  kept: KeptLabelItem;
  /** Where the line sits on its page, for the widget record. */
  box: Box;
  textLang: string;
  checkYourself: boolean;
}

/**
 * One wizard field per Kept_Label, by the table in the design: the Label_Id is
 * the field id, a signature is a review-only field, every answer is required
 * (the user can still skip), and the answer length is bounded at 200 code
 * points, or 2,000 for a description (16.2). The label text is also the
 * tooltip so a printed date format can be read; it is never sent.
 */
export function fieldFromKeptLabel(source: FieldSource, interfaceLanguage: string, analysis: LabelAnalysis | null): FieldState {
  const { kept } = source;
  const useAi = analysis !== null;
  const answerType = analysis?.answerType ?? 'text';
  const evidence: FieldEvidence = {
    fieldId: kept.labelId,
    tooltip: kept.text,
    fieldType: answerType === 'signature' ? 'signature' : 'text',
    required: true,
    readOnly: false,
    maxLength: answerType === 'description' ? DESCRIPTION_ANSWER_MAX : TEXT_ANSWER_MAX,
    widgets: [{ pageNumber: kept.pageNumber, bbox: source.box, pageSnippet: '' }],
    hasValue: false,
  };
  const origin: DocumentLabelOrigin = {
    labelId: kept.labelId,
    pageNumber: kept.pageNumber,
    lineIndex: kept.readingOrder,
    text: kept.text,
    textLang: source.textLang,
    checkYourself: source.checkYourself,
    ...(analysis?.explanation ? { explanation: analysis.explanation } : {}),
    ...(analysis?.example ? { example: analysis.example } : {}),
  };
  return {
    evidence,
    analysis: useAi ? analysisFrom(analysis) : originalLabelAnalysis(kept, interfaceLanguage),
    status: 'mapped',
    skipped: false,
    origin,
  };
}

export interface BuildFieldsInput {
  model: DocumentModel;
  kept: readonly KeptLabelItem[];
  /** Validated analyses by Label_Id; a Kept_Label with none is asked in Original_Label_Mode (13.8). */
  analyses: ReadonlyMap<string, LabelAnalysis>;
  interfaceLanguage: string;
}

/** Fields for every Kept_Label in page and reading order. A Kept_Label with no analysis becomes an Original_Label_Mode question (13.8). */
export function buildDocumentFields({ model, kept, analyses, interfaceLanguage }: BuildFieldsInput): FieldState[] {
  const ordered = [...kept].sort((a, b) => a.pageNumber - b.pageNumber || a.readingOrder - b.readingOrder);
  return ordered.map((item) => {
    const page = model.pages.find((p) => p.pageNumber === item.pageNumber);
    const line = page?.lines.find((l) => l.index === item.readingOrder);
    const candidate = model.candidates.find((c) => c.labelId === item.labelId);
    return fieldFromKeptLabel(
      {
        kept: item,
        box: line?.box ?? { left: 0, top: 0, right: 0, bottom: 0 },
        textLang: candidate?.textLang ?? 'und',
        checkYourself: candidate?.checkYourself ?? false,
      },
      interfaceLanguage,
      analyses.get(item.labelId) ?? null,
    );
  });
}
