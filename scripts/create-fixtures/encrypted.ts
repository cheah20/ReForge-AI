/**
 * scripts/create-fixtures/encrypted.ts
 *
 * Generates fixtures/encrypted.pdf: the two-field base form from
 * create-fixtures.ts, encrypted with qpdf (AES-256).
 *
 *   npm run generate-encrypted-fixture
 *
 * qpdf is found in this order:
 *   1. the QPDF_PATH environment variable, if set
 *   2. qpdf (qpdf.exe on Windows) on PATH
 *   3. the default Windows install path, C:\Program Files\qpdf 12.4.2\bin\qpdf.exe
 * Tested with qpdf 12.4.2 (https://qpdf.readthedocs.io/).
 *
 * User password:  fixture-open-only
 * Owner password: fixture-owner-only
 *
 * AES-256 uses a random IV, so each run gives byte-different but structurally
 * equivalent output. Verify by opening the file: it must ask for a password,
 * and `fixture-open-only` must open it.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { buildEncryptedBase } from './create-fixtures.js';

export const DEFAULT_WINDOWS_QPDF = 'C:\\Program Files\\qpdf 12.4.2\\bin\\qpdf.exe';
const USER_PASSWORD = 'fixture-open-only';
const OWNER_PASSWORD = 'fixture-owner-only';

export interface QpdfLookup {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  exists: (file: string) => boolean;
}

/**
 * The qpdf executable to run, or undefined if none is found.
 * QPDF_PATH wins when set (even if it does not exist, so a typo fails loudly).
 */
export function resolveQpdf({ env, platform, exists }: QpdfLookup): string | undefined {
  const explicit = env['QPDF_PATH']?.trim();
  if (explicit) return explicit;

  const names = platform === 'win32' ? ['qpdf.exe', 'qpdf'] : ['qpdf'];
  const dirs = (env['PATH'] ?? env['Path'] ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir.replace(/^"|"$/g, ''), name);
      if (exists(candidate)) return candidate;
    }
  }

  if (platform === 'win32' && exists(DEFAULT_WINDOWS_QPDF)) return DEFAULT_WINDOWS_QPDF;
  return undefined;
}

const isFile = (file: string) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

async function main() {
  const qpdf = resolveQpdf({ env: process.env, platform: process.platform, exists: isFile });
  if (!qpdf) {
    console.error('qpdf not found. Install qpdf, add it to PATH, or set QPDF_PATH to qpdf.exe.');
    process.exitCode = 1;
    return;
  }

  const output = path.join(process.cwd(), 'fixtures', 'encrypted.pdf');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reforge-encrypted-'));
  const base = path.join(tmp, 'encrypted-base.pdf');
  try {
    fs.writeFileSync(base, await buildEncryptedBase());
    // Argument array, no shell: paths with spaces need no quoting.
    execFileSync(qpdf, ['--encrypt', USER_PASSWORD, OWNER_PASSWORD, '256', '--', base, output], { stdio: 'inherit' });
    console.log(`Created ${output} with ${qpdf}`);
  } catch (err) {
    console.error(`qpdf failed (${qpdf}).`, err);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
