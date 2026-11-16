/**
 * tests/unit/accessforge-no-duplicate-validation.test.ts
 *
 * accessforge-skeleton task 16.15 (design "No duplicated validation"). Fails
 * when AccessForge code defines its own IC, phone, postcode, email or date
 * rule instead of calling the shared country-pack functions. Every `.ts` and
 * `.tsx` file under src/lib/accessforge/ and src/frontend/accessforge/ is
 * parsed with the TypeScript compiler, so regular expressions and function
 * names are found exactly, not by text search.
 * Validates: Requirements 9.14, 9.15
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '../..');
const DIRS = ['src/lib/accessforge', 'src/frontend/accessforge'];

/** Fragments typical of the country-pack rules. */
const RULE_FRAGMENTS: Array<[string, RegExp]> = [
  ['six digits', /\\d\{6\}/],
  ['five digits', /\\d\{5\}/],
  ['twelve digits', /\\d\{12\}/],
  ['a two-digit date part', /\\d\{2\}\[-\/\\\/]/],
  ['the Malaysian country code', /\\?\+\??60/],
  ['an email at-sign', /@/],
  ['digits only', /^\^\\d[+*]\$$/],
];

/** Patterns the spec needs, each reviewed: file name and exact source. */
const ALLOWED: Array<{ file: string; source: string; reason: string }> = [
  { file: 'src/lib/accessforge/verifier.ts', source: '^SR-DEMO-\\d{8}-\\d{6}$', reason: 'Reference_Number pattern, Requirement 10.11' },
  { file: 'src/lib/accessforge/transformations.ts', source: '\\bHH\\/BB\\/TTTT\\b', reason: 'Malay date-format abbreviation, design Question 8' },
];

const VALIDATOR_NAME = /validate(Ic|Phone|Postcode|Email|Date)|isValid.*Date|daysInMonth|isLeap/i;
const DATE_FILES = ['src/lib/accessforge/transformations.ts', 'src/frontend/accessforge/MirrorStep.tsx'];
const DATE_ARITHMETIC = [/\bDate\.UTC\b/, /\bnew Date\(/, /\.getDate\(\)/];

export interface Finding {
  file: string;
  what: string;
}

/** The checks on one source file. Exported so the test can prove they catch a rule. */
export function check(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const regexSource = (source: string) => {
    if (ALLOWED.some((a) => a.file === file && a.source === source)) return;
    for (const [name, re] of RULE_FRAGMENTS) if (re.test(source)) findings.push({ file, what: `regular expression with ${name}: /${source}/` });
  };
  const visit = (node: ts.Node) => {
    if (ts.isRegularExpressionLiteral(node)) {
      const lit = node.text;
      regexSource(lit.slice(1, lit.lastIndexOf('/')));
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'RegExp') {
      const arg = node.arguments?.[0];
      regexSource(arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) ? arg.text : '<dynamic>');
      if (!arg || !(ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) findings.push({ file, what: 'new RegExp with a computed source' });
    }
    const named =
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name
        ? node.name.getText(sf)
        : ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
          ? node.name.getText(sf)
          : null;
    if (named && VALIDATOR_NAME.test(named)) findings.push({ file, what: `validator-like function ${named}` });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (DATE_FILES.includes(file)) for (const re of DATE_ARITHMETIC) if (re.test(text)) findings.push({ file, what: `date arithmetic ${re.source}` });
  return findings;
}

function sources(): Array<[string, string]> {
  return DIRS.flatMap((dir) =>
    readdirSync(path.join(ROOT, dir))
      .filter((f) => /\.tsx?$/.test(f))
      .map((f): [string, string] => [`${dir}/${f}`, readFileSync(path.join(ROOT, dir, f), 'utf8')]),
  );
}

describe('no duplicated validation in AccessForge', () => {
  it('reads a real set of files', () => {
    const files = sources().map(([f]) => f);
    expect(files).toContain('src/lib/accessforge/transformations.ts');
    expect(files).toContain('src/frontend/accessforge/MirrorStep.tsx');
    expect(files.length).toBeGreaterThan(15);
  });

  it('finds no rule-like pattern, validator-like function or date arithmetic', () => {
    expect(sources().flatMap(([f, t]) => check(f, t))).toEqual([]);
  });

  it('uses the allowed patterns where the spec needs them', () => {
    for (const a of ALLOWED) expect(readFileSync(path.join(ROOT, a.file), 'utf8'), a.reason).toContain(a.source);
  });

  it('transformations.ts imports the shared validators', () => {
    const text = readFileSync(path.join(ROOT, 'src/lib/accessforge/transformations.ts'), 'utf8');
    expect(text).toMatch(/import \{ validateAnswer \} from '..\/..\/packs\/country\/validate\.js'/);
    expect(text).toMatch(/import \{ myPack \} from '..\/..\/packs\/country\/my\.js'/);
    expect(text).toMatch(/import \{[^}]*\bformatDate\b[^}]*\bisValidCalendarDate\b[^}]*\} from '..\/..\/packs\/country\/dates\.js'/);
  });

  it.each([
    ['an IC rule', 'const IC = /^(\\d{6})-?(\\d{2})-?(\\d{4})$/;'],
    ['a postcode rule', 'const ok = (v: string) => /^\\d{5}$/.test(v);'],
    ['a phone rule', "const re = new RegExp('^\\\\+?60');"],
    ['an email rule', 'const EMAIL = /^[^@]+@[^@]+$/;'],
    ['a digits-only rule', 'const D = /^\\d+$/;'],
    ['a validator function', 'export function validateIc(v: string) { return v; }'],
    ['an arrow validator', 'const isValidBirthDate = (d: number) => d > 0;'],
    ['a leap-year helper', 'function isLeapYear(y: number) { return y % 4 === 0; }'],
  ])('catches %s', (_label, code) => {
    expect(check('src/lib/accessforge/sample.ts', code).length).toBeGreaterThan(0);
  });

  it('catches date arithmetic in the date files', () => {
    expect(check('src/lib/accessforge/transformations.ts', 'const d = new Date(1990, 0, 1);')).toHaveLength(1);
  });
});
