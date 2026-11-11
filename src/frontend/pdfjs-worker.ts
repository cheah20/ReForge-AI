/**
 * src/frontend/pdfjs-worker.ts
 *
 * pdf.js needs its worker script in the browser (task 28.3). Vite serves the
 * worker file from the installed pdfjs-dist; both modules load only when the
 * first PDF is read, so they stay out of the start-up bundle.
 */

let ready: Promise<void> | null = null;

export function ensurePdfJsWorker(): Promise<void> {
  if (!ready) {
    ready = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
      ([pdfjs, worker]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      },
    );
  }
  return ready;
}
