/**
 * src/lib/document/limits.ts
 *
 * The only place the numeric limits of the FormBridge Document_Path live
 * (formbridge-any-document Requirement 3.7, design "Limits"). They may change
 * after the phone tests of Requirement 26; every change is recorded in the
 * design.
 */

/**
 * The language model variant served from /ocr (provisional until the phone
 * result of task 3.4: design "OCR Spike Result", rule in Q5). Both variants
 * are copied by scripts/copy-ocr-assets.ts; only this one is downloaded.
 */
export const OCR_MODEL_VARIANT = '4.0.0_best_int';

/** Tesseract language codes the app can read. */
export type OcrLanguage = 'eng' | 'msa';

export const MAX_DOCUMENT_BYTES = 15_728_640; // 15 MB (3.1)
export const MAX_DOCUMENT_PAGES = 5; // (3.2)
export const MAX_DECODED_PIXELS = 20_000_000; // (3.3)
export const WORKING_LONG_EDGE = 2200; // inside the Long_Edge_Range 2000..2500 (3.4)
export const PREVIEW_LONG_EDGE = 1200; // Page_Crop source, not a full-size bitmap
export const SLOW_PAGE_NOTICE_MS = 60_000; // (3.8)
export const DOWNLOAD_STALL_MS = 30_000; // (8.10)
export const SNIFF_HEAD_BYTES = 65_536; // (2.8)
export const PDF_STRUCTURE_READ_MAX = MAX_DOCUMENT_BYTES; // bounded PDF structure read (2.8)
export const IMAGE_HEADER_READ_MAX = 1_048_576; // JPEG SOF search limit
export const TEXT_LAYER_MIN_CHARS = 20; // (6.1)
export const OCR_MIN_WORDS = 10; // (9.4)
export const OCR_MIN_MEAN_CONFIDENCE = 0.6; // (9.4)
export const OCR_LOW_LINE_CONFIDENCE = 0.6; // (9.5)
export const LIKELY_LABEL_MAX_CHARS = 60; // (11.3)
export const FRAGMENT_MAX_SEPARATOR_RUN = 3; // separator characters between two digits inside one Numeric_Fragment (11.11)
export const FRAGMENT_SAME_LINE_MAX_GAP_CHARS = 8; // other characters allowed between two fragments on one Text_Line (11.11)
export const FRAGMENT_LINE_GAP_LINE_HEIGHTS = 1.5; // vertical gap between adjacent Text_Lines, in median line heights (11.11)
export const FRAGMENT_MAX_CHAIN = 5; // fragments merged into one tested group (11.11)
export const CELL_EDGE_TOLERANCE = 0.01; // ruling-line endpoint tolerance, share of page width (Mixed_Cell)
export const KEPT_LABEL_MAX_CHARS = 200; // (13.2)
export const MAX_KEPT_LABELS = 150; // (13.2)
export const LABEL_BATCH_SIZE = 30; // (13.11), same as BATCH_SIZE in src/lib/batch.ts
export const TEXT_ANSWER_MAX = 200; // code points (16.2)
export const DESCRIPTION_ANSWER_MAX = 2000; // code points (16.2)

/**
 * 'msa' is listed only because Malay passed the OCR_Validation_Bar (Requirement
 * 9.1: 9 of 9 expected labels within 10% CER on the synthetic clean fixtures,
 * both model variants, desktop Chrome; see design "OCR Spike Result"). If a later
 * measurement on phone photos fails the bar, remove it: the language question
 * then says printed Malay forms cannot be read yet (9.8, 28.5).
 */
export const VALIDATED_OCR_LANGUAGES: readonly OcrLanguage[] = ['eng', 'msa'];
