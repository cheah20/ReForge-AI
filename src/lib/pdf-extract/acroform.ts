/**
 * src/lib/pdf-extract/acroform.ts
 *
 * Builds FieldEvidence from the shared logical-field traversal (fields.ts).
 *
 * - One evidence record per logical field; every widget carries its own page and rect.
 * - Pushbuttons are not answer fields and are left out.
 * - Multi-select choice fields keep `multiSelect: true` (the wizard shows them as
 *   "fill this yourself"). Single-select list boxes are treated as dropdowns (decision 8).
 * - Radio export values come from /Opt (mapped to widgets in order) when present,
 *   otherwise from the widgets' appearance state names (decision 13).
 * - A field with no widget on a resolvable page gets `unresolvedPage: true`
 *   instead of being placed on page 1.
 * - Field values are never read into evidence: no /V, /DV, /I, /AS or appearance
 *   text (decision 18). The only value-derived flag is `hasValue` for signatures.
 */

import { PDFArray, PDFDict, type PDFDocument, type PDFPage } from 'pdf-lib';
import type { FieldEvidence, FieldOption, Widget } from '../../shared/types.js';
import {
  FF,
  fieldKind,
  isAnswerField,
  isSignaturePopulated,
  type LogicalField,
  type WidgetNode,
} from './fields.js';
import {
  decodeName,
  getAny,
  getRect,
  getText,
  resolveAny,
  resolveAs,
  textOf,
  type PdfRect,
} from './pdf-objects.js';

const MAX_WIDGETS = 20;
const MAX_OPTIONS = 50;
const MAX_TEXT = 200;

/** A widget in native PDF user space, aligned with `evidence.widgets` by index. */
export interface PdfWidget {
  pageIndex: number;
  rect: PdfRect;
}

export interface ExtractedField {
  evidence: FieldEvidence;
  pdfWidgets: PdfWidget[];
}

/** /Opt entries of a choice field as export/display pairs. */
function choiceOptions(pdfDoc: PDFDocument, dict: PDFDict): FieldOption[] {
  const opt = resolveAs(pdfDoc.context, getAny(dict, 'Opt'), PDFArray);
  if (!opt) return [];
  const options: FieldOption[] = [];
  for (let i = 0; i < opt.size() && options.length < MAX_OPTIONS; i++) {
    const ctx = pdfDoc.context;
    const entry = resolveAny(ctx, opt.get(i));
    let exportValue: string | undefined;
    let displayLabel: string | undefined;
    if (entry instanceof PDFArray) {
      exportValue = textOf(resolveAny(ctx, entry.get(0)));
      displayLabel = entry.size() > 1 ? textOf(resolveAny(ctx, entry.get(1))) : undefined;
    } else {
      exportValue = textOf(entry);
    }
    if (!exportValue || exportValue.length > MAX_TEXT) continue;
    const label = (displayLabel && displayLabel.trim()) || exportValue;
    options.push({ exportValue, displayLabel: label.slice(0, MAX_TEXT) });
  }
  return options;
}

/** Appearance on-state name of a radio or checkbox widget (anything except Off). */
function onStateName(pdfDoc: PDFDocument, widget: PDFDict): string | undefined {
  const ap = resolveAs(pdfDoc.context, getAny(widget, 'AP'), PDFDict);
  if (!ap) return undefined;
  const normal = resolveAs(pdfDoc.context, getAny(ap, 'N'), PDFDict);
  if (!normal) return undefined;
  for (const key of normal.keys()) {
    const name = decodeName(key);
    if (name !== 'Off') return name;
  }
  return undefined;
}

