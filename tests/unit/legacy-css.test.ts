/**
 * tests/unit/legacy-css.test.ts
 *
 * accessforge-skeleton task 4.2: the legacy stylesheet loads nothing else, keeps
 * its deliberate low-contrast traits, and keeps the banner readable.
 * Validates: Requirements 1.6, 1.9, 1.12, 4.1
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('public/legacy-assets/portal.css', 'utf8');
const body = css.replace(/\/\*[\s\S]*?\*\//g, '');

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** The value of `prop` in the first rule whose selector list contains `selector`. */
function value(selector: string, prop: string): string {
  for (const m of body.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = m[1]!.split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    const v = m[2]!.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`));
    if (v) return v[1]!.trim().toLowerCase();
  }
  throw new Error(`${selector} { ${prop} } not found`);
}

describe('portal.css', () => {
  it('has no url( and no @import, so it loads nothing else', () => {
    expect(body).not.toMatch(/url\s*\(/i);
    expect(body).not.toMatch(/@import/i);
  });

  it('label text on the label cell stays below 4.5:1 (deliberate legacy trait)', () => {
    expect(contrast(value('td.label', 'color'), value('td.label', 'background'))).toBeLessThan(4.5);
  });

  it('body text on the content cell stays below 4.5:1 (deliberate legacy trait)', () => {
    expect(contrast(value('td.content', 'color'), value('td.content', 'background'))).toBeLessThan(4.5);
    expect(contrast(value('td.field', 'color'), value('td.field', 'background'))).toBeLessThan(4.5);
  });

  it('the banner keeps at least 7:1 (decision J)', () => {
    expect(contrast(value('.banner', 'color'), value('.banner', 'background'))).toBeGreaterThanOrEqual(7);
  });

  it('every font size is in px and at most 12 px for labels and body text', () => {
    const sizes = [...body.matchAll(/font-size\s*:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(sizes.length).toBeGreaterThan(5);
    for (const s of sizes) expect(s).toMatch(/^\d+px$/);
    for (const sel of ['body', 'td.label', 'td.content', 'td.field input']) expect(parseInt(value(sel, 'font-size'), 10)).toBeLessThanOrEqual(12);
  });
});
