/**
 * src/lib/pdf-fill/index.ts
 *
 * fillPdf(pdfBytes, answers, fontMap): write the user's confirmed answers into
 * the PDF in the browser and return the new bytes.
 *
 * - Only fields with an answer are touched (requirement 10.3). A checkbox
 *   answered `skipped` and a blank text answer count as untouched: their value
 *   and appearance stay exactly as they were.
 * - Text: every character must exist in the chosen font (8.7), the value must
 *   fit MaxLen (never truncated) and the text must fit the field at 8pt or
 *   more (10.2). Any failure throws before bytes are produced.
 * - Dropdowns, list boxes and radio groups: only an export value from the PDF's
 *   own options is accepted, and the export value is what is stored (7.8).
 * - Appearances are regenerated for the changed fields only, with the font
 *   passed explicitly, and the document is saved with updateFieldAppearances:
 *   false so untouched fields are not regenerated (decision 14).
 * - Signature and read-only fields are never written.
 */

import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFString,
  PDFTextField,
  type PDFFont,
  type PDFWidgetAnnotation,
} from 'pdf-lib';
import { borderWidthOf, dropdownAppearance, textAppearance } from './appearance.js';
import { chooseFont, embedFont, type FontMap } from './font.js';
import { fitText, type Box, type Metrics } from './overflow.js';

export type FieldAnswer =
  | { kind: 'text'; value: string }
  | { kind: 'choice'; exportValue: string }
  | { kind: 'checkbox'; state: 'checked' | 'unchecked' | 'skipped' };

export type FillErrorCode =
  | 'FIELD_NOT_FOUND'
  | 'FIELD_NOT_WRITABLE'
  | 'WRONG_ANSWER_KIND'
  | 'INVALID_CHOICE'
  | 'MAX_LENGTH'
  | 'CHARACTER_NOT_REPRESENTABLE';

export class FillError extends Error {
  constructor(
    readonly code: FillErrorCode,
    readonly fieldId: string,
    message: string,
  ) {
    super(message);
    this.name = 'FillError';
  }
}

/** A character of the answer has no glyph in any font of the map. */
export class CharacterNotRepresentableError extends FillError {
  constructor(
    fieldId: string,
    readonly codePoint: number,
  ) {
    super('CHARACTER_NOT_REPRESENTABLE', fieldId, `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')} cannot be written to field "${fieldId}"`);
    this.name = 'CharacterNotRepresentableError';
  }
}

export { TextOverflowError } from './overflow.js';

/** PDF text string: plain for ASCII (what other tools expect), UTF-16BE otherwise. */
function pdfText(value: string): PDFString | PDFHexString {
  return /^[\x20-\x7e]*$/.test(value) ? PDFString.of(value) : PDFHexString.fromText(value);
}

/** Font size from a /DA string such as "/NotoSans 10 Tf 0 g"; 10 when absent or auto (0). */
export function defaultFontSize(da: string | undefined): number {
  const m = da?.match(/(-?\d+(?:\.\d+)?)\s+Tf/);
  const size = m ? Number(m[1]) : 0;
  return size > 0 ? size : 10;
}

const length = (s: string) => [...s].length;

/** The widget's box inside its border; overflow.ts then keeps PADDING inside that. */
function innerBox(widget: PDFWidgetAnnotation): Box {
  const r = widget.getRectangle();
  const b = borderWidthOf(widget);
  return { width: r.width - 2 * b, height: r.height - 2 * b };
}

function metricsOf(font: PDFFont): Metrics {
  return { widthOfTextAtSize: (t, s) => font.widthOfTextAtSize(t, s), heightAtSize: (s) => font.heightAtSize(s) };
}

