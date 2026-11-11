/**
 * src/frontend/components/ScreenHeading.tsx
 *
 * The h1 of a screen. Focus moves to it when the screen (or wizard step)
 * appears, so keyboard and screen-reader users start at the new content.
 */

import { useEffect, useRef, type ReactNode } from 'react';

export interface ScreenHeadingProps {
  children: ReactNode;
  /** Changing this value moves focus again (for example the wizard step). */
  focusKey?: string | number;
  /** Skip the initial focus (the first screen on page load). */
  autoFocus?: boolean;
}

export function ScreenHeading({ children, focusKey, autoFocus = true }: ScreenHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [focusKey, autoFocus]);
  return (
    <h1 className="page__heading" tabIndex={-1} ref={ref}>
      {children}
    </h1>
  );
}
