/**
 * scripts/create-fixtures/encrypted.ts
 *
 * Generates fixtures/encrypted.pdf: the two-field base form from
 * create-fixtures.ts, encrypted with qpdf (AES-256).
 *
 *   npx tsx scripts/create-fixtures/encrypted.ts
 *
 * Needs qpdf 11.x on PATH (https://qpdf.readthedocs.io/).
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
import { buildEncryptedBase } from './create-fixtures.js';

const OUTPUT = path.join(process.cwd(), 'fixtures', 'encrypted.pdf');
const USER_PASSWORD = 'fixture-open-only';
const OWNER_PASSWORD = 'fixture-owner-only';

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reforge-encrypted-'));
  const base = path.join(tmp, 'encrypted-base.pdf');
  try {
    fs.writeFileSync(base, await buildEncryptedBase());
    // Argument array, no shell: paths with spaces need no quoting.
    execFileSync('qpdf', ['--encrypt', USER_PASSWORD, OWNER_PASSWORD, '256', '--', base, OUTPUT], {
      stdio: 'inherit',
    });
    console.log(`Created ${OUTPUT}`);
  } catch (err) {
    console.error('qpdf failed or is not installed. Install qpdf 11.x and re-run.', err);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

void main();
