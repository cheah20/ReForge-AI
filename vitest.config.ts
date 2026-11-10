import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Use jsdom for frontend component tests, node for worker/lib tests
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'src/shared'),
        '@packs': path.resolve(__dirname, 'src/packs'),
        '@lib': path.resolve(__dirname, 'src/lib'),
        '@worker': path.resolve(__dirname, 'src/worker'),
        '@frontend': path.resolve(__dirname, 'src/frontend'),
      },
    },
  },
});
