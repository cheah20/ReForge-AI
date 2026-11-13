/**
 * scripts/create-fixtures/create-fixtures.ts
 *
 * Generates the synthetic AcroForm fixtures in fixtures/ from the field tables
 * in the fixture specification. Every organisation, person and value is invented.
 *
 *   npx tsx scripts/create-fixtures/create-fixtures.ts
 *
 * Properties:
 * - Real AcroForm fields and widget annotations; dotted names are real
 *   parent/child dictionaries (parent /T = first part, terminal /T = rest).
 * - Noto Sans (SIL OFL 1.1, public/fonts/) is embedded in full and used for the
 *   page text and as the AcroForm default font, so accented answers can be shown.
 * - Reproducible: no metadata dates, and pdf-lib's random font-name suffix is
 *   driven by a fixed seed, so the same script gives byte-identical files
 *   (checked by tests/unit/fixtures.test.ts).
 *
 * fixtures/encrypted.pdf is produced by encrypted.ts (needs qpdf), from the
 * base built by buildEncryptedBase() below.
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

const ROOT = process.cwd();
const FIXTURES_DIR = path.join(ROOT, 'fixtures');
const FONT_PATH = path.join(ROOT, 'public', 'fonts', 'NotoSans-Regular.ttf');
const FONT_KEY = 'NotoSans';

const A4: [number, number] = [595.28, 841.89];
const LETTER: [number, number] = [612, 792];

/** Field flag values (PDF 32000-1, 12.7). */
const FF = { READ_ONLY: 1, REQUIRED: 2, MULTILINE: 4096, NO_TOGGLE_OFF: 16384, RADIO: 32768, COMBO: 131072 };

/** Top-origin rectangle [left, top, right, bottom], as in the fixture spec tables. */
type Box = [number, number, number, number];

interface Common {
  name: string;
  label: string;
  /**
   * Label baseline (top-origin) when the default "6pt above the field" would
   * put the label within the 2pt privacy margin of the widget above it.
   */
  labelBaseline?: number;
  tu?: string;
  required?: boolean;
  readOnly?: boolean;
}

type FieldSpec =
  | (Common & {
      kind: 'text';
      rect: Box;
      maxLen?: number;
      multiline?: boolean;
      /** /V (and /DV unless noDefault) with a visible appearance unless noAppearance */
      value?: string;
      noDefault?: boolean;
      noAppearance?: boolean;
    })
  | (Common & { kind: 'checkbox'; rect: Box; checked?: boolean })
  | (Common & { kind: 'radio'; labelAt: [number, number]; options: { exportValue: string; label: string; rect: Box }[] })
  | (Common & {
      kind: 'dropdown' | 'listbox';
      rect: Box;
      options: [string, string][];
      selected?: number;
    })
  | (Common & { kind: 'signature'; rect: Box; populated?: boolean; appearanceText?: string });

interface FixtureSpec {
  file: string;
  size: [number, number];
  /** Static text lines: [text, x, baseline (top-origin), size] */
  text: [string, number, number, number][];
  fields: FieldSpec[];
  xfa?: string;
  /** Extra static rectangles drawn on the page (no-fields fixture). */
  boxes?: Box[];
}

// ---------------------------------------------------------------------------
// Fixture definitions (from the fixture specification tables)
// ---------------------------------------------------------------------------

const header = (org: string, title: string, notice: string): FixtureSpec['text'] => [
  [org, 36, 40, 12],
  [title, 36, 64, 18],
  [notice, 36, 82, 9],
];

const PROBE_NAME: FieldSpec = { kind: 'text', name: 'probe.name', label: 'Test name', rect: [36, 150, 300, 176], maxLen: 40 };
const PROBE_REFERENCE: FieldSpec = {
  kind: 'text',
  name: 'probe.reference',
  label: 'Test reference',
  tu: 'Test reference',
  rect: [36, 230, 300, 256],
  maxLen: 12,
};

const XDP = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/2.8/">
    <subform name="root">
      <field name="syntheticField"><ui><textEdit/></ui></field>
    </subform>
  </template>
