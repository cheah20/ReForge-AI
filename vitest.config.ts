import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Aliases live at the top level: Vitest ignores `test.resolve`.
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@packs': path.resolve(__dirname, 'src/packs'),
      '@lib': path.resolve(__dirname, 'src/lib'),
      '@worker': path.resolve(__dirname, 'src/worker'),
      '@frontend': path.resolve(__dirname, 'src/frontend'),
    },
  },
  test: {
    // Node by default; frontend tests opt in with `// @vitest-environment jsdom`.
    environment: 'node',
    globals: true,
    // PDF parsing and font subsetting are CPU-heavy. With every file running in
    // parallel, single tests passed alone in 1-2 s but crossed the 5 s default.
    testTimeout: 20_000,
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'src/**/*.test.ts'],
  },
});
