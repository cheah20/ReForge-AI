/**
 * src/lib/document/digit-view.ts
 *
 * The digit view used by the value rules (formbridge-any-document Requirements
 * 11.2, 11.12, 11.13, design Q1 "Normalisation before matching"). It turns
 * anything that could be a digit into an ASCII digit so that a number written
 * in another script, in look-alike letters or with CJK numerals is still
 * caught. It is used only to decide that text is value-like; it never changes
 * the text that is shown or sent.
 *
 * Positions: the view has one character per code point of the match text, so
 * an index in the view is a code point index of the match text.
 */

/** NFKC: full-width and circled digits and colons become ASCII, Roman numeral characters become Latin letters. */
export function matchText(text: string): string {
  return text.normalize('NFKC');
}

const ND = /^\p{Nd}$/u;
/** Nd code points up to the end of the Supplementary Multilingual Plane (every Nd digit lives there). */
const ND_SCAN_END = 0x1ffff;

let ndValues: Map<number, number> | null = null;

/**
 * Value 0 to 9 of every decimal digit code point. The Unicode Nd digits come in
 * runs of ten, zero first, so the value is the position in the run. The unit
 * test checks that every run has a length that is a multiple of ten and that
 * well-known zeros (ASCII, Arabic-Indic, Devanagari, Tamil, Thai, Myanmar) map to 0.
 */
export function ndDigitValues(): ReadonlyMap<number, number> {
  if (ndValues) return ndValues;
  const map = new Map<number, number>();
  let runStart = -1;
  for (let cp = 0; cp <= ND_SCAN_END; cp++) {
    if (ND.test(String.fromCodePoint(cp))) {
      if (runStart < 0) runStart = cp;
      map.set(cp, (cp - runStart) % 10);
    } else {
      runStart = -1;
    }
  }
  ndValues = map;
  return map;
}

/** CJK numerals by code point (Requirement 11.13). Multipliers count as one digit with the placeholder value 0. */
const CJK_NUMERALS = new Map<number, string>([
  [0x3007, '0'], [0x96f6, '0'], [0x4e00, '1'], [0x4e8c, '2'], [0x5169, '2'], [0x4e09, '3'], [0x56db, '4'],
  [0x4e94, '5'], [0x516d, '6'], [0x4e03, '7'], [0x516b, '8'], [0x4e5d, '9'],
  [0x58f9, '1'], [0x8d30, '2'], [0x8cb3, '2'], [0x53c1, '3'], [0x53c3, '3'], [0x8086, '4'], [0x4f0d, '5'],
  [0x9678, '6'], [0x9646, '6'], [0x67d2, '7'], [0x634c, '8'], [0x7396, '9'],
  [0x5341, '0'], [0x62fe, '0'], [0x767e, '0'], [0x4f70, '0'], [0x5343, '0'], [0x4edf, '0'], [0x4e07, '0'], [0x842c, '0'],
]);

/** Confusable_Characters (Requirement 11.12). */
const CONFUSABLE: Readonly<Record<string, string>> = {
  O: '0', o: '0', D: '0', Q: '0',
  S: '5', s: '5',
  I: '1', l: '1', '|': '1', '!': '1',
  B: '8',
  Z: '2', z: '2',
  G: '6',
  T: '7',
  g: '9', q: '9',
};

/** Roman numeral letters count as digits inside an ID-like token: I, l and D take their confusable value, the rest the placeholder 1. */
const ROMAN = new Set('IVXLCDMivxlcdm');
const romanValue = (c: string) => (c === 'D' || c === 'd' ? '0' : '1');

/** Characters that may sit between two digits of one Numeric_Fragment (also reused by the fragment finder). */
export const FRAGMENT_SEPARATORS = new Set([
  ' ', '\u00a0', '-', '\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015', '.', ',', '/', '\\', '_', '\u00b7', '(', ')', '+',
]);

const isAsciiDigit = (c: string) => c >= '0' && c <= '9';
const isConfusable = (c: string) => Object.prototype.hasOwnProperty.call(CONFUSABLE, c);

function tokenRanges(cps: readonly string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = -1;
  cps.forEach((c, i) => {
    const space = /\s/u.test(c);
    if (!space && start < 0) start = i;
    if (space && start >= 0) {
      ranges.push([start, i]);
      start = -1;
    }
  });
  if (start >= 0) ranges.push([start, cps.length]);
  return ranges;
}

const digitCount = (cps: readonly string[], from: number, to: number) => cps.slice(from, to).filter(isAsciiDigit).length;

function hasDigitRun(cps: readonly string[], from: number, to: number, min: number): boolean {
  let run = 0;
  for (let i = from; i < to; i++) {
    run = isAsciiDigit(cps[i]!) ? run + 1 : 0;
    if (run >= min) return true;
  }
  return false;
}

/**
 * The digit view of NFKC-normalised text (`matchText`). Three mappings, in order:
 * decimal digits of every script, CJK and Roman numerals, then look-alike
 * letters inside or next to digit tokens. Ordinary words keep their letters.
 */
export function digitView(match: string): string {
  const values = ndDigitValues();
  const cps = [...match].map((c) => {
    const cp = c.codePointAt(0)!;
    const nd = values.get(cp);
    if (nd !== undefined) return String(nd);
    return CJK_NUMERALS.get(cp) ?? c;
  });

  const tokens = tokenRanges(cps);

  // Roman numerals inside a token that already holds at least 2 digits.
  for (const [from, to] of tokens) {
    if (digitCount(cps, from, to) < 2) continue;
    for (let i = from; i < to; i++) if (ROMAN.has(cps[i]!)) cps[i] = romanValue(cps[i]!);
  }

  // Confusable_Characters inside any token that holds a digit.
  for (const [from, to] of tokens) {
    if (digitCount(cps, from, to) < 1) continue;
    for (let i = from; i < to; i++) if (isConfusable(cps[i]!)) cps[i] = CONFUSABLE[cps[i]!]!;
  }

  // A token of 2 or more characters made only of confusables and separators, next to a token with a digit run of 2 or more.
  let changed = true;
  while (changed) {
    changed = false;
    tokens.forEach(([from, to], t) => {
      if (to - from < 2) return;
      const chars = cps.slice(from, to);
      if (!chars.every((c) => isConfusable(c) || FRAGMENT_SEPARATORS.has(c) || isAsciiDigit(c))) return;
      if (!chars.some(isConfusable)) return;
      const neighbours = [tokens[t - 1], tokens[t + 1]].filter((n): n is [number, number] => n !== undefined);
      if (!neighbours.some(([nf, nt]) => hasDigitRun(cps, nf, nt, 2))) return;
      for (let i = from; i < to; i++) {
        if (isConfusable(cps[i]!)) {
          cps[i] = CONFUSABLE[cps[i]!]!;
          changed = true;
        }
      }
    });
  }
  return cps.join('');
}

/** Number of digits in the digit view of a text. */
export function countDigits(text: string): number {
  return [...digitView(matchText(text))].filter(isAsciiDigit).length;
}
