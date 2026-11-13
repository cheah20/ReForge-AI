/**
 * scripts/create-fixtures/document-forms.ts
 *
 * The content of every synthetic photo and scan fixture of
 * formbridge-any-document (Requirement 25.1, task 3.1), as plain data. The
 * renderer in documents.ts turns each form into an image; tests import this
 * module to know exactly what each fixture says.
 *
 * Everything is fictional. Names use invented "Zqx..." words or a fixed
 * fictional list; numbers are synthetic (IC numbers built for tests, US
 * 555-01xx numbers, `example.invalid` emails). Non-Latin text is written as
 * \u escapes so this file holds ASCII only.
 */

import { INJECTION_CASES } from '../../tests/fixtures/document/injection-strings.js';

/** What the Default_Selection should do with a printed line (design Q1, conditions C1 to C8). */
export type ExpectedState = 'selected' | 'unselected' | 'not-listed';

export type Item =
  | { t: 'title'; text: string }
  | { t: 'note'; text: string }
  /** A label followed by a fill-in line or a box; `value` is printed in the answer area (a prefilled form). */
  | { t: 'field'; label: string; area: 'underline' | 'box'; value?: string; expect: ExpectedState; valueExpect?: ExpectedState }
  /** A label with its value on the same printed line, after the colon. */
  | { t: 'inline'; label: string; value: string; expect: ExpectedState }
  /** A free line of text. */
  | { t: 'line'; text: string; expect: ExpectedState }
  /** A label on the left and a separate printed text far to its right. */
  | { t: 'pair'; label: string; right: string; expect: ExpectedState; rightExpect: ExpectedState }
  /** A ruled table: each cell holds one or more printed lines. */
  | { t: 'table'; rows: Array<Array<{ lines: string[]; expect: ExpectedState[] }>> }
  | { t: 'gap' };

export interface CanaryNote {
  /** The private value the tests look for. */
  value: string;
  /** Where it is printed, for people reading the test output. */
  where: string;
  /** The state of the printed text that holds it: never selected. */
  state: ExpectedState;
}

export interface FormSpec {
  name: string;
  /** BCP 47 tag of the printed language. */
  lang: string;
  font: 'latin' | 'sc' | 'tc' | 'tamil';
  /** 'a4' is 1556 x 2200 px (long edge 2200); 'half' is 1556 x 1100 px. */
  size: 'a4' | 'half';
  items: Item[];
  canaries: CanaryNote[];
}

const FOOTER_EN = 'Sample form for testing. Not an official document.';
const FOOTER_MS = 'Borang contoh untuk ujian. Bukan dokumen rasmi.';

export const CLEAN_EN: FormSpec = {
  name: 'clean-en',
  lang: 'en',
  font: 'latin',
  size: 'a4',
  canaries: [],
  items: [
    { t: 'title', text: 'Community Clinic Registration (sample form)' },
    { t: 'note', text: 'Please write in capital letters.' },
    { t: 'gap' },
    { t: 'field', label: 'Full name:', area: 'underline', expect: 'selected' },
    { t: 'field', label: 'IC or passport number:', area: 'underline', expect: 'selected' },
    { t: 'field', label: 'Date of birth (DD/MM/YYYY):', area: 'underline', expect: 'selected' },
    { t: 'field', label: 'Phone number:', area: 'underline', expect: 'selected' },
    { t: 'field', label: 'Email:', area: 'underline', expect: 'selected' },
    { t: 'field', label: 'Home address:', area: 'underline', expect: 'selected' },
    { t: 'field', label: 'Postcode:', area: 'underline', expect: 'selected' },
    { t: 'field', label: 'Reason for visit:', area: 'box', expect: 'selected' },
    { t: 'field', label: 'Signature:', area: 'underline', expect: 'selected' },
    { t: 'gap' },
    { t: 'note', text: FOOTER_EN },
  ],
};

