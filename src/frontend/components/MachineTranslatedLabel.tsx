/**
 * src/frontend/components/MachineTranslatedLabel.tsx
 *
 * Marks AI-written or machine-translated text in every language (2-L.6).
 */

import { useTranslation } from '../i18n.js';
import { StatusIcon } from './StatusMessage.js';

export function MachineTranslatedLabel({ id }: { id?: string }) {
  const { t } = useTranslation();
  return (
    <span className="badge badge--caution machine-label" id={id}>
      <StatusIcon tone="caution" />
      {t('wizard.machineTranslated')}
    </span>
  );
}
