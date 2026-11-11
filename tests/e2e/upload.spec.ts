/**
 * tests/e2e/upload.spec.ts
 *
 * Task 28.3: the PDF is read in a real browser with the pdf.js worker, and
 * each fixture shows its field count or its rejection message.
 * Validates: Requirements 1.3, 4.1, 4.5, 11.4
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';

const fixture = (name: string) => path.resolve(process.cwd(), 'fixtures', name);

test.describe('"Try a sample form" (task 28.5)', () => {
  test('opening /forms/sample reads the bundled clinic form in the browser, sends nothing until the acknowledgement', async ({ page }) => {
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET') posts.push(r.url());
    });
    await page.goto('/forms/sample');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1, name: 'Upload your form' })).toBeVisible();
    await expect(page.getByText('Fields found: 22. Pages: 1.')).toBeVisible();
    expect(posts).toEqual([]);

    const analyze = page.waitForRequest((r) => r.url().endsWith('/api/forms/analyze'));
    await page.getByRole('button', { name: 'I understand, continue' }).click();
    const body = JSON.parse((await analyze).postData() ?? '{}') as { fields: Array<{ widgets: Array<{ pageSnippet: string }> }> };
    expect(body.fields).toHaveLength(22);
    // pdf.js ran on the sample too: printed labels reached the snippets.
    expect(body.fields.flatMap((f) => f.widgets.map((w) => w.pageSnippet)).join(' ')).toContain('Nama');
  });

  test('the picker button opens the same sample', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Try a sample form' }).click();
    await expect(page.getByText('Fields found: 22. Pages: 1.')).toBeVisible();
  });
});

test.describe('upload', () => {
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('English').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Upload your form' })).toBeVisible();
});

test('reads the clinic form in the browser and lists its 22 fields, with snippets from pdf.js', async ({ page }) => {
  const uploads: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET') uploads.push(r.url());
  });
  await page.getByLabel('Choose PDF file').setInputFiles(fixture('clinic-registration.pdf'));
  await expect(page.getByText('Fields found: 22. Pages: 1.')).toBeVisible();
  await page.getByText('Show the fields we found').click();
  await expect(page.locator('.field-list li')).toHaveCount(22);
  // Reading the PDF sends nothing: no POST before the user continues.
  expect(uploads).toEqual([]);

  // After the acknowledgement, the analysis request carries evidence only.
  const analyze = page.waitForRequest((r) => r.url().endsWith('/api/forms/analyze'));
  await page.getByRole('button', { name: 'I understand, continue' }).click();
  const body = JSON.parse((await analyze).postData() ?? '{}') as {
    fields: Array<{ fieldId: string; widgets: Array<{ pageSnippet: string }> }>;
  };
  expect(body.fields).toHaveLength(22);
  // pdf.js ran in the browser worker: printed labels reached the snippets.
  const snippets = body.fields.flatMap((f) => f.widgets.map((w) => w.pageSnippet)).filter(Boolean);
  expect(snippets.length).toBeGreaterThan(10);
  expect(snippets.join(' ')).toContain('Nama');
  // No PDF bytes: no "%PDF" header and no long base64 run in the body.
  const raw = JSON.stringify(body);
  expect(raw).not.toContain('%PDF');
  expect(raw).not.toMatch(/[A-Za-z0-9+/]{200,}/);
});

test('reads the US form (14 fields)', async ({ page }) => {
  await page.getByLabel('Choose PDF file').setInputFiles(fixture('us-community-clinic.pdf'));
  await expect(page.getByText('Fields found: 14. Pages: 1.')).toBeVisible();
});

for (const [file, message] of [
  ['encrypted.pdf', 'This PDF is password-protected. Please remove the password before uploading.'],
  ['xfa-acroform.pdf', 'This PDF uses an older format (XFA) that is not supported. Please use a standard AcroForm PDF.'],
  ['sig-populated.pdf', 'This PDF has already been signed and cannot be edited.'],
  ['no-fields.pdf', 'This PDF has no form fields to fill in.'],
] as const) {
  test(`rejects ${file} with its message and offers another try`, async ({ page }) => {
    await page.getByLabel('Choose PDF file').setInputFiles(fixture(file));
    await expect(page.getByText(message)).toBeVisible();
    await page.getByRole('button', { name: 'Try another file' }).click();
    await expect(page.getByLabel('Choose PDF file')).toBeFocused();
  });
}
});
