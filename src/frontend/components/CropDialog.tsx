/**
 * src/frontend/components/CropDialog.tsx
 *
 * formbridge-any-document task 11.7 (Requirements 12.7, 23.12). The enlarged
 * Page_Crop in a native modal `<dialog>`: zoom from 100% to 400% in 50% steps,
 * focus kept inside while it is open, and Escape or Close returns focus to the
 * crop button that opened it. The picture never leaves the browser.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { cropStyle, stepZoom, ZOOM_MAX, ZOOM_MIN, type CropRect, type CropSize } from '../document/crops.js';
import { useTranslation } from '../i18n.js';

export interface CropDialogProps {
  open: boolean;
  onClose: () => void;
  url: string;
  rect: CropRect;
  previewSize: CropSize;
  pageNumber: number;
  /** The candidate text, as the text alternative of the picture. */
  text: string;
  /** `lang` of the candidate text. */
  textLang?: string | undefined;
}

export function CropDialog({ open, onClose, url, rect, previewSize, pageNumber, text, textLang }: CropDialogProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const style = cropStyle(rect, previewSize, zoom);
  const percent = Math.round(zoom * 100);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      opener.current = document.activeElement;
      setZoom(ZOOM_MIN);
      if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
      } else dialog.setAttribute('open', '');
    } else {
      if (dialog.open || dialog.hasAttribute('open')) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
      opener.current = null;
    }
  }, [open]);

  return (
    <dialog ref={ref} className="crop-dialog" aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId}>{t('document.crop.title', { page: pageNumber })}</h2>
      <div className="crop-dialog__scroll" tabIndex={0} role="region" aria-label={t('document.crop.title', { page: pageNumber })}>
        <div className="crop-dialog__frame" style={{ width: style.frame.width, height: style.frame.height }}>
          <img
            src={url}
            alt={t('document.review.cropAlt', { page: pageNumber, text })}
            lang={textLang}
            style={{ width: style.image.width, height: style.image.height, marginLeft: style.image.marginLeft, marginTop: style.image.marginTop }}
          />
        </div>
      </div>
      <p className="crop-dialog__level" aria-live="polite">
        {t('document.crop.zoomLevel', { percent })}
      </p>
      <div className="actions">
        <button type="button" className="button button--secondary" disabled={zoom <= ZOOM_MIN} onClick={() => setZoom((z) => stepZoom(z, -1))}>
          {t('document.crop.zoomOut')}
        </button>
        <button type="button" className="button button--secondary" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom((z) => stepZoom(z, 1))}>
          {t('document.crop.zoomIn')}
        </button>
        <button type="button" className="button" onClick={onClose}>
          {t('document.crop.close')}
        </button>
      </div>
    </dialog>
  );
}