export const CLEAN_MS: FormSpec = {
  name: 'clean-ms',
  lang: 'ms',
  font: 'latin',
  size: 'a4',
  canaries: [],
  items: [
    { t: 'title', text: 'Borang Pendaftaran Klinik Komuniti (contoh)' },
    { t: 'note', text: 'Sila tulis dengan huruf besar.' },
    { t: 'gap' },
    { t: 'field', label: 'Nama penuh:', area: 'underline', expect: 'selected' },
    { t: 'field', label: 'No. kad pengenalan:', area: 'underline', expect: 'selected' },
    { t: 'field', label: 'Tarikh lahir (HH/BB/TTTT):', area: 'underline', expect: 'selected' },
    { t: 'field', label: 'No. telefon:', area: 'underline', expect: 'selected' },
    { t: 'field', label: 'E-mel:', area: 'underline', expect: 'selected' },
    { t: 'field', label: 'Alamat rumah:', area: 'underline', expect: 'selected' },
    { t: 'field', label: 'Poskod:', area: 'underline', expect: 'selected' },
    { t: 'field', label: 'Sebab lawatan:', area: 'box', expect: 'selected' },
    { t: 'field', label: 'Tandatangan:', area: 'underline', expect: 'selected' },
    { t: 'gap' },
    { t: 'note', text: FOOTER_MS },
  ],
};

/** Requirement 24.7 and design Q1 "Sensitive fixture". */
export const PREFILLED_SENSITIVE: FormSpec = {
  name: 'prefilled-sensitive',
  lang: 'en',
  font: 'latin',
  size: 'a4',
  canaries: [
    { value: 'ZQXNAME KAPPA', where: 'name inside a ruled box', state: 'not-listed' },
    { value: '900101-14-5678', where: 'IC number after a colon', state: 'not-listed' },
    { value: '012-555 0142', where: 'phone number after a colon', state: 'not-listed' },
    { value: 'canary.zqx@example.invalid', where: 'email after a colon', state: 'not-listed' },
    { value: 'ZQXFREE canary sentence for privacy tests.', where: 'free text on a fill-in line', state: 'not-listed' },
    { value: 'ZQXCOLON', where: 'value after "Nama:"', state: 'not-listed' },
  ],
  items: [
    { t: 'title', text: 'Community Clinic Registration (sample form)' },
    { t: 'gap' },
    { t: 'field', label: 'Full name:', area: 'box', value: 'ZQXNAME KAPPA', expect: 'selected', valueExpect: 'not-listed' },
    { t: 'inline', label: 'IC number:', value: '900101-14-5678', expect: 'unselected' },
    { t: 'inline', label: 'Phone:', value: '012-555 0142', expect: 'unselected' },
    { t: 'inline', label: 'Email:', value: 'canary.zqx@example.invalid', expect: 'unselected' },
    { t: 'field', label: 'Reason for visit:', area: 'underline', value: 'ZQXFREE canary sentence for privacy tests.', expect: 'selected', valueExpect: 'not-listed' },
    { t: 'inline', label: 'Nama:', value: 'ZQXCOLON', expect: 'unselected' },
    { t: 'gap' },
    { t: 'note', text: FOOTER_EN },
  ],
};