</xdp:xdp>`;

export const FIXTURES: FixtureSpec[] = [
  {
    file: 'clinic-registration.pdf',
    size: A4,
    text: [
      ...header(
        'Klinik Rekaan Awan Ungu',
        'Borang Pendaftaran Pesakit',
        'BORANG UJIAN SINTETIK — organisasi dan semua maklumat adalah rekaan.',
      ),
      ['Maklumat Pesakit', 36, 104, 12],
      ['Maklumat Hubungan', 36, 278, 12],
      ['Maklumat Lawatan', 36, 486, 12],
      ['Pengesahan', 36, 636, 12],
    ],
    fields: [
      { kind: 'text', name: 'patient.fullName', label: 'Nama penuh', tu: 'Nama penuh seperti dalam dokumen pengenalan', required: true, maxLen: 70, rect: [36, 132, 330, 154] },
      { kind: 'text', name: 'Text1', label: 'No. Kad Pengenalan', required: true, maxLen: 12, rect: [350, 132, 559, 154] },
      { kind: 'text', name: 'patient.birthDate', label: 'Tarikh Lahir (DD/MM/YYYY)', tu: 'Tarikh lahir dalam format DD/MM/YYYY', required: true, maxLen: 10, rect: [36, 182, 190, 204] },
      {
        kind: 'radio',
        name: 'patient.gender',
        label: 'Jantina',
        tu: 'Pilih satu pilihan jantina',
        labelAt: [220, 178],
        options: [
          { exportValue: 'F', label: 'Perempuan', rect: [220, 184, 234, 198] },
          { exportValue: 'M', label: 'Lelaki', rect: [320, 184, 334, 198] },
          { exportValue: 'X', label: 'Tidak dinyatakan', rect: [400, 184, 414, 198] },
        ],
      },
      { kind: 'text', name: 'clinic.branchCode', label: 'Kod cawangan', tu: 'Kod cawangan klinik', readOnly: true, maxLen: 8, rect: [36, 232, 190, 254], value: 'AU-TEST' },
      { kind: 'text', name: 'Text7', label: 'Rujukan', maxLen: 8, rect: [350, 232, 559, 254] },
      { kind: 'text', name: 'contact.mobile', label: 'Telefon bimbit', tu: 'Nombor telefon bimbit Malaysia', required: true, maxLen: 13, rect: [36, 304, 285, 326] },
      { kind: 'text', name: 'contact.homePhone', label: 'Telefon rumah', tu: 'Nombor telefon talian tetap Malaysia', maxLen: 12, rect: [310, 304, 559, 326] },
      { kind: 'text', name: 'Text3', label: 'E-mel', maxLen: 80, rect: [36, 354, 559, 376] },
      { kind: 'text', name: 'contact.address', label: 'Alamat surat-menyurat', tu: 'Alamat seperti yang hendak dicetak', required: true, multiline: true, maxLen: 160, rect: [36, 404, 350, 454] },
      { kind: 'text', name: 'contact.postcode', label: 'Poskod', tu: 'Poskod Malaysia, lima digit', required: true, maxLen: 5, rect: [375, 404, 459, 426] },
      // Postcode ends at 426 and city starts at 444: a 10pt label clears both 2pt margins only with a baseline in (438, 439).
      { kind: 'text', name: 'contact.city', label: 'Bandar', required: true, maxLen: 40, rect: [375, 444, 559, 466], labelBaseline: 438.5 },
      {
        kind: 'dropdown',
        name: 'contact.state',
        label: 'Negeri / Wilayah',
        tu: 'Pilih negeri atau wilayah',
        required: true,
        rect: [36, 506, 220, 528],
        options: [['SGR', 'Selangor'], ['KUL', 'Kuala Lumpur'], ['JHR', 'Johor'], ['OTH', 'Lain-lain']],
      },
      { kind: 'text', name: 'visit.date', label: 'Tarikh lawatan', required: true, maxLen: 10, rect: [245, 506, 390, 528] },
      { kind: 'checkbox', name: 'visit.firstVisit', label: 'Lawatan pertama', tu: 'Adakah ini lawatan pertama?', rect: [420, 510, 434, 524] },
      { kind: 'checkbox', name: 'medical.allergyFlag', label: 'Ada alahan', rect: [36, 553, 50, 567] },
      { kind: 'text', name: 'medical.description', label: 'Sebab lawatan / gejala', tu: 'Terangkan sebab lawatan atau gejala', multiline: true, maxLen: 180, rect: [220, 552, 559, 610] },
      { kind: 'text', name: 'emergency.name', label: 'Nama untuk dihubungi semasa kecemasan', tu: 'Nama orang untuk dihubungi semasa kecemasan', maxLen: 70, rect: [36, 654, 285, 676] },
      { kind: 'text', name: 'emergency.phone', label: 'Telefon kecemasan', tu: 'Nombor telefon kecemasan Malaysia', maxLen: 13, rect: [310, 654, 559, 676] },
      { kind: 'checkbox', name: 'consent.contact', label: 'Saya bersetuju untuk dihubungi', tu: 'Persetujuan untuk dihubungi', rect: [36, 704, 50, 718], checked: true },
      { kind: 'text', name: 'visit.shortCode', label: 'Kod ringkas (maksimum 4 aksara)', tu: 'Kod ringkas, maksimum empat aksara', maxLen: 4, rect: [350, 704, 450, 726] },
      { kind: 'signature', name: 'consent.signature', label: 'Tandatangan pesakit', tu: 'Tandatangan selepas dicetak', rect: [36, 762, 300, 800] },
    ],
  },
  {
    file: 'school-enrolment.pdf',
    size: A4,
    text: [
      ...header(
        'Sekolah Rekaan Pelangi Kertas / Paper Rainbow Fictional School',
        'School Enrolment / Pendaftaran Sekolah',
        'SYNTHETIC TEST FORM / BORANG UJIAN SINTETIK',
      ),
      ['Student / Murid', 36, 106, 12],
      ['Preferences and Declaration / Pilihan dan Pengakuan', 36, 410, 12],
    ],
    fields: [
      { kind: 'text', name: 'student.name', label: 'Student name / Nama murid', tu: 'Student name / Nama murid', required: true, maxLen: 70, rect: [36, 140, 559, 164] },
      { kind: 'text', name: 'Text1', label: 'Birth date / Tarikh lahir (DD/MM/YYYY)', required: true, maxLen: 10, rect: [36, 210, 250, 234] },
      { kind: 'text', name: 'guardian.email', label: 'Guardian email / E-mel penjaga', tu: 'Guardian email / E-mel penjaga', maxLen: 80, rect: [285, 210, 559, 234] },
      { kind: 'text', name: 'student.notes', label: 'Learning needs / Keperluan pembelajaran', tu: 'Describe learning needs / Terangkan keperluan pembelajaran', multiline: true, maxLen: 180, rect: [36, 285, 559, 365] },
      {
        kind: 'radio',
        name: 'admission.session',
        label: 'Session / Sesi',
        tu: 'Choose one session / Pilih satu sesi',
        required: true,
        labelAt: [36, 444],
        options: [
          { exportValue: 'AM', label: 'Morning / Pagi', rect: [36, 450, 50, 464] },
          { exportValue: 'PM', label: 'Afternoon / Petang', rect: [285, 450, 299, 464] },
        ],
      },
      { kind: 'dropdown', name: 'admission.year', label: 'Year / Tahun', required: true, rect: [36, 520, 270, 544], options: [['Y1', 'Year 1 / Tahun 1'], ['Y2', 'Year 2 / Tahun 2']] },
      {
        kind: 'listbox',
        name: 'Text7',
        label: 'Club / Kelab',
        tu: 'Choose one club / Pilih satu kelab',
        rect: [310, 520, 559, 592],
        options: [['ART', 'Art / Seni'], ['SCI', 'Science / Sains'], ['MUS', 'Music / Muzik']],
      },
      { kind: 'checkbox', name: 'consent.trip', label: 'Permit school trips / Benarkan lawatan sekolah', rect: [36, 620, 50, 634] },
      { kind: 'text', name: 'office.code', label: 'Office code / Kod pejabat', tu: 'Office use / Kegunaan pejabat', readOnly: true, maxLen: 8, rect: [36, 690, 250, 714], value: 'SCH-TST' },
      { kind: 'signature', name: 'consent.signature', label: 'Guardian signature / Tandatangan penjaga', tu: 'Sign after printing / Tandatangan selepas dicetak', rect: [285, 690, 559, 748] },
    ],
  },
  {
    file: 'us-community-clinic.pdf',
    size: LETTER,
    text: [
      ...header(
        'Paper Lantern Fictional Community Clinic',
        'Community Clinic Intake',
        'SYNTHETIC TEST FORM — fictional organisation and fictional information only.',
      ),
      ['Patient', 36, 104, 12],
      ['Contact', 36, 298, 12],
      ['Visit', 36, 530, 12],
      ['Declaration', 36, 648, 12],
    ],
    fields: [
      { kind: 'text', name: 'patient.fullName', label: 'Full name', tu: 'Name exactly as it should appear on the form', required: true, maxLen: 70, rect: [36, 132, 576, 156] },
      { kind: 'text', name: 'patient.birthDate', label: 'Date of birth (MM/DD/YYYY)', tu: 'Date of birth, MM/DD/YYYY', required: true, maxLen: 10, rect: [36, 202, 270, 226] },
      { kind: 'text', name: 'Text1', label: 'Social Security number (NNN-NN-NNNN)', tu: 'Format check only; not identity verification', maxLen: 11, rect: [306, 202, 576, 226] },
      { kind: 'text', name: 'contact.phone', label: 'US phone number', tu: 'US phone number; country code +1 accepted', required: true, maxLen: 14, rect: [36, 326, 270, 350] },
      { kind: 'text', name: 'Text7', label: 'ZIP code', tu: 'ZIP or ZIP+4', required: true, maxLen: 10, rect: [306, 326, 456, 350] },
      { kind: 'text', name: 'contact.email', label: 'Email address', maxLen: 80, rect: [36, 396, 576, 420] },
      { kind: 'text', name: 'contact.address', label: 'Mailing address', tu: 'Address exactly as it should appear on the form', required: true, multiline: true, maxLen: 160, rect: [36, 450, 330, 500] },
      { kind: 'text', name: 'contact.city', label: 'City', required: true, maxLen: 40, rect: [354, 450, 576, 474] },
      { kind: 'dropdown', name: 'contact.state', label: 'State', tu: 'Select a state', required: true, rect: [354, 510, 576, 534], options: [['CA', 'California'], ['NY', 'New York'], ['TX', 'Texas']] },
      { kind: 'text', name: 'visit.date', label: 'Visit date (MM/DD/YYYY)', tu: 'Visit date, MM/DD/YYYY', required: true, maxLen: 10, rect: [36, 548, 220, 572] },
      {
        kind: 'radio',
        name: 'visit.contactMethod',
        label: 'Preferred contact method',
        tu: 'Select one contact method',
        // Between the state dropdown (ends 534) and the radio row (starts 552): clears both 2pt margins.
        labelAt: [270, 546.5],
        options: [
          { exportValue: 'P', label: 'Phone', rect: [270, 552, 284, 566] },
          { exportValue: 'E', label: 'Email', rect: [375, 552, 389, 566] },
          { exportValue: 'N', label: 'Neither', rect: [475, 552, 489, 566] },
        ],
      },
      { kind: 'text', name: 'visit.reason', label: 'Reason for visit', tu: 'Describe the reason for your visit', multiline: true, maxLen: 180, rect: [36, 670, 330, 732] },
      { kind: 'checkbox', name: 'consent.reminders', label: 'I agree to appointment reminders', rect: [354, 676, 368, 690] },
      { kind: 'signature', name: 'consent.signature', label: 'Patient signature', tu: 'Sign after printing', rect: [354, 718, 576, 756] },
    ],
  },
  {
    file: 'prefilled-field.pdf',
    size: A4,
    text: [...header('Paper Cloud Fictional Office', 'Prefilled Value Privacy Test', 'SYNTHETIC TEST ONLY'), ['Test fields', 36, 112, 12]],
    fields: [
      // Sentinel values live only in /V, /DV and the widget appearance, never in page text.
      { kind: 'text', name: 'person.name', label: 'Full name', tu: 'Full name', maxLen: 70, rect: [36, 150, 559, 178], value: 'VALUE_ONLY_CANARY_7Q2' },
      { kind: 'text', name: 'office.code', label: 'Office code', readOnly: true, maxLen: 40, rect: [36, 250, 559, 278], value: 'RO_ONLY_CANARY_9R4' },
      { kind: 'text', name: 'Text7', label: 'Reference', maxLen: 40, rect: [36, 350, 559, 378], value: 'NO_AP_CANARY_3M8', noDefault: true, noAppearance: true },
      { kind: 'checkbox', name: 'consent.contact', label: 'Permit contact', rect: [36, 450, 52, 466], checked: true },
      { kind: 'dropdown', name: 'office.route', label: 'Routing category', tu: 'Select routing category', rect: [36, 550, 300, 578], options: [['A', 'Category A'], ['B', 'Category B']], selected: 1 },
    ],
  },
  {
    file: 'no-fields.pdf',
    size: A4,
    text: [
      ...header('Paper Cloud Fictional Office', 'Synthetic non-interactive form', 'SYNTHETIC TEST ONLY'),
      ['Name', 36, 146, 10],
      ['Date', 36, 226, 10],
    ],
    fields: [],
    boxes: [
      [36, 150, 300, 176],
      [36, 230, 300, 256],
    ],
  },
  {
    file: 'xfa-acroform.pdf',
    size: A4,
    text: header('Paper Cloud Fictional Office', 'Synthetic XFA Detection Form', 'SYNTHETIC TEST ONLY'),
    fields: [PROBE_NAME, PROBE_REFERENCE],
    xfa: XDP,
  },
  {
    file: 'sig-empty.pdf',
    size: A4,
    text: header('Paper Cloud Fictional Office', 'Unsigned Synthetic Form', 'SYNTHETIC TEST ONLY'),
    fields: [
      { ...(PROBE_NAME as FieldSpec & { kind: 'text' }), required: true },
      { kind: 'signature', name: 'probe.signature', label: 'Signature', tu: 'Sign after printing', rect: [36, 260, 350, 310] },
    ],
  },
  {
    file: 'sig-populated.pdf',
    size: A4,
    text: header('Paper Cloud Fictional Office', 'Populated Signature Detection Form', 'SYNTHETIC TEST ONLY'),
    fields: [
      PROBE_NAME,
      {
        kind: 'signature',
        name: 'probe.signature',
        label: 'Signature',
        tu: 'Synthetic signature detector test',
        rect: [36, 260, 350, 310],
        populated: true,
        appearanceText: 'SYNTHETIC TEST SIGNATURE',
      },
    ],
  },
];

/**
 * The bundled "Try a sample form" PDF (formbridge-pdf task 28.5): the clinic
 * registration form with every value removed, so the sample opens with every
 * field empty. Same page text, fields, flags and rectangles as the clinic
 * fixture; only /V, /DV, checked states and value appearances are left out.
 */
export const SAMPLE_FORM_FILE = 'clinic-registration-sample.pdf';

export function blankCopy(spec: FixtureSpec, file: string): FixtureSpec {
  return {
    ...spec,
    file,
    fields: spec.fields.map((f) => {
      const copy = { ...f } as Record<string, unknown>;
      delete copy['value'];
      delete copy['checked'];
      delete copy['selected'];
      return copy as unknown as typeof f;
    }),
  };
}

FIXTURES.push(blankCopy(FIXTURES.find((f) => f.file === 'clinic-registration.pdf')!, SAMPLE_FORM_FILE));

/** Base for encrypted.pdf (encrypted afterwards with qpdf). */
export const ENCRYPTED_BASE: FixtureSpec = {
  file: 'encrypted-base.pdf',
  size: A4,
  text: header('Paper Cloud Fictional Office', 'Encrypted Synthetic Form', 'SYNTHETIC TEST ONLY'),
  fields: [PROBE_NAME, PROBE_REFERENCE],
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

class Builder {
  readonly fieldsArray: PDFArray;
  private readonly parents = new Map<string, { ref: PDFRef; dict: PDFDict }>();

  constructor(
    readonly doc: PDFDocument,
    readonly page: PDFPage,
    readonly font: PDFFont,
    readonly height: number,
  ) {
    this.fieldsArray = doc.context.obj([]);
  }

  get ctx() {
    return this.doc.context;
  }

  /** Native PDF rect [l, b, r, t] from a top-origin box. */
  native([l, t, r, b]: Box): [number, number, number, number] {
    return [l, this.height - b, r, this.height - t];
  }

  text(str: string, x: number, baseline: number, size: number): void {
    this.page.drawText(str, { x, y: this.height - baseline, size, font: this.font, color: rgb(0, 0, 0) });
  }

  border(box: Box): void {
    const [l, b, r, t] = this.native(box);
    this.page.drawRectangle({ x: l, y: b, width: r - l, height: t - b, borderColor: rgb(0.25, 0.25, 0.25), borderWidth: 0.75 });
  }

  /** A form XObject appearance stream of the given size. */
  appearance(width: number, height: number, content: string, withFont = false): PDFRef {
    const dict: Record<string, unknown> = {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, width, height],
    };
    if (withFont) {
      dict['Resources'] = this.ctx.obj({ Font: this.ctx.obj({ [FONT_KEY]: this.font.ref }) });
    }
    return this.ctx.register(this.ctx.stream(content, dict as never));
  }

  /** Text appearance showing `value` on one line. */
  textAppearance(w: number, h: number, value: string): PDFRef {
    const hex = (this.font.encodeText(value) as PDFHexString).toString();
    const y = (h - 10) / 2 + 2.5;
    return this.appearance(w, h, `/Tx BMC q BT /${FONT_KEY} 10 Tf 0 g 3 ${y.toFixed(2)} Td ${hex} Tj ET Q EMC`, true);
  }

  /** Parent node for a dotted name (created once), and the terminal's partial name. */
  parentFor(name: string): { parent?: { ref: PDFRef; dict: PDFDict }; partial: string } {
    const dot = name.indexOf('.');
    if (dot < 0) return { partial: name };
    const head = name.slice(0, dot);
    let parent = this.parents.get(head);
    if (!parent) {
      const dict = this.ctx.obj({ T: PDFString.of(head), Kids: this.ctx.obj([]) });
      const ref = this.ctx.register(dict);
      this.fieldsArray.push(ref);
      parent = { ref, dict };
      this.parents.set(head, parent);
    }
    return { parent, partial: name.slice(dot + 1) };
  }

  /** Register a terminal field node, attach it to its parent or /Fields, and list widgets in /Annots. */
  addField(name: string, entries: Record<string, unknown>, widgets: PDFRef[] | 'self'): PDFRef {
    const { parent, partial } = this.parentFor(name);
    const dict = this.ctx.obj({
      T: PDFString.of(partial),
      ...(parent ? { Parent: parent.ref } : {}),
      ...entries,
    } as never) as unknown as PDFDict;
    const ref = this.ctx.register(dict);
    if (parent) parent.dict.lookup(PDFName.of('Kids'), PDFArray).push(ref);
    else this.fieldsArray.push(ref);
    this.annots.push(...(widgets === 'self' ? [ref] : widgets));
    return ref;
  }

  readonly annots: PDFRef[] = [];

  widgetEntries(box: Box, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Widget'),
      Rect: this.ctx.obj(this.native(box)),
      F: 4, // Print
      P: this.page.ref,
      ...extra,
    };
  }

  flags(spec: Common, extra = 0): number {
    return (spec.readOnly ? FF.READ_ONLY : 0) | (spec.required ? FF.REQUIRED : 0) | extra;
  }

  common(spec: Common): Record<string, unknown> {
    return spec.tu ? { TU: PDFString.of(spec.tu) } : {};
  }

  /**
   * Label baseline 6pt above the field. Closer labels would have their descent
   * within the 2pt privacy margin of the widget and be dropped from snippets.
   */
  labelAbove(label: string, box: Box, baseline?: number): void {
    this.text(label, box[0], baseline ?? box[1] - 6, 10);
  }

  labelRight(label: string, box: Box): void {
    this.text(label, box[2] + 4, (box[1] + box[3]) / 2 + 3.5, 10);
  }

  add(spec: FieldSpec): void {
    const ctx = this.ctx;
    switch (spec.kind) {
      case 'text': {
        this.labelAbove(spec.label, spec.rect, spec.labelBaseline);
        this.border(spec.rect);
        const [l, t, r, b] = spec.rect;
        const entries: Record<string, unknown> = {
          FT: PDFName.of('Tx'),
          Ff: this.flags(spec, spec.multiline ? FF.MULTILINE : 0),
          DA: PDFString.of(`/${FONT_KEY} 10 Tf 0 g`),
          ...this.common(spec),
          ...(spec.maxLen ? { MaxLen: spec.maxLen } : {}),
          ...this.widgetEntries(spec.rect),
        };
        if (spec.value !== undefined) {
          entries['V'] = PDFString.of(spec.value);
          if (!spec.noDefault) entries['DV'] = PDFString.of(spec.value);
          if (!spec.noAppearance) entries['AP'] = ctx.obj({ N: this.textAppearance(r - l, b - t, spec.value) });
        }
        this.addField(spec.name, entries, 'self');
        return;
      }
      case 'checkbox': {
        this.labelRight(spec.label, spec.rect);
        const [l, t, r, b] = spec.rect;
        const w = r - l;
        const h = b - t;
        const box = `0 G 0.75 w 0.5 0.5 ${w - 1} ${h - 1} re S`;
        const tick = `${box} 0 g 1.5 w ${w * 0.2} ${h * 0.5} m ${w * 0.42} ${h * 0.25} l ${w * 0.8} ${h * 0.8} l S`;
        const state = spec.checked ? 'Yes' : 'Off';
        this.addField(
          spec.name,
          {
            FT: PDFName.of('Btn'),
            Ff: this.flags(spec),
            ...this.common(spec),
            V: PDFName.of(state),
            AS: PDFName.of(state),
            AP: ctx.obj({ N: ctx.obj({ Yes: this.appearance(w, h, tick), Off: this.appearance(w, h, box) }) }),
            ...this.widgetEntries(spec.rect),
          },
          'self',
        );
        return;
      }
      case 'radio': {
        this.text(spec.label, spec.labelAt[0], spec.labelAt[1], 10);
        const widgetRefs: PDFRef[] = [];
        const fieldRef = this.addField(
          spec.name,
          {
            FT: PDFName.of('Btn'),
            Ff: this.flags(spec, FF.RADIO | FF.NO_TOGGLE_OFF),
            ...this.common(spec),
            V: PDFName.of('Off'),
            Kids: ctx.obj([]),
          },
          widgetRefs,
        );
        const fieldDict = ctx.lookup(fieldRef, PDFDict);
        const kids = fieldDict.lookup(PDFName.of('Kids'), PDFArray);
        for (const opt of spec.options) {
          this.labelRight(opt.label, opt.rect);
          const [l, t, r, b] = opt.rect;
          const w = r - l;
          const h = b - t;
          const ring = `0 G 0.75 w 0.5 0.5 ${w - 1} ${h - 1} re S`;
          const on = `${ring} 0 g ${w * 0.25} ${h * 0.25} ${w * 0.5} ${h * 0.5} re f`;
          const n = ctx.obj({});
          n.set(PDFName.of(opt.exportValue), this.appearance(w, h, on));
          n.set(PDFName.of('Off'), this.appearance(w, h, ring));
          const ref = ctx.register(
            ctx.obj({ ...this.widgetEntries(opt.rect), Parent: fieldRef, AS: PDFName.of('Off'), AP: ctx.obj({ N: n }) } as never),
          );
          kids.push(ref);
          widgetRefs.push(ref);
        }
        this.annots.push(...widgetRefs);
        return;
      }
      case 'dropdown':
      case 'listbox': {
        this.labelAbove(spec.label, spec.rect);
        this.border(spec.rect);
        const entries: Record<string, unknown> = {
          FT: PDFName.of('Ch'),
          Ff: this.flags(spec, spec.kind === 'dropdown' ? FF.COMBO : 0),
          DA: PDFString.of(`/${FONT_KEY} 10 Tf 0 g`),
          ...this.common(spec),
          Opt: ctx.obj(spec.options.map(([e, d]) => ctx.obj([PDFString.of(e), PDFString.of(d)]))),
          ...this.widgetEntries(spec.rect),
        };
        if (spec.selected !== undefined) {
          entries['V'] = PDFString.of(spec.options[spec.selected]![0]);
          entries['I'] = ctx.obj([spec.selected]);
        }
        this.addField(spec.name, entries, 'self');
        return;
      }
      case 'signature': {
        this.labelAbove(spec.label, spec.rect);
        this.border(spec.rect);
        const [l, t, r, b] = spec.rect;
        const entries: Record<string, unknown> = {
          FT: PDFName.of('Sig'),
          Ff: this.flags(spec),
          ...this.common(spec),
          ...this.widgetEntries(spec.rect),
        };
        if (spec.populated) {
          // Structurally populated signature dictionary. It is not a cryptographic
          // signature; the detector rejects on a /V dictionary, not on validity.
          entries['V'] = ctx.register(
            ctx.obj({
              Type: PDFName.of('Sig'),
              Filter: PDFName.of('Adobe.PPKLite'),
              SubFilter: PDFName.of('adbe.pkcs7.detached'),
              Contents: PDFHexString.of('30'.padEnd(512, '0')),
              ByteRange: ctx.obj([0, 1000, 1514, 1000]),
            }),
          );
        }
        if (spec.appearanceText) {
          entries['AP'] = ctx.obj({ N: this.textAppearance(r - l, b - t, spec.appearanceText) });
        }
        this.addField(spec.name, entries, 'self');
        return;
      }
    }
  }
}

/** Run `fn` with Math.random replaced by a fixed-seed generator (mulberry32). */
export async function withSeededRandom<T>(seed: number, fn: () => Promise<T>): Promise<T> {
  const original = Math.random;
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return await fn();
  } finally {
    Math.random = original;
  }
}

export async function buildFixture(spec: FixtureSpec, fontBytes: Uint8Array): Promise<Uint8Array> {
  return withSeededRandom(20261117, async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(fontBytes, { subset: false });
    const page = doc.addPage(spec.size);
    const b = new Builder(doc, page, font, spec.size[1]);

    for (const [str, x, y, size] of spec.text) b.text(str, x, y, size);
    for (const box of spec.boxes ?? []) b.border(box);
    for (const f of spec.fields) b.add(f);

    if (spec.fields.length > 0 || spec.xfa) {
      const ctx = doc.context;
      const acroForm: Record<string, unknown> = {
        Fields: b.fieldsArray,
        DA: PDFString.of(`/${FONT_KEY} 10 Tf 0 g`),
        DR: ctx.obj({ Font: ctx.obj({ [FONT_KEY]: font.ref }) }),
      };
      if (spec.xfa) acroForm['XFA'] = ctx.register(ctx.stream(spec.xfa));
      doc.catalog.set(PDFName.of('AcroForm'), ctx.register(ctx.obj(acroForm as never)));
      if (b.annots.length > 0) page.node.set(PDFName.of('Annots'), ctx.obj(b.annots));
    }

    return doc.save({ updateFieldAppearances: false });
  });
}

export function loadFixtureFont(): Uint8Array {
  return new Uint8Array(fs.readFileSync(FONT_PATH));
}

/** Build every fixture in memory: file name -> bytes. */
export async function buildFixtures(): Promise<Map<string, Uint8Array>> {
  const font = loadFixtureFont();
  const out = new Map<string, Uint8Array>();
  for (const spec of FIXTURES) out.set(spec.file, await buildFixture(spec, font));
  return out;
}

export async function buildEncryptedBase(): Promise<Uint8Array> {
  return buildFixture(ENCRYPTED_BASE, loadFixtureFont());
}

async function main() {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  for (const [file, bytes] of await buildFixtures()) {
    fs.writeFileSync(path.join(FIXTURES_DIR, file), bytes);
    console.log(`Created fixtures/${file} (${bytes.byteLength} bytes)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Error creating fixtures:', err);
    process.exit(1);
  });
}
