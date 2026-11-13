/**
 * tests/unit/ocr-assets.test.ts
 *
 * The OCR asset copy step (formbridge-any-document task 2.20): every copied
 * file is listed in the manifest with its real size and SHA-256, each language
 * lists exactly the files it needs, and nothing points outside our folder.
 * Validates: Requirements 8.1, 8.3, 8.8
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyOcrAssets, OCR_LANGUAGES, OCR_VARIANTS, type OcrManifest } from '../../scripts/copy-ocr-assets.js';

let out: string;
let manifest: OcrManifest;

function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    return statSync(full).isDirectory() ? listFiles(full, rel) : [rel];
  });
}

beforeAll(() => {
  out = mkdtempSync(path.join(tmpdir(), 'ocr-assets-'));
  manifest = copyOcrAssets({ outRoot: out });
}, 60_000);

afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('copy-ocr-assets', () => {
  it('writes into a folder named after the pinned tesseract.js version', () => {
    const pinned = (JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> }).dependencies['tesseract.js'];
    expect(manifest.version).toBe(pinned);
    expect(readdirSync(out)).toEqual([pinned]);
  });

  it('lists every copied file exactly once with its real size and hash', () => {
    const dir = path.join(out, manifest.version);
    const onDisk = listFiles(dir).filter((f) => f !== 'manifest.json').sort();
    expect(manifest.files.map((f) => f.path).sort()).toEqual(onDisk);
    for (const f of manifest.files) {
      const bytes = readFileSync(path.join(dir, ...f.path.split('/')));
      expect(f.bytes).toBe(bytes.byteLength);
      expect(f.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
    expect(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'))).toEqual(manifest);
  });

  it('copies the worker, every core build and both variants of each language', () => {
    const paths = manifest.files.map((f) => f.path);
    expect(paths).toContain('worker.min.js');
    expect(paths.filter((p) => p.startsWith('core/')).length).toBeGreaterThanOrEqual(4);
    for (const lang of OCR_LANGUAGES) for (const v of OCR_VARIANTS) expect(paths).toContain(`lang/${v}/${lang}.traineddata.gz`);
  });

  it('each language and variant needs only its own data file plus the shared engine files', () => {
    const all = new Set(manifest.files.map((f) => f.path));
    for (const lang of OCR_LANGUAGES) {
      for (const v of OCR_VARIANTS) {
        const needed = manifest.languages[lang]![v]!;
        for (const p of needed) expect(all.has(p)).toBe(true);
        expect(needed.filter((p) => p.startsWith('lang/'))).toEqual([`lang/${v}/${lang}.traineddata.gz`]);
      }
    }
  });

  it('every path is relative and stays inside the asset folder', () => {
    for (const f of manifest.files) {
      expect(f.path).not.toMatch(/^[/\\]|\.\.|:/);
    }
  });
});
