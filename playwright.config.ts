import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'html',
  // Tests tagged @smoke run against a deployed URL; they are left out unless BASE_URL is set
  // (accessforge-skeleton task 19.1).
  ...(process.env['BASE_URL'] ? {} : { grepInvert: /@smoke/ }),
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      // PW_CHANNEL=msedge or chrome runs the tests in an installed browser
      // instead of the Playwright download (`npx playwright install chromium`).
      use: { ...devices['Desktop Chrome'], ...(process.env['PW_CHANNEL'] ? { channel: process.env['PW_CHANNEL'] } : {}) },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      // FormBridge Document_Path on a small phone (formbridge-any-document Requirement 27.9).
      // Only the Document_Path specs that need a phone run here.
      name: 'mobile-chromium',
      testMatch: /document-.*mobile.*\.spec\.ts$/,
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 360, height: 640 },
        hasTouch: true,
        isMobile: true,
        ...(process.env['PW_CHANNEL'] ? { channel: process.env['PW_CHANNEL'] } : {}),
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
  },
});
