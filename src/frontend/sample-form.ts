/**
 * src/frontend/sample-form.ts
 *
 * The bundled sample form (task 28.5): the synthetic clinic registration PDF
 * from fixtures/, emitted by Vite as a static asset of this app. It is fetched
 * from our own origin and then read exactly like a file the user chose; no
 * data goes out.
 */

import sampleUrl from '../../fixtures/clinic-registration.pdf?url';

export const SAMPLE_FORM_NAME = 'clinic-registration.pdf';

export interface SampleSource {
  name: string;
  load: () => Promise<Uint8Array>;
}

export type SampleLoader = () => Promise<Uint8Array>;

export const loadSampleForm: SampleLoader = async () => {
  const response = await fetch(sampleUrl);
  if (!response.ok) throw new Error(`Sample form not available (HTTP ${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
};
