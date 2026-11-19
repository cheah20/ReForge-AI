/**
 * src/frontend/document/ocr.ts
 *
 * The OCR service (formbridge-any-document Requirement 8, design Q5). The
 * engine, its worker, one core build and one language file are served from the
 * app's own origin under /ocr/<version>/. The service downloads them itself,
 * with progress, and stores only complete, verified files in the Cache Storage
 * cache `reforge-ocr-<version>`; it creates one OCR worker on first use,
 * reuses it, and ends it on cancel. Nothing here sends a page, a line or an
 * answer anywhere: the only requests are GETs for engine and language files.
 *
 * Everything the browser provides is injected (`OcrDeps`), so the rules are
 * tested with a fake `createWorker` and a fake `fetch`.
 */

import { DOWNLOAD_STALL_MS, VALIDATED_OCR_LANGUAGES, OCR_MODEL_VARIANT, type OcrLanguage } from '../../lib/document/limits.js';
import { mapTesseractBlocks, type OcrPageResult } from '../../lib/document/ocr-map.js';

export type OcrErrorCode = 'assets-unavailable' | 'verification-failed' | 'cancelled' | 'unsupported';

/** A typed OCR failure. The message never holds document content. */
export class OcrError extends Error {
  constructor(readonly code: OcrErrorCode) {
    super(code);
    this.name = 'OcrError';
  }
}

export interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface OcrManifest {
  version: string;
  files: ManifestFile[];
}

export type CoreBuild = 'relaxedsimd-lstm' | 'simd-lstm' | 'lstm';

export interface WorkerLike {
  recognize(image: unknown, options: Record<string, unknown>, output: Record<string, unknown>): Promise<{ data: { blocks?: unknown } }>;
  terminate(): Promise<unknown>;
}

export interface CacheLike {
  match(request: string): Promise<unknown>;
  put(request: string, response: Response): Promise<void>;
}

export interface OcrDeps {
  fetch(input: string, init?: { signal?: AbortSignal }): Promise<Response>;
  /** null when the browser has no Cache Storage: nothing counts as downloaded. */
  openCache(name: string): Promise<CacheLike> | null;
  loadTesseract(): Promise<{ createWorker(lang: string, oem: number, options: Record<string, unknown>): Promise<WorkerLike> }>;
  detectCore(): Promise<CoreBuild>;
  sha256(bytes: ArrayBuffer): Promise<string>;
  now(): number;
  /** Test builds only: a ready OCR result per recognised page (design Q8). */
  testOcr(): OcrPageResult | OcrPageResult[] | undefined;
}

export interface OcrService {
  /** Bytes still to download for this language, 0 when every file is in the OCR cache. */
  pendingDownloadBytes(lang: OcrLanguage): Promise<number>;
  /** Download with progress; resolves only when every file is verified and cached. */
  download(lang: OcrLanguage, onProgress: (done: number, total: number) => void, signal: AbortSignal, onStall?: () => void): Promise<void>;
  /** Recognise one Working_Image. Starts the single OCR worker on first use. */
  recognize(image: unknown, lang: OcrLanguage, signal: AbortSignal): Promise<OcrPageResult>;
  /** Ends the OCR worker and any download (8.6). */
  cancel(): Promise<void>;
}

export const OCR_BASE_PATH = '/ocr';

/**
 * The same WebAssembly feature probes as the `wasm-feature-detect` package that
 * Tesseract.js uses, so the file this app downloads is the file the engine runs.
 */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const RELAXED_SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11]);

export async function detectCoreBuild(): Promise<CoreBuild> {
  if (typeof WebAssembly !== 'object') throw new OcrError('unsupported');
  if (WebAssembly.validate(RELAXED_SIMD_PROBE)) return 'relaxedsimd-lstm';
  if (WebAssembly.validate(SIMD_PROBE)) return 'simd-lstm';
  return 'lstm';
}

