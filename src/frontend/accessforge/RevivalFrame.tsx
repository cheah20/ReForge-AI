/**
 * src/frontend/accessforge/RevivalFrame.tsx
 *
 * accessforge-skeleton task 16.2 (Requirements 3.9, 4.3, 8.5, 8.12, 18.1,
 * 18.2). The same-origin, script-free iframe that shows the real legacy
 * page. `src` is the constant `/legacy/register`; nothing from the address
 * bar or a plan can change it. `sandbox` allows same-origin reads and form
 * submission only, so no script on the legacy page can ever run.
 */

import { forwardRef } from 'react';
import { REVIVAL_FRAME_SRC } from '../../lib/accessforge/scope.js';
import { useTranslation } from '../i18n.js';

/** 4 px stamp-blue outline, shown for 2 s (Requirement 8.5: 1 to 3 s, at least 3 px, at least 3:1). */
export const HIGHLIGHT = { outline: '4px solid #1a4da2', offset: '2px', ms: 2000 } as const;

/**
 * Outlines a written control through the CSSOM and scrolls it into view. It
 * changes no value, checked or selected state. Under reduced motion there is
 * no smooth scroll and no transition (Requirement 8.12).
 */
export function highlightControl(el: Element, reducedMotion: boolean, schedule: (fn: () => void, ms: number) => unknown = setTimeout): void {
  const style = (el as HTMLElement).style;
  if (!style) return;
  const previous = { outline: style.outline, offset: style.outlineOffset, transition: style.transition };
  style.transition = reducedMotion ? 'none' : 'outline-color 150ms ease-out';
  style.outline = HIGHLIGHT.outline;
  style.outlineOffset = HIGHLIGHT.offset;
  (el as HTMLElement).scrollIntoView?.({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
  schedule(() => {
    style.outline = previous.outline;
    style.outlineOffset = previous.offset;
    style.transition = previous.transition;
  }, HIGHLIGHT.ms);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const RevivalFrame = forwardRef<HTMLIFrameElement, { onLoad: () => void }>(function RevivalFrame({ onLoad }, ref) {
  const { t } = useTranslation();
  return (
    <figure className="revival-frame">
      <figcaption className="revival-frame__caption">{t('accessforge.frame.caption')}</figcaption>
      <iframe ref={ref} className="revival-frame__iframe" src={REVIVAL_FRAME_SRC} sandbox="allow-same-origin allow-forms" title={t('accessforge.frame.title')} onLoad={onLoad} />
    </figure>
  );
});
