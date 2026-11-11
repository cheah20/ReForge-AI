/**
 * tests/unit/tokens.test.ts
 *
 * Task 34.1: WCAG AA contrast for every text and control colour pair in
 * tokens.css, computed with the WCAG 2.x relative-luminance formula.
 * Validates: Requirement 13.5
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.resolve(__dirname, '../../src/frontend/tokens.css'), 'utf8');

function token(name: string): string {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --color-${name} missing`);
  return m[1]!;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('contrast()', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});

describe('design tokens meet WCAG AA', () => {
  const backgrounds = ['paper', 'surface', 'stamp-blue-light'];
  const text = ['ink', 'ink-secondary', 'stamp-blue', 'approval-green', 'alert-red', 'caution-amber'];

  for (const fg of text) {
    for (const bg of backgrounds) {
      it(`${fg} text on ${bg} is at least 4.5:1`, () => {
        expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('button text on the primary button and on its hover colour is at least 4.5:1', () => {
    expect(contrast(token('on-primary'), token('stamp-blue'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('on-primary'), token('stamp-blue-dark'))).toBeGreaterThanOrEqual(4.5);
  });

  it('control borders and the focus ring are at least 3:1 on every background', () => {
    for (const bg of backgrounds) {
      expect(contrast(token('control-border'), token(bg))).toBeGreaterThanOrEqual(3);
      expect(contrast(token('stamp-blue'), token(bg))).toBeGreaterThanOrEqual(3);
    }
  });

  it('the decorative border token is below 3:1, so no control may rely on it alone', () => {
    // Documents why control-border exists (design.md, Frontend design plan).
    expect(contrast(token('border'), token('paper'))).toBeLessThan(3);
  });

  it('components use no raw hex colours outside tokens.css', () => {
    const app = readFileSync(path.resolve(__dirname, '../../src/frontend/app.css'), 'utf8');
    expect(app).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
