/**
 * src/frontend/components/PageCropButton.tsx
 *
 * formbridge-any-document task 11.7 (Requirements 12.2, 12.7, 23.6). The
 * Page_Crop beside a Label_Candidate: a small picture of the line in its place
 * on the page. Its text alternative holds the candidate text and the page
 * number. Pressing it opens the enlarged crop in a dialog.
 */
import { useId, useState } from 'react';
import type { Box, Page } from '../../lib/document/types.js';
import { cropRect, cropStyle, previewSizeOf } from '../document/crops.js';
import { useTranslation } from '../i18n.js';
import { CropDialog } from './CropDialog.js';

/** Width of the picture beside the candidate, in CSS pixels; it shrinks on a narrow screen. */
const THUMBNAIL_WIDTH = 240;

export interface PageCropButtonProps {
  /** The candidate text as read from the page. */
  text: string;
  textLang?: string | undefined;
  pageNumber: number;
  /** The page's width and height in page units. */
  page: Pick<Page, 'width' | 'height'>;
  preview: NonNullable<Page['preview']>;
  /** The line's box in page units, upright as displayed. */
  box: Box;
}

export function PageCropButton({ text, textLang, pageNumber, page, preview, box }: PageCropButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const hintId = useId();
  const previewSize = previewSizeOf(page, preview.scale);
  const thumbRect = cropRect(page, box, preview.scale, 'thumbnail');
  const dialogRect = cropRect(page, box, preview.scale, 'dialog');
  const style = cropStyle(thumbRect, previewSize, Math.min(1, THUMBNAIL_WIDTH / thumbRect.width));
  return (
    <>
      <button type="button" className="page-crop" aria-haspopup="dialog" aria-describedby={hintId} onClick={() => setOpen(true)}>
        <span className="page-crop__frame" style={{ width: style.frame.width, height: style.frame.height }}>
          <img
            src={preview.url}
            alt={t('document.review.cropAlt', { page: pageNumber, text })}
            lang={textLang}
            style={{ width: style.image.width, height: style.image.height, marginLeft: style.image.marginLeft, marginTop: style.image.marginTop }}
          />
        </span>
      </button>
      <span id={hintId} className="visually-hidden">
        {t('document.crop.enlarge')}
      </span>
      <CropDialog open={open} onClose={() => setOpen(false)} url={preview.url} rect={dialogRect} previewSize={previewSize} pageNumber={pageNumber} text={text} textLang={textLang} />
    </>
  );
}
