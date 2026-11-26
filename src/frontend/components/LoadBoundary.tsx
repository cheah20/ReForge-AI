/**
 * src/frontend/components/LoadBoundary.tsx
 *
 * Catches a screen that fails to load (a lost connection, or a new deploy that
 * replaced the file the page asks for) and shows a message with a way to try
 * again, in place of a blank page. The error itself is not shown or logged.
 */

import { Component, type ReactNode } from 'react';
import { useTranslation } from '../i18n.js';
import { StatusMessage } from './StatusMessage.js';

export function LoadFailed() {
  const { t } = useTranslation();
  return (
    <div className="stack" data-load-failed="">
      <div role="alert">
        <StatusMessage tone="error">{t('error.generic')}</StatusMessage>
      </div>
      {/* A reload fetches the current files. The page asks first when there are answers. */}
      <button type="button" className="button" onClick={() => window.location.reload()}>
        {t('error.retry')}
      </button>
    </div>
  );
}

export class LoadBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
