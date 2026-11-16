import { defineConfig, devices } from '@playwright/test';

/**
 * Real OCR runs only (formbridge-any-document tasks 3.3 and 14.1), started by
 * hand and kept out of `npm test` and `npm run test:e2e`:
 *
 *   npm run copy-ocr-assets
 *   $env:PW_CHANNEL='chrome'; npx playwright test -c playwright.ocr.config.ts
 *
 * No web server: each test serves its page, the OCR engine from public/ocr and
 * the fixtures from one fake origin through Playwright routes.
 */
export default defineConfig({
  testDir: './tests/ocr',
  testMatch: /.*\.spec\.ts$/,
  timeout: 15 * 60_000,
  workers: 1,
  reporter: 'line',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(process.env['PW_CHANNEL'] ? { channel: process.env['PW_CHANNEL'] } : {}) },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
});