export async function fillPdf(
  pdfBytes: ArrayBuffer | Uint8Array,
  answers: ReadonlyMap<string, FieldAnswer>,
  fontMap: FontMap,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const form = pdfDoc.getForm();

  /** The font to draw `text` with in field `fieldId`; embeds it on first use. */
  const fontFor = async (fieldId: string, text: string): Promise<PDFFont> => {
    const choice = chooseFont(fontMap, text);
    if ('missing' in choice) throw new CharacterNotRepresentableError(fieldId, choice.missing);
    return embedFont(pdfDoc, choice.source);
  };

  for (const [fieldId, answer] of answers) {
    const field = form.getFieldMaybe(fieldId);
    if (!field) throw new FillError('FIELD_NOT_FOUND', fieldId, `No field named "${fieldId}"`);
    if (field.isReadOnly()) throw new FillError('FIELD_NOT_WRITABLE', fieldId, `Field "${fieldId}" is read-only`);

    if (answer.kind === 'checkbox') {
      if (!(field instanceof PDFCheckBox)) throw wrongKind(fieldId, 'a checkbox');
      if (answer.state === 'skipped') continue;
      if (answer.state === 'checked') field.check();
      else field.uncheck();
      field.updateAppearances();
      continue;
    }

    if (answer.kind === 'text') {
      if (!(field instanceof PDFTextField)) throw wrongKind(fieldId, 'a text field');
      const value = answer.value;
      if (value === '') continue; // blank means untouched
      const max = field.getMaxLength();
      if (max !== undefined && length(value) > max) {
        throw new FillError('MAX_LENGTH', fieldId, `Answer for "${fieldId}" is longer than ${max} characters`);
      }
      const font = await fontFor(fieldId, value);
      const widgets = field.acroField.getWidgets();
      const boxes: Box[] = widgets.map(innerBox);
      const start = defaultFontSize(field.acroField.getDefaultAppearance());
      const { size } = fitText(metricsOf(font), fieldId, value, boxes, start, field.isMultiline());
      field.setText(value);
      // Drawn with the same padding and size the fit check used (appearance.ts).
      field.updateAppearances(font, textAppearance(size));
      continue;
    }

    // Choice answers: dropdown, list box or radio group.
    if (field instanceof PDFRadioGroup) {
      if (!field.getOptions().includes(answer.exportValue)) throw invalidChoice(fieldId, answer.exportValue);
      field.select(answer.exportValue);
      field.updateAppearances();
      continue;
    }
    if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      const acro = field.acroField;
      const options = acro.getOptions();
      const index = options.findIndex((o) => o.value.decodeText() === answer.exportValue);
      if (index < 0) throw invalidChoice(fieldId, answer.exportValue);
      const option = options[index]!;
      const display = (option.display ?? option.value).decodeText();
      const font = await fontFor(fieldId, display);
      // The appearance shows the display label; /V stores the export value (7.8).
      if (field instanceof PDFDropdown) {
        const start = defaultFontSize(acro.getDefaultAppearance());
        const { size } = fitText(metricsOf(font), fieldId, display, acro.getWidgets().map(innerBox), start, false);
        field.updateAppearances(font, dropdownAppearance(display, size));
      } else {
        // List boxes keep pdf-lib's list appearance, which draws every option; it reads /V for the highlight.
        acro.dict.set(PDFName.of('V'), pdfText(display));
        field.updateAppearances(font);
      }
      acro.dict.set(PDFName.of('V'), pdfText(answer.exportValue));
      acro.dict.set(PDFName.of('I'), pdfDoc.context.obj([index]));
      continue;
    }
    throw wrongKind(fieldId, 'a choice field');
  }

  return pdfDoc.save({ updateFieldAppearances: false });
}

function wrongKind(fieldId: string, expected: string): FillError {
  return new FillError('WRONG_ANSWER_KIND', fieldId, `Field "${fieldId}" is not ${expected}`);
}

function invalidChoice(fieldId: string, value: string): FillError {
  return new FillError('INVALID_CHOICE', fieldId, `"${value}" is not one of the options of "${fieldId}"`);
}
