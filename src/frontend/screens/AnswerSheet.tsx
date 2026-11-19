/**
 * src/frontend/screens/AnswerSheet.tsx
 *
 * The Answer_Sheet of the Document_Path (formbridge-any-document task 11.16,
 * design Q7): a large-print table of every Kept_Label with its answer, a
 * Clerk_Summary in the Form_Language to show at a counter, and a Print button.
 *
 * - The sheet is rebuilt from the session fields on every render, so an edit
 *   is always included (Requirement 19.10).
 * - Print is an Export_Action: `window.print()` runs only from the press of
 *   its own button and the app makes no request (19.5, 19.11, 19.12).
 * - Download and Share (Tier B) are not here yet.
 */

import { useSession } from '../app-context.js';
import { ScreenHeading } from '../components/ScreenHeading.js';
import { useTranslation } from '../i18n.js';
import { getOwnLocaleStrings } from '../../packs/language/registry.js';
import {
  buildAnswerSheet,
  rowStatusText,
  type AnswerSheetRow,
  type LocaleLookup,
} from '../../lib/document/answer-sheet.js';

export interface AnswerSheetProps {
  onBackToReview: () => void;
  /** Replaces `window.print` (tests). Called only from the Print button. */
  print?: () => void;
  /** Replaces the locale lookup (tests). */
  locales?: LocaleLookup;
}

const ownLocale: LocaleLookup = (language, key) => getOwnLocaleStrings(language)?.[key];

/** A `lang` attribute is only worth setting when the language is known. */
const langAttr = (tag: string | undefined) => (tag && tag !== 'und' ? tag : undefined);

export function AnswerSheet({ onBackToReview, print = () => window.print(), locales = ownLocale }: AnswerSheetProps) {
  const { t } = useTranslation();
  const session = useSession();
  // No memo on purpose: the sheet is a pure function of the fields, rebuilt on every render.
  const sheet = buildAnswerSheet(session.fields, session.formLanguage, locales);
  const { clerk } = sheet;

  const answerCell = (row: AnswerSheetRow) => {
    if (row.status !== 'filled') {
      return <span className="answer-sheet__status">{t(row.status === 'skipped' ? 'document.clerk.skipped' : 'document.clerk.signYourself')}</span>;
    }
    return (
      <>
        <span className="answer-sheet__answer" lang={row.machineTranslated ? langAttr(session.formLanguage) : undefined}>
          {row.answer}
        </span>
        {row.machineTranslated && <span className="answer-sheet__mark"> ({t('document.sheet.machineTranslated')})</span>}
      </>
    );
  };

  return (
    <div className="answer-sheet">
      <span className="stamp no-print" aria-hidden="true">
        {t('download.stamp')}
      </span>
      <ScreenHeading>{t('document.sheet.title')}</ScreenHeading>
      <p className="answer-sheet__howto">{t('document.sheet.howTo')}</p>

      <table className="answer-sheet__table">
        <caption>{t('document.sheet.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('document.sheet.col.page')}</th>
            <th scope="col">{t('document.sheet.col.label')}</th>
            <th scope="col">{t('document.sheet.col.answer')}</th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((row) => (
            <tr key={row.labelId}>
              <td data-label={t('document.sheet.col.page')}>{row.pageNumber}</td>
              <th scope="row" lang={langAttr(row.labelLang)}>
                {row.labelText}
              </th>
              <td data-label={t('document.sheet.col.answer')}>{answerCell(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="answer-sheet__clerk" lang={langAttr(clerk.lang)} aria-labelledby="clerk-title">
        <h2 id="clerk-title" lang={clerk.strings.title.lang}>
          {clerk.strings.title.text}
        </h2>
        <p lang={clerk.strings.statement.lang}>{clerk.strings.statement.text}</p>
        <dl className="answer-sheet__clerk-list">
          {sheet.rows.map((row) => {
            const status = rowStatusText(row, clerk);
            return (
              <div key={row.labelId} className="answer-sheet__clerk-row">
                <dt lang={langAttr(row.labelLang)}>{row.labelText}</dt>
                <dd lang={status ? status.lang : row.machineTranslated ? langAttr(clerk.lang) : undefined}>
                  {status ? status.text : row.answer}
                  {row.machineTranslated && <span lang={clerk.strings.machineTranslated.lang}> ({clerk.strings.machineTranslated.text})</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <div className="actions no-print">
        <button type="button" className="button" onClick={print}>
          {t('document.sheet.print')}
        </button>
        <button type="button" className="button button--secondary" onClick={onBackToReview}>
          {t('download.backToReview')}
        </button>
      </div>
    </div>
  );
}
