/**
 * src/lib/document/request.ts
 *
 * Builds the label analysis requests (formbridge-any-document Requirements
 * 12.9, 13.1, 13.11). The request carries only the Kept_Labels (id, text, page
 * number, reading order) and the language and country settings; no line that
 * was not kept, no box, no image and no answer. Batches of 30 in page and
 * reading order; each request is parsed with the same schema the Worker uses
 * before it is returned. No request when nothing is kept.
 */

import { LabelAnalysisRequestSchema } from '../../shared/schemas.js';
import type { LabelAnalysisRequest } from '../../shared/types.js';
import { LABEL_BATCH_SIZE } from './limits.js';
import type { KeptLabelItem } from './review.js';

export interface RequestSettings {
  interfaceLanguage: string;
  formLanguage?: string;
  formCountry?: string;
}

export function buildLabelAnalysisRequests(kept: readonly KeptLabelItem[], settings: RequestSettings): LabelAnalysisRequest[] {
  const ordered = [...kept].sort((a, b) => a.pageNumber - b.pageNumber || a.readingOrder - b.readingOrder);
  const requests: LabelAnalysisRequest[] = [];
  for (let i = 0; i < ordered.length; i += LABEL_BATCH_SIZE) {
    requests.push(
      LabelAnalysisRequestSchema.parse({
        labels: ordered.slice(i, i + LABEL_BATCH_SIZE).map((l) => ({ labelId: l.labelId, text: l.text, pageNumber: l.pageNumber, readingOrder: l.readingOrder })),
        interfaceLanguage: settings.interfaceLanguage,
        ...(settings.formLanguage ? { formLanguage: settings.formLanguage } : {}),
        ...(settings.formCountry ? { formCountry: settings.formCountry } : {}),
      }),
    );
  }
  return requests;
}