/** Requirement 24.12 (a) to (e): one small form each, with its own Canary_Value. */
export const DEFAULT_SELECTION: FormSpec[] = [
  {
    name: 'default-name-alone',
    lang: 'en',
    font: 'latin',
    size: 'half',
    canaries: [{ value: 'Zqxalone', where: 'a name on its own line, no box', state: 'unselected' }],
    items: [
      { t: 'title', text: 'Patient details' },
      { t: 'line', text: 'Aminah Zqxalone binti Ali', expect: 'unselected' },
      { t: 'field', label: 'Phone number:', area: 'underline', expect: 'selected' },
    ],
  },
  {
    name: 'default-name-after-label',
    lang: 'en',
    font: 'latin',
    size: 'half',
    canaries: [
      { value: 'Zqxafter', where: 'a name after "Name:" on the same line', state: 'not-listed' },
      { value: 'Zqxnocolon', where: 'a name after "Name" with no colon', state: 'unselected' },
    ],
    items: [
      { t: 'title', text: 'Patient details' },
      { t: 'inline', label: 'Name:', value: 'Zqxafter Tan', expect: 'unselected' },
      { t: 'line', text: 'Name Zqxnocolon Lim', expect: 'unselected' },
      { t: 'field', label: 'Email:', area: 'underline', expect: 'selected' },
    ],
  },
  {
    name: 'default-address',
    lang: 'en',
    font: 'latin',
    size: 'half',
    canaries: [{ value: 'Zqxaddr', where: 'a two-line address with a street term and a postcode', state: 'unselected' }],
    items: [
      { t: 'title', text: 'Patient details' },
      { t: 'field', label: 'Home address:', area: 'underline', expect: 'selected' },
      { t: 'line', text: '12 Jalan Zqxaddr, Taman Melati', expect: 'unselected' },
      { t: 'line', text: '43000 Kajang, Selangor', expect: 'not-listed' },
    ],
  },
  {
    name: 'default-prefilled-next',
    lang: 'en',
    font: 'latin',
    size: 'half',
    canaries: [{ value: 'Zqxnext', where: 'prefilled text in a separate line beside a label', state: 'unselected' }],
    items: [
      { t: 'title', text: 'Patient details' },
      { t: 'pair', label: 'Occupation:', right: 'Zqxnext teacher', expect: 'selected', rightExpect: 'unselected' },
      { t: 'field', label: 'Postcode:', area: 'underline', expect: 'selected' },
    ],
  },
  {
    name: 'default-mixed-cell',
    lang: 'en',
    font: 'latin',
    size: 'half',
    canaries: [{ value: 'Zqxcell', where: 'a table cell holding a label and a value', state: 'unselected' }],
    items: [
      { t: 'title', text: 'Patient details' },
      {
        t: 'table',
        rows: [
          [
            { lines: ['Name', 'Zqxcell Wong'], expect: ['unselected', 'unselected'] },
            { lines: ['Phone number'], expect: ['unselected'] },
          ],
        ],
      },
    ],
  },
];

/** CJK numerals for 123-45-6788, the US fixture SSN shape (Requirement 11.13). */
export const CJK_SSN = '\u4e00\u4e8c\u4e09-\u56db\u4e94-\u516d\u4e03\u516b\u516b';

/** Split, confusable and non-decimal numbers (design Q1 "Split fixture"). */
export const PREFILLED_SPLIT: FormSpec = {
  name: 'prefilled-split',
  lang: 'en',
  font: 'latin',
  size: 'a4',
  canaries: [
    { value: '880202105432', where: 'IC split across two lines: "880202" and "10-5432"', state: 'not-listed' },
    { value: '770303081234', where: 'IC split across two table cells: "770303-08" and "1234"', state: 'not-listed' },
    { value: '0125550199', where: 'phone split across three words with O, S and l: "0l2 S55 O199"', state: 'not-listed' },
    { value: '123456788', where: 'SSN written with CJK numerals', state: 'not-listed' },
  ],
  items: [
    { t: 'title', text: 'Patient details (sample form)' },
    { t: 'line', text: 'IC number 880202', expect: 'not-listed' },
    { t: 'line', text: '10-5432', expect: 'not-listed' },
    {
      t: 'table',
      rows: [
        [
          { lines: ['770303-08'], expect: ['not-listed'] },
          { lines: ['1234'], expect: ['not-listed'] },
        ],
      ],
    },
    { t: 'line', text: 'Tel 0l2 S55 O199', expect: 'not-listed' },
    { t: 'line', text: `SSN ${CJK_SSN}`, expect: 'not-listed' },
    { t: 'field', label: 'Signature:', area: 'underline', expect: 'selected' },
  ],
};

/** Requirement 24.13: printed attack texts (one line each; a newline prints as two lines). */
function injectionForm(name: string, pick: 'attack' | 'plain'): FormSpec {
  const lines = INJECTION_CASES.flatMap((c) => c[pick].split('\n'));
  return {
    name,
    lang: 'en',
    font: 'latin',
    size: 'a4',
    canaries: [],
    items: [
      { t: 'title', text: 'Clinic form (sample)' },
      ...lines.map((label): Item => ({ t: 'field', label: label.endsWith(':') ? label : `${label}:`, area: 'underline', expect: 'selected' })),
    ],
  };
}

export const INJECTION_LABELS = injectionForm('injection-labels', 'attack');
export const INJECTION_LABELS_PLAIN = injectionForm('injection-labels-plain', 'plain');

