/**
 * tests/unit/aliases.test.ts
 *
 * Review item 13: the path aliases from tsconfig.json resolve in Vitest too.
 * These imports fail to resolve when the aliases sit under `test.resolve`.
 */

import { describe, it, expect } from 'vitest';
import { AnalyzeRequestSchema } from '@shared/schemas';
import { getCountryPack } from '@packs/country/registry';
import { batchFields } from '@lib/batch';
import { AnalyzeRequestSchema as Direct } from '../../src/shared/schemas.js';

describe('path aliases', () => {
  it('resolve @shared to the same module as the relative path', () => {
    expect(AnalyzeRequestSchema).toBe(Direct);
  });

  it('resolve @packs and @lib', () => {
    expect(getCountryPack('XX').code).toBe('universal');
    expect(batchFields([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });
});
