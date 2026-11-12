/**
 * playwright.smoke.config.ts
 *
 * Live smoke test against the deployed app (task 37.2). Uses real AI and spends
 * neurons, so it is never part of `npm run test:e2e`; run it on purpose:
 *   $env:SMOKE_URL='https://reforge-ai.cheah20.workers.dev'; npx playwright test --config playwright.smoke.config.ts
 * No dev server is started.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  workers: 1,
  retries: 0,
  reporter: 'line',
  timeout: 300_000,
  use: {
    baseURL: process.env['SMOKE_URL'] ?? 'https://reforge-ai.cheah20.workers.dev',
    trace: 'off',
  },
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: process.env['PW_CHANNEL'] ?? 'chrome' },
    },
  ],
});