function cjkForm(name: string, lang: string, font: FormSpec['font'], s: string[]): FormSpec {
  const [title, note, ...rest] = s;
  const footer = rest.pop()!;
  return {
    name,
    lang,
    font,
    size: 'a4',
    canaries: [],
    items: [
      { t: 'title', text: title! },
      { t: 'note', text: note! },
      { t: 'gap' },
      ...rest.map((label, i): Item => ({ t: 'field', label, area: i === rest.length - 2 ? 'box' : 'underline', expect: 'selected' })),
      { t: 'gap' },
      { t: 'note', text: footer },
    ],
  };
}

/** Slice 2 samples (Requirement 25.6), printed now so the OCR spike can measure them. */
export const CJK_TAMIL: FormSpec[] = [
  cjkForm('sample-zh-hans', 'zh-Hans', 'sc', [
    '\u793e\u533a\u8bca\u6240\u767b\u8bb0\u8868\uff08\u6837\u672c\uff09',
    '\u8bf7\u7528\u6b63\u6977\u586b\u5199\u3002',
    '\u59d3\u540d\uff1a',
    '\u8eab\u4efd\u8bc1\u53f7\u7801\uff1a',
    '\u51fa\u751f\u65e5\u671f\uff1a',
    '\u7535\u8bdd\u53f7\u7801\uff1a',
    '\u7535\u5b50\u90ae\u4ef6\uff1a',
    '\u4f4f\u5740\uff1a',
    '\u90ae\u653f\u7f16\u7801\uff1a',
    '\u5c31\u8bca\u539f\u56e0\uff1a',
    '\u7b7e\u540d\uff1a',
    '\u6d4b\u8bd5\u7528\u6837\u672c\u8868\u683c\uff0c\u5e76\u975e\u6b63\u5f0f\u6587\u4ef6\u3002',
  ]),
  cjkForm('sample-zh-hant', 'zh-Hant', 'tc', [
    '\u793e\u5340\u8a3a\u6240\u767b\u8a18\u8868\uff08\u6a23\u672c\uff09',
    '\u8acb\u7528\u6b63\u6977\u586b\u5beb\u3002',
    '\u59d3\u540d\uff1a',
    '\u8eab\u5206\u8b49\u865f\u78bc\uff1a',
    '\u51fa\u751f\u65e5\u671f\uff1a',
    '\u96fb\u8a71\u865f\u78bc\uff1a',
    '\u96fb\u5b50\u90f5\u4ef6\uff1a',
    '\u4f4f\u5740\uff1a',
    '\u90f5\u905e\u5340\u865f\uff1a',
    '\u5c31\u8a3a\u539f\u56e0\uff1a',
    '\u7c3d\u540d\uff1a',
    '\u6e2c\u8a66\u7528\u6a23\u672c\u8868\u683c\uff0c\u4e26\u975e\u6b63\u5f0f\u6587\u4ef6\u3002',
  ]),
  cjkForm('sample-ta', 'ta', 'tamil', [
    '\u0b9a\u0bae\u0bc2\u0b95 \u0bae\u0bb0\u0bc1\u0ba4\u0bcd\u0ba4\u0bc1\u0bb5\u0bae\u0ba9\u0bc8 \u0baa\u0ba4\u0bbf\u0bb5\u0bc1\u0baa\u0bcd \u0baa\u0b9f\u0bbf\u0bb5\u0bae\u0bcd (\u0bae\u0bbe\u0ba4\u0bbf\u0bb0\u0bbf)',
    '\u0ba4\u0bc6\u0bb3\u0bbf\u0bb5\u0bbe\u0ba9 \u0b8e\u0bb4\u0bc1\u0ba4\u0bcd\u0ba4\u0bc1\u0b95\u0bb3\u0bbf\u0bb2\u0bcd \u0b8e\u0bb4\u0bc1\u0ba4\u0bb5\u0bc1\u0bae\u0bcd.',
    '\u0baa\u0bc6\u0baf\u0bb0\u0bcd:',
    '\u0b85\u0b9f\u0bc8\u0baf\u0bbe\u0bb3 \u0b85\u0b9f\u0bcd\u0b9f\u0bc8 \u0b8e\u0ba3\u0bcd:',
    '\u0baa\u0bbf\u0bb1\u0ba8\u0bcd\u0ba4 \u0ba4\u0bc7\u0ba4\u0bbf:',
    '\u0ba4\u0bca\u0bb2\u0bc8\u0baa\u0bc7\u0b9a\u0bbf \u0b8e\u0ba3\u0bcd:',
    '\u0bae\u0bbf\u0ba9\u0bcd\u0ba9\u0b9e\u0bcd\u0b9a\u0bb2\u0bcd:',
    '\u0bb5\u0bc0\u0b9f\u0bcd\u0b9f\u0bc1 \u0bae\u0bc1\u0b95\u0bb5\u0bb0\u0bbf:',
    '\u0b85\u0b9e\u0bcd\u0b9a\u0bb2\u0bcd \u0b95\u0bc1\u0bb1\u0bbf\u0baf\u0bc0\u0b9f\u0bc1:',
    '\u0bb5\u0bb0\u0bc1\u0b95\u0bc8\u0b95\u0bcd\u0b95\u0bbe\u0ba9 \u0b95\u0bbe\u0bb0\u0ba3\u0bae\u0bcd:',
    '\u0b95\u0bc8\u0baf\u0bca\u0baa\u0bcd\u0baa\u0bae\u0bcd:',
    '\u0b9a\u0bcb\u0ba4\u0ba9\u0bc8\u0b95\u0bcd\u0b95\u0bbe\u0ba9 \u0bae\u0bbe\u0ba4\u0bbf\u0bb0\u0bbf \u0baa\u0b9f\u0bbf\u0bb5\u0bae\u0bcd. \u0b87\u0ba4\u0bc1 \u0b85\u0ba4\u0bbf\u0b95\u0bbe\u0bb0\u0baa\u0bcd\u0baa\u0bc2\u0bb0\u0bcd\u0bb5 \u0b86\u0bb5\u0ba3\u0bae\u0bcd \u0b85\u0bb2\u0bcd\u0bb2.',
  ]),
];

