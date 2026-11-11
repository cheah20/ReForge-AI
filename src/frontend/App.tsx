/**
 * src/frontend/App.tsx
 *
 * Screen flow (design: Frontend Screen Flow):
 * language -> upload -> analysis -> [confirm form language] -> questions ->
 * review -> download. Opening SAMPLE_FORM_PATH starts on the upload screen
 * with the sample form loaded (task 28.5). Everything stays in memory in this tab; leaving the
 * page with answers asks the browser to warn first (privacy: never saved).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createApiClient, type ApiClient } from './api.js';
import { AppContext, useServices, useSession } from './app-context.js';
import { AppHeader } from './components/AppHeader.js';
import { StatusMessage } from './components/StatusMessage.js';
import { I18nProvider, useTranslation } from './i18n.js';
import { browserLanguages, matchLanguage } from './language-match.js';
import { AnalysisLoading } from './screens/AnalysisLoading.js';
import { ConfirmLanguage, isBlockedFormLanguage } from './screens/ConfirmLanguage.js';
import { DownloadConfirm } from './screens/DownloadConfirm.js';
import { LanguagePicker } from './screens/LanguagePicker.js';
import { QuestionWizard } from './screens/QuestionWizard.js';
import { ReviewScreen } from './screens/ReviewScreen.js';
import { Upload, type ExtractedForm, type Extractor } from './screens/Upload.js';
import { loadSampleForm, SAMPLE_FORM_NAME, type SampleLoader, type SampleSource } from './sample-form.js';
import { createSession, createSessionStore, setStep, type SessionStore } from './state.js';
import { SAMPLE_FORM_PATH } from '../shared/app-paths.js';
import { useChangeLanguage } from './use-change-language.js';

export type Screen = 'language' | 'upload' | 'analysis' | 'confirm' | 'questions' | 'review' | 'download';

interface FlowProps {
  extractor?: Extractor | undefined;
  /** Path the page was opened at; SAMPLE_FORM_PATH starts with the sample form loaded. */
  initialPath: string;
  loadSample: SampleLoader;
}

function Flow({ extractor, initialPath, loadSample }: FlowProps) {
  const { t } = useTranslation();
  const changeLanguage = useChangeLanguage();
  const session = useSession();
  const startsWithSample = initialPath === SAMPLE_FORM_PATH;
  const [screen, setScreen] = useState<Screen>(startsWithSample ? 'upload' : 'language');
  const [form, setForm] = useState<ExtractedForm | null>(null);
  // A new object per request, so pressing "Try a sample form" again reads it again.
  const [sample, setSample] = useState<SampleSource | undefined>(() =>
    startsWithSample ? { name: SAMPLE_FORM_NAME, load: loadSample } : undefined,
  );
  const [firstScreen, setFirstScreen] = useState(true);
  const { store } = useServices();

  const show = useCallback((next: Screen) => {
    setFirstScreen(false);
    setScreen(next);
    window.scrollTo?.(0, 0);
  }, []);

  // Warn before leaving with answers: they are never saved anywhere.
  const hasAnswers = session.fields.some((f) => (f.rawAnswer ?? '') !== '');
  useEffect(() => {
    if (!hasAnswers) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasAnswers]);

  const onAnalysisDone = useCallback(
    (needsConfirmation: boolean) => {
      const s = store.get();
      show(needsConfirmation || isBlockedFormLanguage(s.formLanguage) ? 'confirm' : 'questions');
    },
    [show, store],
  );
  const onWizardDone = useCallback(() => show('review'), [show]);

  return (
    <>
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <AppHeader showLanguageSwitch={screen !== 'language'} changeLanguage={changeLanguage} />
      {session.servedFromCache && screen !== 'language' && screen !== 'upload' && (
        <div className="page page--banner">
          <StatusMessage tone="caution">{t('analysis.cached')}</StatusMessage>
        </div>
      )}
      <main id="main" className="page">
        {screen === 'language' && (
          <LanguagePicker
            changeLanguage={changeLanguage}
            firstScreen={firstScreen}
            onContinue={() => {
              setSample(undefined);
              show('upload');
            }}
            onTrySample={() => {
              setSample({ name: SAMPLE_FORM_NAME, load: loadSample });
              show('upload');
            }}
          />
        )}
        {screen === 'upload' && (
          <Upload
            {...(extractor ? { extractor } : {})}
            sample={sample}
            onContinue={(f) => {
              setForm(f);
              show('analysis');
            }}
          />
        )}
        {screen === 'analysis' && form && (
          <AnalysisLoading fields={form.fields} contentHash={form.contentHash} onDone={onAnalysisDone} onBack={() => show('upload')} />
        )}
        {screen === 'confirm' && <ConfirmLanguage onConfirmed={() => show('questions')} />}
        {screen === 'questions' && <QuestionWizard onDone={onWizardDone} onBackToStart={() => show('upload')} />}
        {screen === 'review' && (
          <ReviewScreen
            onConfirm={() => show('download')}
            onBack={() => {
              setStep(store, Number.MAX_SAFE_INTEGER);
              show('questions');
            }}
          />
        )}
        {screen === 'download' && form && <DownloadConfirm pdf={form.pdf} onBackToReview={() => show('review')} />}
      </main>
    </>
  );
}

export interface AppProps {
  api?: ApiClient;
  store?: SessionStore;
  initialLanguage?: string;
  extractor?: Extractor;
  /** Defaults to the current page path. */
  initialPath?: string;
  /** Replaces the sample-form fetch (tests). */
  loadSample?: SampleLoader;
}

export function App({ api, store, initialLanguage, extractor, initialPath, loadSample = loadSampleForm }: AppProps) {
  const path = initialPath ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  const language = useMemo(() => initialLanguage ?? matchLanguage(browserLanguages()), [initialLanguage]);
  const services = useMemo(
    () => ({ api: api ?? createApiClient(), store: store ?? createSessionStore(createSession(language)) }),
    [api, store, language],
  );
  return (
    <I18nProvider initialLanguage={language}>
      <AppContext.Provider value={services}>
        <Flow extractor={extractor} initialPath={path} loadSample={loadSample} />
      </AppContext.Provider>
    </I18nProvider>
  );
}
