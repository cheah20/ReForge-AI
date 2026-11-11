/**
 * src/frontend/app-context.tsx
 *
 * App-wide objects shared by the screens: the session store, the API client
 * and the uploaded PDF. All of it lives in memory for this tab only.
 */

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ApiClient } from './api.js';
import type { SessionState, SessionStore } from './state.js';

export interface UploadedPdf {
  name: string;
  bytes: Uint8Array;
}

export interface AppServices {
  store: SessionStore;
  api: ApiClient;
}

export const AppContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const value = useContext(AppContext);
  if (!value) throw new Error('useServices must be used inside <AppContext.Provider>');
  return value;
}

export function useSession(): SessionState {
  const { store } = useServices();
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
