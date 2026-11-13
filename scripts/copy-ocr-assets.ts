/**
 * scripts/copy-ocr-assets.ts
 *
 * Copies the OCR engine and its language data from node_modules into
 * public/ocr/<tesseract.js version>/ so the app serves them from its own
 * origin (formbridge-any-document Requirement 8.1, design Q5). Runs before
 * `vite` and `vite build`. The output folder is generated and ignored by git.
 *
 *   public/ocr/<version>/
 *     worker.min.js
 *     core/tesseract-core*.wasm.js          every core build tesseract.js may pick
 *     lang/<variant>/<lang>.traineddata.gz  both variants until the OCR spike chooses
 *     manifest.json                         { version, files: [{ path, bytes, sha256 }], languages }
 *
 * The manifest lets the browser state the download size before downloading
 * (Requirement 8.5) and check each file after downloading it.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Language data packages copied, by Tesseract language code. */
export const OCR_LANGUAGES = ['eng', 'msa'] as const;
/** Model variants shipped in the `@tesseract.js-data/*` packages. */
export const OCR_VARIANTS = ['4.0.0', '4.0.0_best_int'] as const;

export interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface OcrManifest {
  version: string;
  files: ManifestFile[];
  /** Per language and variant: the manifest paths needed for that language (worker, cores, data file). */
  languages: Record<string, Record<string, string[]>>;
}

interface CopyOptions {
  /** Project root holding node_modules (default: the current directory). */
  root?: string;
  /** Folder the versioned asset folder is written into (default: <root>/public/ocr). */
  outRoot?: string;
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function readVersion(root: string): string {
  const pkg = JSON.parse(readFileSync(path.join(root, 'node_modules', 'tesseract.js', 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

export function copyOcrAssets(options: CopyOptions = {}): OcrManifest {
  const root = options.root ?? process.cwd();
  const version = readVersion(root);
  const outDir = path.join(options.outRoot ?? path.join(root, 'public', 'ocr'), version);
  const files: ManifestFile[] = [];

  const copy = (from: string, rel: string) => {
    const to = path.join(outDir, ...rel.split('/'));
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
    files.push({ path: rel, bytes: readFileSync(to).byteLength, sha256: sha256(to) });
  };

  copy(path.join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js');

  const coreDir = path.join(root, 'node_modules', 'tesseract.js-core');
  const cores = readdirSync(coreDir)
    .filter((f) => /^tesseract-core.*\.wasm\.js$/.test(f))
    .sort();
  if (cores.length === 0) throw new Error('No tesseract.js-core builds found');
  for (const core of cores) copy(path.join(coreDir, core), `core/${core}`);

  const languages: OcrManifest['languages'] = {};
  for (const lang of OCR_LANGUAGES) {
    languages[lang] = {};
    for (const variant of OCR_VARIANTS) {
      const rel = `lang/${variant}/${lang}.traineddata.gz`;
      copy(path.join(root, 'node_modules', '@tesseract.js-data', lang, variant, `${lang}.traineddata.gz`), rel);
      languages[lang]![variant] = ['worker.min.js', ...cores.map((c) => `core/${c}`), rel];
    }
  }

  const manifest: OcrManifest = { version, files, languages };
  writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = copyOcrAssets();
  const total = manifest.files.reduce((n, f) => n + f.bytes, 0);
  console.log(`OCR assets ${manifest.version}: ${manifest.files.length} files, ${(total / 1048576).toFixed(1)} MB`);
}
