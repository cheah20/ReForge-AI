/**
 * tests/unit/document-ocr.test.ts
 *
 * The OCR service (formbridge-any-document tasks 9.4 and 9.5) with a fake
 * `createWorker` and a fake `fetch`: one worker created on first use and
 * reused, cancel ends it, only the chosen language is listed and downloaded, a
 * broken or cancelled download leaves nothing in the cache, the stall notice
 * at 30 seconds, only manifest paths in the cache, every createWorker path on
 * our own origin, and no test hook in a production build.
 * Validates: Requirements 8.1, 8.2, 8.3, 8.6, 8.8, 8.10, 24.9
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { build } from 'vite';
import {
  createOcrService,
  neededFiles,
  OcrError,
  type CacheLike,
  type CoreBuild,
  type OcrDeps,
  type OcrManifest,
  type WorkerLike,
} from '../../src/frontend/document/ocr.js';
import type { OcrPageResult } from '../../src/lib/document/ocr-map.js';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bytesOf = (path: string) => new TextEncoder().encode(`file:${path}`);

const PATHS = [
  'worker.min.js',
  'core/tesseract-core-lstm.wasm.js',
  'core/tesseract-core-simd-lstm.wasm.js',
  'core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'lang/4.0.0_best_int/eng.traineddata.gz',
  'lang/4.0.0_best_int/msa.traineddata.gz',
  'lang/4.0.0/eng.traineddata.gz',
];
const MANIFEST: OcrManifest = { version: '7.0.0', files: PATHS.map((path) => ({ path, bytes: bytesOf(path).byteLength, sha256: sha(bytesOf(path)) })) };
const NEEDED_ENG = ['worker.min.js', 'core/tesseract-core-simd-lstm.wasm.js', 'lang/4.0.0_best_int/eng.traineddata.gz'];

function streamOf(bytes: Uint8Array, chunk = 8): Response {
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
    },
  });
  return new Response(body, { status: 200 });
}

interface Fixture {
  deps: OcrDeps;
  fetched: string[];
  cache: Map<string, Uint8Array>;
  workers: Array<{ lang: string; options: Record<string, unknown>; terminated: boolean; recognized: number }>;
  setClock(ms: number): void;
}

function setup(over: { corrupt?: string; core?: CoreBuild; cached?: string[]; testOcr?: OcrDeps['testOcr']; slow?: boolean; recognize?: () => Promise<{ data: { blocks?: unknown } }> } = {}): Fixture {
  const fetched: string[] = [];
  const cache = new Map<string, Uint8Array>();
  for (const p of over.cached ?? []) cache.set(`/ocr/7.0.0/${p}`, bytesOf(p));
  const workers: Fixture['workers'] = [];
  let clock = 0;
  const cacheLike: CacheLike = {
    match: async (r) => cache.get(r),
    put: async (r, res) => void cache.set(r, new Uint8Array(await res.arrayBuffer())),
  };
  const deps: OcrDeps = {
    async fetch(input, init) {
      fetched.push(input);
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (input === '/ocr/current.json') return new Response(JSON.stringify({ version: '7.0.0' }));
      if (input === '/ocr/7.0.0/manifest.json') return new Response(JSON.stringify(MANIFEST));
      const path = input.replace('/ocr/7.0.0/', '');
      if (!PATHS.includes(path)) return new Response('', { status: 404 });
      const bytes = path === over.corrupt ? new TextEncoder().encode(`xxxx:${path}`.padEnd(bytesOf(path).byteLength, 'x')) : bytesOf(path);
      if (over.slow) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes.slice(0, 4));
              init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
            },
          }),
        );
      }
      return streamOf(bytes);
    },
    openCache: () => Promise.resolve(cacheLike),
    loadTesseract: async () => ({
      async createWorker(lang, _oem, options) {
        const rec = { lang, options, terminated: false, recognized: 0 };
        workers.push(rec);
        const w: WorkerLike = {
          recognize: over.recognize ?? (async () => (rec.recognized++, { data: { blocks: [{ paragraphs: [{ lines: [{ text: 'Name:', confidence: 90, bbox: { x0: 0, y0: 0, x1: 10, y1: 5 }, words: [] }] }] }] } })),
          terminate: async () => void (rec.terminated = true),
        };
        return w;
      },
    }),
    detectCore: async () => over.core ?? 'simd-lstm',
    sha256: async (b) => sha(new Uint8Array(b)),
    now: () => clock,
    testOcr: over.testOcr ?? (() => undefined),
  };
  return { deps, fetched, cache, workers, setClock: (ms) => void (clock = ms) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('which files are needed (8.3)', () => {
  it('lists the worker, one core build and the one language file, for each core build', () => {
    expect(neededFiles(MANIFEST, 'eng', 'simd-lstm').map((f) => f.path)).toEqual(NEEDED_ENG);
    expect(neededFiles(MANIFEST, 'msa', 'lstm').map((f) => f.path)).toEqual(['worker.min.js', 'core/tesseract-core-lstm.wasm.js', 'lang/4.0.0_best_int/msa.traineddata.gz']);
  });

  it('throws when the manifest lacks a needed file', () => {
    expect(() => neededFiles({ version: '7.0.0', files: [] }, 'eng', 'lstm')).toThrow(OcrError);
  });

  it('pendingDownloadBytes counts only the chosen language, minus what is cached', async () => {
    const f = setup();
    const sum = (paths: string[]) => paths.reduce((n, p) => n + bytesOf(p).byteLength, 0);
    const svc = createOcrService(f.deps);
    expect(await svc.pendingDownloadBytes('eng')).toBe(sum(NEEDED_ENG));
    expect(await svc.pendingDownloadBytes('msa')).toBe(sum(['worker.min.js', 'core/tesseract-core-simd-lstm.wasm.js', 'lang/4.0.0_best_int/msa.traineddata.gz']));
    const cached = createOcrService(setup({ cached: NEEDED_ENG.slice(0, 2) }).deps);
    expect(await cached.pendingDownloadBytes('eng')).toBe(sum([NEEDED_ENG[2]!]));
    expect(await createOcrService(setup({ cached: NEEDED_ENG }).deps).pendingDownloadBytes('eng')).toBe(0);
  });

  it('a language that is not validated is refused', async () => {
    const svc = createOcrService(setup().deps);
    await expect(svc.pendingDownloadBytes('tam' as never)).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('download (8.5, 8.6, 8.8, 8.10)', () => {
  it('downloads only the needed files, reports progress up to the total and caches only manifest paths', async () => {
    const f = setup();
    const svc = createOcrService(f.deps);
    const total = await svc.pendingDownloadBytes('eng');
    const progress: Array<[number, number]> = [];
    await svc.download('eng', (d, t) => progress.push([d, t]), new AbortController().signal);
    expect(progress.at(-1)).toEqual([total, total]);
    expect(progress.every(([, t]) => t === total)).toBe(true);
    expect(progress.map(([d]) => d)).toEqual([...progress.map(([d]) => d)].sort((a, b) => a - b));
    expect(f.fetched.filter((u) => !u.endsWith('.json'))).toEqual(NEEDED_ENG.map((p) => `/ocr/7.0.0/${p}`));
    expect([...f.cache.keys()].sort()).toEqual(NEEDED_ENG.map((p) => `/ocr/7.0.0/${p}`).sort());
    for (const key of f.cache.keys()) expect(MANIFEST.files.some((m) => `/ocr/7.0.0/${m.path}` === key)).toBe(true);
    expect(await svc.pendingDownloadBytes('eng')).toBe(0);
  });

  it('a second download fetches nothing that is already cached', async () => {
    const f = setup({ cached: NEEDED_ENG });
    await createOcrService(f.deps).download('eng', () => {}, new AbortController().signal);
    expect(f.fetched.filter((u) => !u.endsWith('.json'))).toEqual([]);
  });

  it('a file with the wrong hash fails verification and is not cached, nor are later files fetched', async () => {
    const f = setup({ corrupt: 'core/tesseract-core-simd-lstm.wasm.js' });
    await expect(createOcrService(f.deps).download('eng', () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'verification-failed' });
    expect([...f.cache.keys()]).toEqual(['/ocr/7.0.0/worker.min.js']);
    expect(f.fetched).not.toContain('/ocr/7.0.0/lang/4.0.0_best_int/eng.traineddata.gz');
  });

  it('a missing file is reported as unavailable', async () => {
    const f = setup();
    const broken: OcrDeps = { ...f.deps, fetch: async (input, init) => (input.endsWith('worker.min.js') ? new Response('', { status: 404 }) : f.deps.fetch(input, init)) };
    await expect(createOcrService(broken).download('eng', () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'assets-unavailable' });
    expect(f.cache.size).toBe(0);
  });

  it('cancelling mid-download stops it and leaves the unfinished file out of the cache', async () => {
    const f = setup({ slow: true });
    const svc = createOcrService(f.deps);
    const controller = new AbortController();
    const running = svc.download('eng', () => {}, controller.signal);
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
    expect(f.cache.size).toBe(0);
  });

  it('service.cancel() also stops a running download', async () => {
    const f = setup({ slow: true });
    const svc = createOcrService(f.deps);
    const running = svc.download('eng', () => {}, new AbortController().signal);
    await new Promise((r) => setTimeout(r, 20));
    await svc.cancel();
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
    expect(f.cache.size).toBe(0);
  });

  it('shows the stall notice once after 30 seconds without new bytes, and the download is not stopped by it', async () => {
    vi.useFakeTimers();
    const f = setup({ slow: true });
    const svc = createOcrService(f.deps);
    const onStall = vi.fn();
    const controller = new AbortController();
    const running = svc.download('eng', () => {}, controller.signal, onStall).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(500);
    f.setClock(29_000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(onStall).not.toHaveBeenCalled();
    f.setClock(31_000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(onStall).toHaveBeenCalledTimes(1);
    f.setClock(60_000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onStall).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(await running).toMatchObject({ code: 'cancelled' });
  });
});

describe('recognize and the single worker (8.2, 8.3, 8.6)', () => {
  const image = {};
  const live = () => new AbortController().signal;

  it('creates no worker until the first page and reuses one worker for every later page', async () => {
    const f = setup();
    const svc = createOcrService(f.deps);
    expect(f.workers).toHaveLength(0);
    const r1 = await svc.recognize(image, 'eng', live());
    await svc.recognize(image, 'eng', live());
    expect(f.workers).toHaveLength(1);
    expect(f.workers[0]!.recognized).toBe(2);
    expect(r1.lines.map((l) => l.text)).toEqual(['Name:']);
  });

  it('two requests at the same time still make one worker', async () => {
    const f = setup();
    const svc = createOcrService(f.deps);
    await Promise.all([svc.recognize(image, 'eng', live()), svc.recognize(image, 'eng', live())]);
    expect(f.workers).toHaveLength(1);
  });

  it('a different language ends the old worker first, so at most one runs at a time', async () => {
    const f = setup();
    const svc = createOcrService(f.deps);
    await svc.recognize(image, 'eng', live());
    await svc.recognize(image, 'msa', live());
    expect(f.workers.map((w) => [w.lang, w.terminated])).toEqual([['eng', true], ['msa', false]]);
  });

  it('cancel ends the worker, and the next page starts a new one', async () => {
    const f = setup();
    const svc = createOcrService(f.deps);
    await svc.recognize(image, 'eng', live());
    await svc.cancel();
    expect(f.workers[0]!.terminated).toBe(true);
    await svc.recognize(image, 'eng', live());
    expect(f.workers).toHaveLength(2);
    expect(f.workers[1]!.terminated).toBe(false);
  });

  it('cancelling during recognition rejects it at once with `cancelled` and ends the worker', async () => {
    const f = setup({ recognize: () => new Promise(() => {}) });
    const svc = createOcrService(f.deps);
    const running = svc.recognize(image, 'eng', live()).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 20));
    await svc.cancel();
    expect(await running).toMatchObject({ code: 'cancelled' });
    expect(f.workers[0]!.terminated).toBe(true);
  });

  it('an already aborted signal never starts a worker', async () => {
    const f = setup();
    const c = new AbortController();
    c.abort();
    await expect(createOcrService(f.deps).recognize(image, 'eng', c.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(f.workers).toHaveLength(0);
  });

  it('passes engine, core and language paths on our own origin, with the library cache off and LSTM only', async () => {
    const f = setup({ core: 'relaxedsimd-lstm' });
    await createOcrService(f.deps).recognize(image, 'msa', live());
    expect(f.workers[0]!.options).toEqual({
      workerPath: '/ocr/7.0.0/worker.min.js',
      corePath: '/ocr/7.0.0/core/tesseract-core-relaxedsimd-lstm.wasm.js',
      langPath: '/ocr/7.0.0/lang/4.0.0_best_int',
      cacheMethod: 'none',
      workerBlobURL: false,
      gzip: true,
    });
    expect(f.workers[0]!.lang).toBe('msa');
  });

  it('a language that is not validated starts no worker', async () => {
    const f = setup();
    await expect(createOcrService(f.deps).recognize(image, 'chi_sim' as never, live())).rejects.toMatchObject({ code: 'unsupported' });
    expect(f.workers).toHaveLength(0);
  });
});

describe('the test hook (design Q8)', () => {
  const result = (text: string): OcrPageResult => ({ lines: [{ text, box: { left: 0, top: 0, right: 5, bottom: 5 }, confidence: 0.9, words: [] }], wordCount: 1, meanLineConfidence: 0.9 });

  it('returns the prepared result per page, repeats the last, needs no download and starts no worker', async () => {
    const f = setup({ testOcr: () => [result('first'), result('second')] });
    const svc = createOcrService(f.deps);
    expect(await svc.pendingDownloadBytes('eng')).toBe(0);
    await svc.download('eng', () => {}, new AbortController().signal);
    const pages = [];
    for (let i = 0; i < 3; i++) pages.push((await svc.recognize({}, 'eng', new AbortController().signal)).lines[0]!.text);
    expect(pages).toEqual(['first', 'second', 'second']);
    expect(f.workers).toHaveLength(0);
    expect(f.fetched).toEqual([]);
  });

  async function bundle(mode: 'production' | 'development'): Promise<string> {
    // Vitest runs with NODE_ENV=test, which Vite would treat as "not production": build as `npm run build` does.
    vi.stubEnv('NODE_ENV', mode);
    const out = await build({
      configFile: false,
      mode,
      logLevel: 'silent',
      build: {
        write: false,
        minify: mode === 'production',
        lib: { entry: 'src/frontend/document/ocr.ts', formats: ['es'], fileName: 'ocr' },
        rollupOptions: { external: ['tesseract.js'] },
      },
    });
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []));
    return outputs.map((o) => ('code' in o ? o.code : '')).join('\n');
  }

  it('is in a development build and absent from a production build', async () => {
    expect(await bundle('development')).toContain('__REFORGE_TEST_OCR__');
    expect(await bundle('production')).not.toContain('__REFORGE_TEST_OCR__');
  }, 60_000);
});

describe('static check (8.1)', () => {
  it('every createWorker call in the app passes workerPath, corePath and langPath built from the /ocr base', () => {
    const source = readFileSync('src/frontend/document/ocr.ts', 'utf8');
    expect(source.match(/createWorker\(/g)?.length).toBe(2); // the type and the one call
    for (const key of ['workerPath', 'corePath', 'langPath']) expect(source).toMatch(new RegExp(`${key}: urlOf\\(`));
    expect(source).toContain("export const OCR_BASE_PATH = '/ocr';");
    expect(source).not.toMatch(/https?:\/\//);
  });
});