/** The files one language needs: the worker, one core build and the language file (Requirement 8.3). */
export function neededFiles(manifest: OcrManifest, lang: OcrLanguage, core: CoreBuild): ManifestFile[] {
  const wanted = ['worker.min.js', `core/tesseract-core-${core}.wasm.js`, `lang/${OCR_MODEL_VARIANT}/${lang}.traineddata.gz`];
  return wanted.map((path) => {
    const file = manifest.files.find((f) => f.path === path);
    if (!file) throw new OcrError('assets-unavailable');
    return file;
  });
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

const isAbort = (e: unknown) => (e instanceof DOMException && e.name === 'AbortError') || (e instanceof Error && e.name === 'AbortError');

export function browserOcrDeps(): OcrDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    openCache: (name) => (typeof caches === 'undefined' ? null : caches.open(name)),
    loadTesseract: async () => {
      const mod = await import('tesseract.js');
      return mod as unknown as Awaited<ReturnType<OcrDeps['loadTesseract']>>;
    },
    detectCore: detectCoreBuild,
    sha256: async (bytes) => {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    },
    now: () => Date.now(),
    // Replaced by `undefined` in production builds, so the hook cannot exist there.
    testOcr: () => (import.meta.env.DEV ? (globalThis as { __REFORGE_TEST_OCR__?: OcrPageResult | OcrPageResult[] }).__REFORGE_TEST_OCR__ : undefined),
  };
}

