/**
 * src/frontend/document/services.ts
 *
 * The browser services of the Document_Path, created on first use: the decode
 * dependencies, the one OCR service (one worker, Requirement 8) and the
 * once-per-page-load check of whether the decoder applies EXIF orientation.
 */

import { browserDecodeDeps, decodePhoto, detectDecoderOrientation } from './decode.js';
import { createOcrService, type OcrService } from './ocr.js';
import type { PipelineDeps } from './pipeline.js';

let ocr: OcrService | null = null;
let applies: Promise<boolean> | null = null;

export function ocrService(): OcrService {
  ocr ??= createOcrService();
  return ocr;
}

export function decoderApplies(): Promise<boolean> {
  applies ??= detectDecoderOrientation(browserDecodeDeps()).catch(() => false);
  return applies;
}

export function pipelineDeps(): PipelineDeps {
  const decodeDeps = browserDecodeDeps();
  return {
    decode: async (file, rotation) => decodePhoto(file, decodeDeps, await decoderApplies(), rotation),
    ocr: ocrService(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h as number),
  };
}
