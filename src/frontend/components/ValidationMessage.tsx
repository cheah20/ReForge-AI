/**
 * src/frontend/components/ValidationMessage.tsx
 *
 * The message under an input. The element is always present and is a polite
 * live region, so a new message is announced; the input points at it with
 * `aria-describedby` (13.3).
 */

import type { ValidationResult } from '../../packs/country/interface.js';
import { useTranslation } from '../i18n.js';
import { StatusMessage } from './StatusMessage.js';

export interface ValidationMessageProps {
  id: string;
  result: ValidationResult | null;
}

export function ValidationMessage({ id, result }: ValidationMessageProps) {
  const { t } = useTranslation();
  const show = result && !result.valid && result.messageKey;
  return (
    <div id={id} aria-live="polite" className="validation-message">
      {show && (
        <StatusMessage tone={result.needs ? 'caution' : 'error'}>{t(result.messageKey!, result.messageParams)}</StatusMessage>
      )}
    </div>
  );
}
