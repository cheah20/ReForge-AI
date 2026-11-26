// @vitest-environment jsdom
/**
 * tests/unit/page-crops.test.tsx
 *
 * formbridge-any-document task 11.7: the Page_Crop beside a Label_Candidate and
 * its enlarged dialog. The geometry always stays inside the preview and holds
 * the line; the picture has a text alternative with the candidate text and page
 * number; the dialog zooms from 100% to 400% in 50% steps and hands focus back
 * to the crop button; nothing is requested from the network.
 * Validates: Requirements 12.2, 12.7, 23.6, 23.12
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import type { ApiClient } from '../../src/frontend/api.js';
import { AppContext } from '../../src/frontend/app-context.js';
import { I18nProvider } from '../../src/frontend/i18n.js';
import { PageCropButton } from '../../src/frontend/components/PageCropButton.js';
import { LabelReview } from '../../src/frontend/document/LabelReview.js';
import { startDocumentSession } from '../../src/frontend/document/session.js';
import { cropRect, cropStyle, previewSizeOf, stepZoom, ZOOM_MAX, ZOOM_MIN, type CropContext } from '../../src/frontend/document/crops.js';
import { createSession, createSessionStore } from '../../src/frontend/state.js';
import { buildCandidates, buildPage, createModel } from '../../src/lib/document/model.js';
import { classifyByValueRules } from '../../src/lib/document/value-rules.js';
import { translate } from '../../src/packs/language/registry.js';
import { fire, render, type Rendered } from './accessforge-render.js';

const t = (key: string, params?: Record<string, string | number>) => translate('en', key, params);
const NO_API: ApiClient = { analyze: () => Promise.reject(new Error('unused')), retranslate: () => Promise.reject(new Error('unused')), translate: () => Promise.reject(new Error('unused')) };

describe('cropRect', () => {
  const contexts: CropContext[] = ['thumbnail', 'dialog'];
  const geometry = fc
    .record({
      width: fc.integer({ min: 200, max: 4000 }),
      height: fc.integer({ min: 200, max: 6000 }),
      scale: fc.double({ min: 0.1, max: 1, noNaN: true }),
      context: fc.constantFrom(...contexts),
      u: fc.double({ min: 0, max: 1, noNaN: true }),
      v: fc.double({ min: 0, max: 1, noNaN: true }),
      w: fc.double({ min: 0, max: 1, noNaN: true }),
      h: fc.double({ min: 0, max: 0.2, noNaN: true }),
    })
    .map((g) => {
      const left = g.u * g.width * 0.8;
      const top = g.v * g.height * 0.95;
      const box = { left, top, right: Math.min(g.width, left + 10 + g.w * g.width * 0.6), bottom: Math.min(g.height, top + 8 + g.h * g.height) };
      return { page: { width: g.width, height: g.height }, box, scale: g.scale, context: g.context };
    });

  it('stays inside the preview and holds the whole line', () => {
    fc.assert(
      fc.property(geometry, ({ page, box, scale, context }) => {
        const size = previewSizeOf(page, scale);
        const r = cropRect(page, box, scale, context);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(size.width);
        expect(r.y + r.height).toBeLessThanOrEqual(size.height);
        expect(r.width).toBeGreaterThanOrEqual(1);
        expect(r.height).toBeGreaterThanOrEqual(1);
        // One preview pixel of rounding either way.
        expect(r.x).toBeLessThanOrEqual(Math.ceil(box.left * scale) + 1);
        expect(r.x + r.width).toBeGreaterThanOrEqual(Math.floor(box.right * scale) - 1);
        expect(r.y).toBeLessThanOrEqual(Math.ceil(box.top * scale) + 1);
        expect(r.y + r.height).toBeGreaterThanOrEqual(Math.floor(box.bottom * scale) - 1);
      }),
      { numRuns: 100 },
    );
  });

  // Found by the property above (seed -292937754): the position and the size were rounded one at a time, so the
  // rectangle ended at pixel 38 of a 37 pixel wide preview.
  it('regression: a rectangle at the right edge of a narrow preview does not round past its last pixel', () => {
    const page = { width: 210, height: 200 };
    const box = { left: 152.46575342465755, top: 0, right: 162.46575342465755, bottom: 8 };
    const size = previewSizeOf(page, 0.1738095238095238);
    expect(size).toEqual({ width: 37, height: 35 });
    const r = cropRect(page, box, 0.1738095238095238, 'thumbnail');
    expect(r.x + r.width).toBeLessThanOrEqual(37);
    expect(r.y + r.height).toBeLessThanOrEqual(35);
  });

  it('shows more of the page in the dialog than beside the candidate', () => {
    fc.assert(
      fc.property(geometry, ({ page, box, scale }) => {
        const thumb = cropRect(page, box, scale, 'thumbnail');
        const big = cropRect(page, box, scale, 'dialog');
        expect(big.width).toBeGreaterThanOrEqual(thumb.width);
        expect(big.height).toBeGreaterThanOrEqual(thumb.height);
      }),
      { numRuns: 100 },
    );
  });

  it('moves the preview so the rectangle fills the frame, at any zoom', () => {
    const rect = { x: 40, y: 100, width: 300, height: 60 };
    expect(cropStyle(rect, { width: 600, height: 800 }, 2)).toEqual({
      frame: { width: 600, height: 120 },
      image: { width: 1200, height: 1600, marginLeft: -80, marginTop: -200 },
    });
  });

  it('steps the zoom from 100% to 400% in 50% steps and no further', () => {
    const up: number[] = [ZOOM_MIN];
    for (let i = 0; i < 10; i++) up.push(stepZoom(up.at(-1)!, 1));
    expect(up.slice(0, 8)).toEqual([1, 1.5, 2, 2.5, 3, 3.5, 4, 4]);
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });
});

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

const PAGE = { width: 1000, height: 1400 };
const PREVIEW = { url: 'blob:preview-1', scale: 0.5 };
const BOX = { left: 100, top: 300, right: 400, bottom: 340 };

function mountButton() {
  mounted = render(
    <I18nProvider initialLanguage="en" fontLoader={async () => true}>
      <PageCropButton text="Full name:" textLang="en" pageNumber={2} page={PAGE} preview={PREVIEW} box={BOX} />
    </I18nProvider>,
  );
  return mounted.container;
}
const buttonByName = (root: HTMLElement, name: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === name)!;

describe('PageCropButton', () => {
  it('shows the crop as a picture whose text alternative holds the candidate text and the page number', () => {
    const root = mountButton();
    const img = root.querySelector('button.page-crop img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('blob:preview-1');
    expect(img.alt).toBe(t('document.review.cropAlt', { page: 2, text: 'Full name:' }));
    expect(img.alt).toContain('Full name:');
    expect(img.alt).toContain('2');
    expect(img.lang).toBe('en');
    // The button is at least 44 px in each direction by rule, and says what pressing it does.
    const button = root.querySelector('button.page-crop')!;
    const hint = document.getElementById(button.getAttribute('aria-describedby')!)!;
    expect(hint.textContent).toBe(t('document.crop.enlarge'));
  });

  it('opens the enlarged crop, zooms in 50% steps up to 400%, and stops at both ends', () => {
    const root = mountButton();
    const dialog = root.querySelector('dialog')!;
    expect(dialog.open || dialog.hasAttribute('open')).toBe(false);
    fire(() => (root.querySelector('button.page-crop') as HTMLButtonElement).click());
    expect(dialog.open || dialog.hasAttribute('open')).toBe(true);
    const level = () => root.querySelector('.crop-dialog__level')!.textContent;
    const zoomIn = buttonByName(root, t('document.crop.zoomIn'));
    const zoomOut = buttonByName(root, t('document.crop.zoomOut'));
    expect(level()).toBe(t('document.crop.zoomLevel', { percent: 100 }));
    expect(zoomOut.disabled).toBe(true);
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      fire(() => zoomIn.click());
      seen.push(level()!);
    }
    expect(seen).toEqual([150, 200, 250, 300, 350, 400].map((percent) => t('document.crop.zoomLevel', { percent })));
    expect(zoomIn.disabled).toBe(true);
    expect(zoomOut.disabled).toBe(false);
    // The picture grew with the zoom: the frame is the dialog's rectangle at 4 times its size.
    const size = previewSizeOf(PAGE, PREVIEW.scale);
    const rect = cropRect(PAGE, BOX, PREVIEW.scale, 'dialog');
    const frame = root.querySelector('.crop-dialog__frame') as HTMLElement;
    expect(frame.style.width).toBe(`${rect.width * 4}px`);
    expect((frame.querySelector('img') as HTMLImageElement).style.width).toBe(`${size.width * 4}px`);
    fire(() => zoomOut.click());
    expect(level()).toBe(t('document.crop.zoomLevel', { percent: 350 }));
  });

  it('closes with the Close button and with Escape, and gives focus back to the crop button each time', () => {
    const root = mountButton();
    const crop = root.querySelector('button.page-crop') as HTMLButtonElement;
    const dialog = root.querySelector('dialog')!;
    const isOpen = () => dialog.open || dialog.hasAttribute('open');
    for (const how of ['close button', 'escape'] as const) {
      crop.focus();
      fire(() => crop.click());
      expect(isOpen(), how).toBe(true);
      // Move focus into the dialog, as a modal dialog does.
      buttonByName(root, t('document.crop.close')).focus();
      expect(document.activeElement).not.toBe(crop);
      if (how === 'close button') fire(() => buttonByName(root, t('document.crop.close')).click());
      // Escape makes the browser close the dialog and fire `close`.
      else fire(() => dialog.dispatchEvent(new Event('close')));
      expect(isOpen(), how).toBe(false);
      expect(document.activeElement, how).toBe(crop);
    }
  });

  it('makes no network request', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const root = mountButton();
    fire(() => (root.querySelector('button.page-crop') as HTMLButtonElement).click());
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Label_Review with crops', () => {
  function mountReview(withPreview: boolean) {
    const lines = ['Clinic registration', 'Full name:', 'Email:'].map((text, i) => ({ text, box: { left: 100, top: 100 + i * 200, right: 700, bottom: 140 + i * 200 }, confidence: 0.95 }));
    const page = buildPage({ pageNumber: 1, width: 1000, height: 1400, rotation: 0, textSource: 'ocr', lines, ...(withPreview ? { preview: PREVIEW } : {}) });
    const model = createModel('jpeg', [page], buildCandidates([page], null, 'eng', classifyByValueRules));
    const store = createSessionStore({ ...createSession('en'), document: startDocumentSession(model, 'eng') });
    mounted = render(
      <I18nProvider initialLanguage="en" fontLoader={async () => true}>
        <AppContext.Provider value={{ store, api: NO_API }}>
          <LabelReview onDone={() => {}} onBack={() => {}} />
        </AppContext.Provider>
      </I18nProvider>,
    );
    return mounted.container;
  }

  it('puts the crop of the page beside every candidate, named by the line it shows', () => {
    const root = mountReview(true);
    const items = Array.from(root.querySelectorAll('ol.label-review > li'));
    expect(items.length).toBeGreaterThan(0);
    for (const li of items) {
      const img = li.querySelector('.label-review__crop img') as HTMLImageElement;
      expect(img, li.textContent ?? '').not.toBeNull();
      const shown = (li.querySelector('input[type="text"]') as HTMLInputElement).value;
      expect(img.alt).toBe(t('document.review.cropAlt', { page: 1, text: shown }));
    }
  });

  it('shows no crop for a page that has no preview, and the row still works', () => {
    const root = mountReview(false);
    expect(root.querySelectorAll('.label-review__crop').length).toBe(0);
    expect(root.querySelectorAll('ol.label-review > li input[type="checkbox"]').length).toBeGreaterThan(0);
  });
});
