/**
 * src/frontend/components/StatusMessage.tsx
 *
 * A message with an icon and words, so state never depends on colour alone.
 * Icons are decorative SVG, hidden from screen readers.
 */

import type { ReactNode } from 'react';

export type StatusTone = 'error' | 'success' | 'caution' | 'info';

const PATHS: Record<StatusTone, string> = {
  // Circle with a cross
  error: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.5 12.1-1.4 1.4L12 13.4l-2.1 2.1-1.4-1.4 2.1-2.1-2.1-2.1 1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4-2.1 2.1z',
  // Circle with a tick
  success: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5-5 1.4 1.4z',
  // Triangle with an exclamation mark
  caution: 'M12 2 1 21h22L12 2zm1 15h-2v-2h2v2zm0-4h-2V9h2v4z',
  // Circle with an i
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
};

export function StatusIcon({ tone }: { tone: StatusTone }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d={PATHS[tone]} />
    </svg>
  );
}

export interface StatusMessageProps {
  tone: StatusTone;
  children: ReactNode;
  id?: string;
}

export function StatusMessage({ tone, children, id }: StatusMessageProps) {
  return (
    <p className={`status-message status-message--${tone}`} id={id}>
      <StatusIcon tone={tone} />
      <span>{children}</span>
    </p>
  );
}