export function createOcrService(deps: OcrDeps = browserOcrDeps()): OcrService {
  let manifest: OcrManifest | null = null;
  let version = '';
  let serviceAbort = new AbortController();
  let worker: { lang: OcrLanguage; ready: Promise<WorkerLike> } | null = null;
  let testPage = 0;

  const assertSupported = (lang: OcrLanguage) => {
    if (!VALIDATED_OCR_LANGUAGES.includes(lang)) throw new OcrError('unsupported');
  };

  async function loadManifest(signal?: AbortSignal): Promise<OcrManifest> {
    if (manifest) return manifest;
    try {
      const init = signal ? { signal } : {};
      const current = await deps.fetch(`${OCR_BASE_PATH}/current.json`, init);
      if (!current.ok) throw new OcrError('assets-unavailable');
      version = ((await current.json()) as { version: string }).version;
      const res = await deps.fetch(`${OCR_BASE_PATH}/${version}/manifest.json`, init);
      if (!res.ok) throw new OcrError('assets-unavailable');
      manifest = (await res.json()) as OcrManifest;
      return manifest;
    } catch (e) {
      if (e instanceof OcrError) throw e;
      throw new OcrError(isAbort(e) ? 'cancelled' : 'assets-unavailable');
    }
  }

  const urlOf = (path: string) => `${OCR_BASE_PATH}/${version}/${path}`;
  const cacheName = () => `reforge-ocr-${version}`;

  async function missingFiles(lang: OcrLanguage, signal?: AbortSignal): Promise<ManifestFile[]> {
    const m = await loadManifest(signal);
    const files = neededFiles(m, lang, await deps.detectCore());
    const opened = deps.openCache(cacheName());
    if (!opened) return files;
    const cache = await opened;
    const missing: ManifestFile[] = [];
    for (const f of files) if (!(await cache.match(urlOf(f.path)))) missing.push(f);
    return missing;
  }

  /**
   * One worker at a time. `worker` is set before anything is awaited, so two
   * requests that arrive together share one worker, and a request for another
   * language ends the old worker before the new one starts.
   */
  function ensureWorker(lang: OcrLanguage): Promise<WorkerLike> {
    if (worker && worker.lang === lang) return worker.ready;
    const previous = worker;
    const ready = (async () => {
      if (previous) await previous.ready.then((w) => w.terminate()).catch(() => undefined);
      await loadManifest();
      const core = await deps.detectCore();
      const { createWorker } = await deps.loadTesseract();
      // LSTM only (oem 1). Every path is on our own origin; the library's own cache is off.
      return createWorker(lang, 1, {
        workerPath: urlOf('worker.min.js'),
        corePath: urlOf(`core/tesseract-core-${core}.wasm.js`),
        langPath: urlOf(`lang/${OCR_MODEL_VARIANT}`),
        cacheMethod: 'none',
        workerBlobURL: false,
        gzip: true,
      });
    })();
    worker = { lang, ready };
    ready.catch(() => {
      if (worker?.ready === ready) worker = null;
    });
    return ready;
  }

  async function terminateWorker(): Promise<void> {
    const current = worker;
    worker = null;
    if (current) await current.ready.then((w) => w.terminate()).catch(() => undefined);
  }

  return {
    async pendingDownloadBytes(lang) {
      if (deps.testOcr()) return 0;
      assertSupported(lang);
      return (await missingFiles(lang)).reduce((n, f) => n + f.bytes, 0);
    },

    async download(lang, onProgress, signal, onStall) {
      if (deps.testOcr()) return;
      assertSupported(lang);
      const link = anySignal([signal, serviceAbort.signal]);
      const missing = await missingFiles(lang, link);
      const total = missing.reduce((n, f) => n + f.bytes, 0);
      let done = 0;
      let lastByteAt = deps.now();
      let stalled = false;
      // The stall notice never stops the download (Requirement 8.10): the user chooses.
      const timer = setInterval(() => {
        if (!stalled && deps.now() - lastByteAt >= DOWNLOAD_STALL_MS) {
          stalled = true;
          onStall?.();
        }
      }, 1000);
      try {
        const opened = deps.openCache(cacheName());
        const cache = opened ? await opened : null;
        for (const file of missing) {
          if (link.aborted) throw new OcrError('cancelled');
          const res = await deps.fetch(urlOf(file.path), { signal: link });
          if (!res.ok || !res.body) throw new OcrError('assets-unavailable');
          const reader = res.body.getReader();
          const chunks: Uint8Array[] = [];
          let received = 0;
          for (;;) {
            const { done: finished, value } = await reader.read();
            if (finished) break;
            chunks.push(value);
            received += value.byteLength;
            done += value.byteLength;
            lastByteAt = deps.now();
            stalled = false;
            onProgress(done, total);
          }
          const bytes = new Uint8Array(received);
          let offset = 0;
          for (const c of chunks) {
            bytes.set(c, offset);
            offset += c.byteLength;
          }
          // Only a complete, verified file is ever stored (Requirement 8.6).
          if (received !== file.bytes || (await deps.sha256(bytes.buffer)) !== file.sha256) throw new OcrError('verification-failed');
          if (cache) await cache.put(urlOf(file.path), new Response(bytes, { status: 200 }));
        }
      } catch (e) {
        if (e instanceof OcrError) throw e;
        throw new OcrError(isAbort(e) || link.aborted ? 'cancelled' : 'assets-unavailable');
      } finally {
        clearInterval(timer);
      }
    },

    async recognize(image, lang, signal) {
      const hook = deps.testOcr();
      if (hook) {
        const pages = Array.isArray(hook) ? hook : [hook];
        const result = pages[Math.min(testPage, pages.length - 1)]!;
        testPage++;
        return result;
      }
      assertSupported(lang);
      const link = anySignal([signal, serviceAbort.signal]);
      if (link.aborted) throw new OcrError('cancelled');
      const w = await ensureWorker(lang);
      const aborted = new Promise<never>((_, reject) => {
        link.addEventListener('abort', () => reject(new OcrError('cancelled')), { once: true });
      });
      const result = await Promise.race([w.recognize(image, {}, { blocks: true, text: false }), aborted]);
      return mapTesseractBlocks(result.data.blocks);
    },

    async cancel() {
      serviceAbort.abort();
      serviceAbort = new AbortController();
      await terminateWorker();
    },
  };
}
