/**
 * tests/unit/qpdf-lookup.test.ts
 *
 * The encrypted-fixture script finds qpdf through QPDF_PATH, then PATH, then
 * the default Windows install path.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { DEFAULT_WINDOWS_QPDF, resolveQpdf } from '../../scripts/create-fixtures/encrypted.js';

const existing = (...files: string[]) => (f: string) => files.includes(f);
const winPath = (...dirs: string[]) => dirs.join(path.delimiter);

describe('resolveQpdf', () => {
  it('uses QPDF_PATH when set, even when qpdf is also on PATH', () => {
    const qpdfOnPath = path.join('C:\\tools', 'qpdf.exe');
    expect(
      resolveQpdf({
        env: { QPDF_PATH: 'D:\\custom\\qpdf.exe', PATH: winPath('C:\\tools') },
        platform: 'win32',
        exists: existing(qpdfOnPath, DEFAULT_WINDOWS_QPDF),
      }),
    ).toBe('D:\\custom\\qpdf.exe');
  });

  it('ignores a blank QPDF_PATH', () => {
    expect(resolveQpdf({ env: { QPDF_PATH: '  ' }, platform: 'win32', exists: existing(DEFAULT_WINDOWS_QPDF) })).toBe(
      DEFAULT_WINDOWS_QPDF,
    );
  });

  it('uses qpdf from PATH before the default Windows path', () => {
    const onPath = path.join('C:\\tools', 'qpdf.exe');
    expect(
      resolveQpdf({ env: { Path: winPath('C:\\other', 'C:\\tools') }, platform: 'win32', exists: existing(onPath, DEFAULT_WINDOWS_QPDF) }),
    ).toBe(onPath);
  });

  it('falls back to the default Windows install path', () => {
    expect(resolveQpdf({ env: { PATH: winPath('C:\\tools') }, platform: 'win32', exists: existing(DEFAULT_WINDOWS_QPDF) })).toBe(
      DEFAULT_WINDOWS_QPDF,
    );
    expect(DEFAULT_WINDOWS_QPDF).toBe('C:\\Program Files\\qpdf 12.4.2\\bin\\qpdf.exe');
  });

  it('returns undefined when qpdf is nowhere, and never uses the Windows path elsewhere', () => {
    expect(resolveQpdf({ env: {}, platform: 'win32', exists: existing() })).toBeUndefined();
    expect(resolveQpdf({ env: {}, platform: 'linux', exists: existing(DEFAULT_WINDOWS_QPDF) })).toBeUndefined();
  });
});
