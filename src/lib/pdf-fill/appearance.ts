/**
 * src/lib/pdf-fill/appearance.ts
 *
 * Appearance providers for filled text and dropdown fields. pdf-lib's default
 * providers keep only 1pt between the border and the text, while the fit check
 * (overflow.ts) reserves PADDING (3pt) on every side. These providers draw with
 * the same PADDING and the font size the fit check chose, so what is measured
 * is what is drawn. Layout, clipping and rotation use pdf-lib's own helpers.
 */

import {
  adjustDimsForRotation,
  componentsToColor,
  drawTextField,
  layoutMultilineText,
  layoutSinglelineText,
  reduceRotation,
  rgb,
  rotateInPlace,
  setFillingColor,
  setFontAndSize,
  TextAlignment,
  type AppearanceProviderFor,
  type Color,
  type PDFDropdown,
  type PDFFont,
  type PDFTextField,
  type PDFWidgetAnnotation,
  grayscale,
} from 'pdf-lib';
import { PADDING } from './overflow.js';

/** Border width of a widget, 0 when it has none. */
export function borderWidthOf(widget: PDFWidgetAnnotation): number {
  return widget.getBorderStyle()?.getWidth() ?? 0;
}

/** Text colour from a /DA string ("0 g", "0 0 1 rg"); black otherwise. */
function colorFromDa(da: string | undefined): Color {
  const g = da?.match(/(\d*\.?\d+)\s+g\b/);
  if (g) return grayscale(Number(g[1]));
  const c = da?.match(/(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+rg\b/);
  if (c) return rgb(Number(c[1]), Number(c[2]), Number(c[3]));
  return rgb(0, 0, 0);
}

interface DrawOptions {
  widget: PDFWidgetAnnotation;
  text: string;
  font: PDFFont;
  fontSize: number;
  multiline: boolean;
  alignment: TextAlignment;
  da: string | undefined;
  setDa: (da: string) => void;
}

function draw({ widget, text, font, fontSize, multiline, alignment, da, setDa }: DrawOptions) {
  const ap = widget.getAppearanceCharacteristics();
  const borderWidth = borderWidthOf(widget);
  const rotation = reduceRotation(ap?.getRotation());
  const rectangle = widget.getRectangle();
  const { width, height } = adjustDimsForRotation(rectangle, rotation);
  const inset = borderWidth + PADDING;
  const bounds = { x: inset, y: inset, width: width - inset * 2, height: height - inset * 2 };

  const textLines = multiline
    ? layoutMultilineText(text, { alignment, fontSize, font, bounds }).lines
    : [layoutSinglelineText(text, { alignment, fontSize, font, bounds }).line];

  const textColor = colorFromDa(da);
  setDa([setFillingColor(textColor).toString(), setFontAndSize(font.name, fontSize).toString()].join('\n'));

  return [
    ...rotateInPlace({ ...rectangle, rotation }),
    ...drawTextField({
      x: borderWidth / 2,
      y: borderWidth / 2,
      width: width - borderWidth,
      height: height - borderWidth,
      borderWidth,
      borderColor: componentsToColor(ap?.getBorderColor()),
      color: componentsToColor(ap?.getBackgroundColor()),
      textColor,
      font: font.name,
      fontSize,
      textLines,
      padding: PADDING,
    }),
  ];
}

/** Text field appearance at a fixed, already-fitted size with PADDING on every side. */
export function textAppearance(fontSize: number): AppearanceProviderFor<PDFTextField> {
  return (field, widget, font) =>
    draw({
      widget,
      text: field.getText() ?? '',
      font,
      fontSize,
      multiline: field.isMultiline(),
      alignment: field.getAlignment(),
      da: field.acroField.getDefaultAppearance(),
      setDa: (da) => field.acroField.setDefaultAppearance(da),
    });
}

/** Dropdown appearance showing `label` (the option's display text), same padding. */
export function dropdownAppearance(label: string, fontSize: number): AppearanceProviderFor<PDFDropdown> {
  return (field, widget, font) =>
    draw({
      widget,
      text: label,
      font,
      fontSize,
      multiline: false,
      alignment: TextAlignment.Left,
      da: field.acroField.getDefaultAppearance(),
      setDa: (da) => field.acroField.setDefaultAppearance(da),
    });
}