/** Radio export values: /Opt strings mapped to widgets in order, else on-state names. */
function radioOptions(pdfDoc: PDFDocument, field: LogicalField): FieldOption[] {
  const opt = resolveAs(pdfDoc.context, getAny(field.dict, 'Opt'), PDFArray);
  const values: string[] = [];
  if (opt && opt.size() > 0) {
    for (let i = 0; i < Math.min(opt.size(), field.widgets.length); i++) {
      const v = textOf(resolveAny(pdfDoc.context, opt.get(i)));
      if (v) values.push(v);
    }
  } else {
    for (const w of field.widgets) {
      const v = onStateName(pdfDoc, w.dict);
      if (v) values.push(v);
    }
  }
  const seen = new Set<string>();
  const options: FieldOption[] = [];
  for (const v of values) {
    if (seen.has(v) || v.length > MAX_TEXT || options.length >= MAX_OPTIONS) continue;
    seen.add(v);
    options.push({ exportValue: v, displayLabel: v });
  }
  return options;
}

/** Page geometry needed to express a rect in top-origin page coordinates. */
interface PageBox {
  x: number;
  top: number;
}

function pageBox(page: PDFPage): PageBox {
  try {
    const crop = page.getCropBox();
    return { x: crop.x, top: crop.y + crop.height };
  } catch {
    return { x: 0, top: page.getHeight() };
  }
}

/** Convert a native PDF rect to the top-origin bbox used in evidence. */
function topOriginBbox(rect: PdfRect, box: PageBox): Widget['bbox'] {
  return {
    left: rect.left - box.x,
    top: box.top - rect.top,
    right: rect.right - box.x,
    bottom: box.top - rect.bottom,
  };
}

/** Widgets that have both a resolved page and a valid /Rect. */
function locatedWidgets(pdfDoc: PDFDocument, widgets: WidgetNode[]): PdfWidget[] {
  const out: PdfWidget[] = [];
  for (const w of widgets) {
    if (w.pageIndex === undefined) continue;
    const rect = getRect(pdfDoc.context, w.dict);
    if (!rect) continue;
    out.push({ pageIndex: w.pageIndex, rect });
  }
  return out;
}

/** Build one evidence record per logical answer field. Never throws for malformed fields. */
export function buildEvidence(pdfDoc: PDFDocument, fields: LogicalField[]): ExtractedField[] {
  const pages = pdfDoc.getPages();
  const boxes = new Map<number, PageBox>();
  const boxFor = (i: number) => {
    let b = boxes.get(i);
    if (!b) {
      b = pageBox(pages[i]!);
      boxes.set(i, b);
    }
    return b;
  };

  const result: ExtractedField[] = [];
  for (const field of fields) {
    if (!isAnswerField(field)) continue;
    const kind = fieldKind(field)!;
    if (kind === 'pushbutton') continue;

    const pdfWidgets = locatedWidgets(pdfDoc, field.widgets).slice(0, MAX_WIDGETS);
    const widgets: Widget[] = pdfWidgets.map((w) => ({
      pageNumber: w.pageIndex + 1,
      bbox: topOriginBbox(w.rect, boxFor(w.pageIndex)),
      pageSnippet: '',
    }));

    const evidence: FieldEvidence = {
      fieldId: field.name,
      fieldType: kind,
      required: (field.ff & FF.REQUIRED) !== 0,
      readOnly: (field.ff & FF.READ_ONLY) !== 0,
      hasValue: kind === 'signature' ? isSignaturePopulated(field) : false,
      widgets,
    };

    if (widgets.length === 0) evidence.unresolvedPage = true;

    const tooltip = getText(field.dict, 'TU');
    if (tooltip && tooltip.trim()) evidence.tooltip = tooltip.slice(0, MAX_TEXT);

    if (kind === 'text') {
      const max = field.maxLen;
      if (max !== undefined && Number.isInteger(max) && max > 0 && max <= 32767) {
        evidence.maxLength = max;
      }
      if (field.ff & FF.MULTILINE) evidence.multiline = true;
    }

    if (kind === 'dropdown') {
      if (field.ff & FF.MULTI_SELECT) evidence.multiSelect = true;
      const options = choiceOptions(pdfDoc, field.dict);
      if (options.length > 0) evidence.options = options;
    }

    if (kind === 'radio') {
      const options = radioOptions(pdfDoc, field);
      if (options.length > 0) evidence.options = options;
    }

    result.push({ evidence, pdfWidgets });
  }
  return result;
}
