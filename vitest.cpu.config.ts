import { defineConfig } from 'vitest/config';
import base from './vitest.config';

// Timing tests run alone, one file at a time, so other test files cannot add
// load to the measured requests. Used by `npm run test:cpu`. The include list
// replaces the base list (mergeConfig would append to it).
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tests/cpu/**/*.test.ts'],
    fileParallelism: false,
  },
});
