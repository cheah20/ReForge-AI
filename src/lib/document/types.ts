/**
 * src/lib/document/types.ts
 *
 * The Document_Model of the FormBridge Document_Path (formbridge-any-document
 * design "Data Models"). Browser only, never serialised to any destination.
 * A fillable PDF never becomes a DocumentModel: it keeps the existing
 * ExtractedForm path (Requirement 5.1).
 */

export type { OcrLanguage } from './limits.js';

/** Top-left origin, y down, upright as displayed. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type PageTextSource = 'text-layer' | 'ocr';
export type Rotation = 0 | 90 | 180 | 270;

export interface TextLine {
  /** Reading-order index, unique within the page, 0-based. */
  index: number;
  text: string;
  /** 0 <= left <= right <= page.width, 0 <= top <= bottom <= page.height. */
  box: Box;
  /** 0..1, only for `ocr` pages. */
  confidence?: number;
}

/** A ruled or boxed region where a person writes an answer (Tier B detector fills it). */
export interface AnswerArea {
  kind: 'underline' | 'box' | 'leader' | 'after-colon';
  box: Box;
}

export type PageStatus = 'ready' | 'low-quality' | 'skipped-too-large' | 'failed' | 'classifier-failed' | 'needs-connection';

export interface Page {
  /** 1-based, original document page number, no gaps. */
  pageNumber: number;
  /** Working_Image px (image and ocr pages) or PDF user-space units (text-layer pages). */
  width: number;
  height: number;
  /** PDF /Rotate or the user's rotate presses; boxes are already upright. */
  rotation: Rotation;
  textSource: PageTextSource;
  lines: TextLine[];
  answerAreas: AnswerArea[];
  status: PageStatus;
  /** Downscaled JPEG of the page for Page_Crops (object URL), revoked when the model is discarded. */
  preview: { url: string; scale: number } | null;
  /** Only for photos: the EXIF orientation read from the header (1..8). */
  exifOrientation?: number;
}

export type LabelClass = 'likely-label' | 'ambiguous' | 'value-like';

export interface LabelCandidate {
  /** `p${pageNumber}-l${lineIndex}` */
  labelId: string;
  pageNumber: number;
  lineIndex: number;
  /** The whole line, or the part up to and including the label-ending colon. */
  text: string;
  labelClass: 'likely-label' | 'ambiguous';
  /** OCR_Language tag for ocr pages, Form_Language or 'und' for text-layer pages. */
  textLang: string;
  /** Low line confidence or a low-quality page the user continued with. */
  checkYourself: boolean;
}

export type DocumentSourceKind = 'pdf-without-fields' | 'jpeg' | 'png';

export interface DocumentModel {
  sourceKind: DocumentSourceKind;
  pages: Page[];
  candidates: LabelCandidate[];
}
