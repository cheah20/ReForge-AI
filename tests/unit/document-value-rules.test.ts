/**
 * tests/unit/document-value-rules.test.ts
 *
 * Tier A value rules (formbridge-any-document tasks 6.1, 6.2, 6.4, 6.5, 6.6):
 * the digit view and the rules V1 to V9, one example per rule, and the
 * synthetic prefilled fixtures.
 * Validates: Requirements 11.2, 11.5, 11.9, 11.10, 11.12, 11.13
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { digitView, matchText, ndDigitValues } from '../../src/lib/document/digit-view.js';
import { classifyByValueRules, classifyLineByValueRules, insideAnswerArea, isValueLikeText, splitAtLabelColon, textRuleHits } from '../../src/lib/document/value-rules.js';
import { buildCandidates, buildPage } from '../../src/lib/document/model.js';
import type { AnswerArea } from '../../src/lib/document/types.js';

const view = (s: string) => digitView(matchText(s));
const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe('digit view (6.1, 6.2)', () => {
  it('maps every decimal digit code point to 0 to 9, in runs of ten starting at a zero', () => {
    const values = ndDigitValues();
    expect(values.size).toBeGreaterThan(600);
    for (const v of values.values()) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of values.values()) expect(v).toBeLessThanOrEqual(9);
    for (const zero of [0x30, 0x660, 0x6f0, 0x966, 0x9e6, 0xbe6, 0xe50, 0x1040, 0xff10, 0x1d7ce]) expect(values.get(zero)).toBe(0);
    expect(values.get(0xbe9)).toBe(3); // Tamil digit three
    // Every run of consecutive digit code points is a whole number of tens, so "position in the run" is the value.
    const cps = [...values.keys()];
    let run = 1;
    for (let i = 1; i <= cps.length; i++) {
      if (i < cps.length && cps[i] === cps[i - 1]! + 1) run++;
      else {
        expect(run % 10).toBe(0);
        run = 1;
      }
    }
  });

  it('turns digits of other scripts, full-width digits and circled digits into ASCII digits', () => {
    expect(view('\u0be7\u0be8\u0be9')).toBe('123'); // Tamil
    expect(view('\u0669\u0668')).toBe('98'); // Arabic-Indic
    expect(view('\uff19\uff10\uff11')).toBe('901'); // full width, through NFKC
    expect(view('\u2460\u2461')).toBe('12'); // circled
  });

  it('counts CJK numerals as digits, and the multiplier numerals as one digit', () => {
    expect(view('\u4e00\u4e8c\u4e09-\u56db\u4e94-\u516d\u4e03\u516b\u516b')).toBe('123-45-6788');
    expect(view('\u58f9\u8cb3\u53c3')).toBe('123'); // formal numerals
    expect(view('\u3007\u96f6')).toBe('00');
    expect(view('\u5341\u767e')).toBe('00');
  });

  it('counts Roman numeral letters as digits only inside a token that already holds two digits', () => {
    expect(view('IV-12')).toBe('11-12');
    expect(view('Mix 1')).toBe('Mix 1');
    expect(view('Page IV')).toBe('Page IV');
  });

  it('maps look-alike letters inside digit tokens and next to digit runs, but leaves ordinary words alone', () => {
    expect(view('0l2 S55 O199')).toBe('012 555 0199');
    expect(view('SOO 12 3456')).toBe('500 12 3456');
    expect(view('9001O1')).toBe('900101');
    for (const word of ['Tel', 'Nama', 'Sex', 'Phone:', 'Full name:']) expect(view(word)).toBe(word);
    expect(view('Tel 1')).toBe('Tel 1');
  });

  it('keeps one character per code point', () => {
    const text = '\u0be7a\u{1d7d0}b';
    expect([...view(text)].length).toBe([...text].length);
  });
});

describe('one example per value rule (6.5, 6.6)', () => {
  const hit = (text: string, rule: string) => expect(textRuleHits(text)).toContain(rule);
  const miss = (text: string, rule: string) => expect(textRuleHits(text)).not.toContain(rule);

  it('V1 a run of 4 or more digits', () => {
    hit('No. 1234', 'V1');
    miss('Room 123', 'V1');
  });

  it('V2 six or more digits anywhere, even spaced apart (decided 2026-11-12)', () => {
    hit('9 0 0 1 0 1', 'V2');
    miss('9 0 0 1 0 1', 'V1');
    miss('1 2 3 4 5', 'V2');
  });

  it('V3 an email address, or any text with an @', () => {
    hit('canary.zqx@example.invalid', 'V3');
    hit('write to me @ home', 'V3');
    miss('Email:', 'V3');
  });

  it('V4 a phone number of 7 or more digits', () => {
    hit('012-555 0142', 'V4');
    hit('(202) 555-0123', 'V4');
    hit('+60 12 345 6789', 'V4');
    miss('Page 12 of 345', 'V4');
  });

  it('V5 a Malaysian IC or a US SSN shape', () => {
    hit('900101-14-5678', 'V5');
    hit('900101145678', 'V5');
    hit('123-45-6788', 'V5');
    miss('12-34-56', 'V5');
  });

  it('V6 a date with two separators, or an ISO date', () => {
    hit('12/03/1988', 'V6');
    hit('12.03.88', 'V6');
    hit('1988-03-12', 'V6');
    miss('Date of birth (DD/MM/YYYY):', 'V6');
  });

  it('V7 text with at least half of its box inside a fill-in or ruled area', () => {
    const area = (b: ReturnType<typeof box>, kind: AnswerArea['kind'] = 'underline'): AnswerArea => ({ kind, box: b });
    expect(insideAnswerArea(box(10, 10, 50, 20), [area(box(0, 0, 100, 30))])).toBe(true);
    expect(insideAnswerArea(box(10, 10, 50, 20), [area(box(30, 0, 100, 30))])).toBe(true); // exactly half: "at least 50%"
    expect(insideAnswerArea(box(10, 10, 50, 20), [area(box(31, 0, 100, 30))])).toBe(false); // just under half
    expect(insideAnswerArea(box(10, 10, 50, 20), [area(box(45, 0, 100, 30))])).toBe(false);
    expect(insideAnswerArea(box(10, 10, 50, 20), [area(box(0, 0, 100, 30), 'after-colon')])).toBe(false);
    expect(insideAnswerArea(box(10, 10, 10, 20), [area(box(0, 0, 100, 30))])).toBe(false);
  });

  it('V8 text after a label-ending colon, but not a leader or a time', () => {
    expect(splitAtLabelColon('Nama: ZQXCOLON')).toEqual({ label: 'Nama:', hasColon: true, hasTextAfterColon: true });
    expect(splitAtLabelColon('Name: ________')).toEqual({ label: 'Name:', hasColon: true, hasTextAfterColon: false });
    expect(splitAtLabelColon('Name\uff1a Ali')).toEqual({ label: 'Name\uff1a', hasColon: true, hasTextAfterColon: true });
    expect(splitAtLabelColon('Time 10:30').hasColon).toBe(false);
    expect(splitAtLabelColon(': Ali').hasColon).toBe(false);
    expect(splitAtLabelColon('Full name')).toEqual({ label: 'Full name', hasColon: false, hasTextAfterColon: false });
  });

  it('V9 empty text or text made only of punctuation and symbols', () => {
    for (const t of ['', '   ', '---', ' : ', '()', '\u2026\u2026']) hit(t, 'V9');
    miss('Name', 'V9');
    miss('3', 'V9');
  });
});

describe('the whole-line rule and edits (Requirements 11.5, 11.9, 12.5)', () => {
  const line = (text: string) => classifyLineByValueRules(text, box(0, 0, 100, 20), []);

  it('a value before the colon, or in a line with no colon, makes the whole line value-like', () => {
    expect(line('Phone 012-555 0142')).toBe('value-like');
    expect(line('Tel 0l2 S55 O199')).toBe('value-like');
    expect(line('IC 900101-14-5678: yes')).toBe('value-like');
  });

  it('a value only after the colon leaves the label part, which is never likely-label', () => {
    expect(line('Email: canary.zqx@example.invalid')).toBe('ambiguous');
    expect(line('IC number: 900101-14-5678')).toBe('ambiguous');
    expect(line('Nama: ZQXCOLON')).toBe('ambiguous');
    expect(line('Full name:')).toBe('ambiguous');
  });

  it('a line inside an answer area is value-like', () => {
    expect(classifyLineByValueRules('ZQXNAME KAPPA', box(130, 380, 420, 410), [{ kind: 'box', box: box(120, 350, 1430, 520) }])).toBe('value-like');
  });

  it('edited text that carries a value or text after a colon is value-like; a plain label is not', () => {
    for (const t of ['Name: Ali', '1234', 'a@b.invalid', '']) expect(isValueLikeText(t)).toBe(true);
    for (const t of ['Name:', 'Name', 'Full name of the guardian:']) expect(isValueLikeText(t)).toBe(false);
  });
});

describe('the synthetic prefilled fixtures', () => {
  interface Mock {
    width: number;
    height: number;
    lines: Array<{ text: string; box: ReturnType<typeof box>; confidence: number }>;
    answerAreas: Array<{ kind: string; box: ReturnType<typeof box> }>;
  }
  const expected = JSON.parse(readFileSync('fixtures/documents/expected.json', 'utf8')) as {
    fixtures: Array<{ file: string; pages?: Array<{ mock?: Mock }>; lines?: Array<{ text: string; expect: string }> }>;
  };
  const mockOf = (name: string) => expected.fixtures.find((f) => f.file === `${name}.png`)!.pages![0]!.mock!;
  const pageOf = (name: string, withAreas: boolean) => {
    const m = mockOf(name);
    const page = buildPage({ pageNumber: 1, width: m.width, height: m.height, rotation: 0, textSource: 'ocr', lines: m.lines });
    const areas = withAreas ? m.answerAreas.filter((a) => a.kind === 'underline' || a.kind === 'box').map((a) => ({ kind: a.kind as AnswerArea['kind'], box: a.box })) : [];
    return { ...page, answerAreas: areas };
  };
  const offered = (name: string, withAreas: boolean) => {
    const page = pageOf(name, withAreas);
    return buildCandidates([page], null, 'eng', classifyByValueRules).map((c) => c.text);
  };

  it('prefilled-sensitive: the canaries are printed, and no number, email or text after a colon is offered', () => {
    const printed = mockOf('prefilled-sensitive').lines.map((l) => l.text).join('\n');
    const candidates = offered('prefilled-sensitive', false).join('\n');
    for (const canary of ['900101-14-5678', '012-555 0142', 'canary.zqx@example.invalid', 'ZQXCOLON']) {
      expect(printed).toContain(canary);
      expect(candidates).not.toContain(canary);
    }
    // Only the labels are offered for the lines that carry a value after the colon.
    expect(offered('prefilled-sensitive', false)).toEqual(expect.arrayContaining(['IC number:', 'Phone:', 'Email:', 'Nama:']));
  });

  it('prefilled-split: every split, look-alike and CJK-numeral value is caught by the text rules alone', () => {
    const printed = mockOf('prefilled-split').lines.map((l) => l.text);
    for (const part of ['880202', '10-5432', '770303-08', '1234', '0l2 S55 O199']) expect(printed.join('\n')).toContain(part);
    const candidates = offered('prefilled-split', false);
    for (const part of ['880202', '10-5432', '770303-08', '1234', 'S55', '\u4e00\u4e8c\u4e09']) {
      expect(candidates.some((c) => c.includes(part))).toBe(false);
    }
    expect(candidates).toContain('Signature:');
  });

  it('a name or free text with no number is not offered: the line directly below a question is a prefilled value, with or without the measured areas', () => {
    const name = 'ZQXNAME KAPPA';
    const free = 'ZQXFREE canary sentence for privacy tests.';
    for (const withAreas of [false, true]) {
      const c = offered('prefilled-sensitive', withAreas);
      expect(c).not.toContain(name);
      expect(c).not.toContain(free);
      expect(c).toContain('Full name:');
      expect(c).toContain('Reason for visit:');
    }
  });

  it('nothing is ever likely-label in Tier A, so nothing is preselected', () => {
    for (const name of ['clean-en', 'prefilled-sensitive', 'default-address']) {
      const page = pageOf(name, false);
      expect([...classifyByValueRules(page).values()].includes('likely-label')).toBe(false);
    }
  });

  it('the address lines: the postcode line is never offered', () => {
    const c = offered('default-address', false);
    expect(c.some((t) => t.includes('43000'))).toBe(false);
  });
});