/** Pages of the mixed PDF without fields: text pages carry a text layer, the scanned page is an image. */
export const MIXED_PDF_PAGES: Array<{ source: 'text-layer' | 'ocr'; form: FormSpec }> = [
  { source: 'text-layer', form: CLEAN_EN },
  { source: 'ocr', form: CLEAN_MS },
  { source: 'text-layer', form: { ...CLEAN_EN, name: 'mixed-page-3', items: [{ t: 'title', text: 'Declaration (sample form)' }, { t: 'field', label: 'Signature:', area: 'underline', expect: 'selected' }, { t: 'field', label: 'Date:', area: 'underline', expect: 'selected' }] } },
];

/** Every form rendered as an image fixture. */
export const IMAGE_FORMS: FormSpec[] = [CLEAN_EN, CLEAN_MS, PREFILLED_SENSITIVE, PREFILLED_SPLIT, ...DEFAULT_SELECTION, INJECTION_LABELS, INJECTION_LABELS_PLAIN, ...CJK_TAMIL];

/** Printed lines of a form in reading order, with what the Default_Selection should do with each. */
export function printedLines(form: FormSpec): Array<{ text: string; expect: ExpectedState | 'heading' }> {
  const out: Array<{ text: string; expect: ExpectedState | 'heading' }> = [];
  for (const item of form.items) {
    switch (item.t) {
      case 'title':
      case 'note':
        out.push({ text: item.text, expect: 'heading' });
        break;
      case 'field':
        out.push({ text: item.label, expect: item.expect });
        if (item.value) out.push({ text: item.value, expect: item.valueExpect ?? 'unselected' });
        break;
      case 'inline':
        out.push({ text: `${item.label} ${item.value}`, expect: item.expect });
        break;
      case 'line':
        out.push({ text: item.text, expect: item.expect });
        break;
      case 'pair':
        out.push({ text: item.label, expect: item.expect }, { text: item.right, expect: item.rightExpect });
        break;
      case 'table':
        for (const row of item.rows) for (const cell of row) cell.lines.forEach((text, i) => out.push({ text, expect: cell.expect[i]! }));
        break;
      case 'gap':
        break;
    }
  }
  return out;
}
