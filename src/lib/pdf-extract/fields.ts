/**
 * src/lib/pdf-extract/fields.ts
 *
 * Shared AcroForm traversal used by both the rejection checks and the evidence
 * extraction, so both count and describe exactly the same logical fields.
 *
 * Rules:
 * - A field node is terminal when it has no /Kids, or when (some of) its /Kids
 *   are widget annotations, meaning kids without their own /T. Kids that have a
 *   /T are child fields and are visited recursively.
 * - /FT, /Ff, /MaxLen and /V are inherited from ancestors; a local value overrides.
 *   /TU and /Opt are read from the terminal field node itself.
 * - Exactly one record per fully qualified name; widgets of duplicate nodes merge.
 * - A visited set and a depth limit stop cyclic or absurdly deep /Kids trees.
 * - Every widget gets its own page, resolved through the page /Annots arrays or
 *   the widget's /P reference. Unresolved widgets keep `pageIndex: undefined`.
 */

import { PDFArray, PDFDict, PDFName, PDFRef, type PDFDocument, type PDFObject } from 'pdf-lib';
import { getAny, getNameText, getNumber, getText, resolveAs } from './pdf-objects.js';

/** Btn flag bits and Ch flag bits from the PDF specification (Ff values). */
export const FF = {
  READ_ONLY: 1,
  REQUIRED: 2,
  MULTILINE: 4096,
  RADIO: 32768,
  PUSHBUTTON: 65536,
  COMBO: 131072,
  MULTI_SELECT: 2097152,
} as const;

const MAX_DEPTH = 32;

export interface WidgetNode {
  dict: PDFDict;
  ref?: PDFRef;
  /** 0-based page index, or undefined if the widget is not on any page. */
  pageIndex?: number;
}

export interface LogicalField {
  /** Fully qualified name, e.g. "patient.fullName". */
  name: string;
  /** The terminal field node (holds /TU, /Opt and the field value). */
  dict: PDFDict;
  /** Inherited field type: Tx, Btn, Ch or Sig. */
  ft: string | undefined;
  /** Inherited field flags. */
  ff: number;
  /** Inherited /MaxLen. */
  maxLen: number | undefined;
  /** Inherited /V (resolved). Used only for structural signature detection. */
  value: PDFObject | undefined;
  widgets: WidgetNode[];
}

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'signature' | 'pushbutton';

/** The kind of a logical field, or undefined if it has no recognised /FT. */
export function fieldKind(field: Pick<LogicalField, 'ft' | 'ff'>): FieldKind | undefined {
  switch (field.ft) {
    case 'Tx':
      return 'text';
    case 'Btn':
      if (field.ff & FF.PUSHBUTTON) return 'pushbutton';
      if (field.ff & FF.RADIO) return 'radio';
      return 'checkbox';
    case 'Ch':
      return 'dropdown';
    case 'Sig':
      return 'signature';
    default:
      return undefined;
  }
}

/** Kinds that the user can answer (pushbuttons and untyped nodes are not answer fields). */
export function isAnswerField(field: LogicalField): boolean {
  const kind = fieldKind(field);
  return kind !== undefined && kind !== 'pushbutton';
}

/**
 * The single signature rule: a signature field is populated when its
 * (inherited) /V resolves to a dictionary. Structural detection only.
 */
export function isSignaturePopulated(field: LogicalField): boolean {
  return fieldKind(field) === 'signature' && field.value instanceof PDFDict;
}

interface Inherited {
  ft: string | undefined;
  ff: number;
  maxLen: number | undefined;
  value: PDFObject | undefined;
}

/** Maps from annotation identity to page index, built once per document. */
function buildPageIndex(pdfDoc: PDFDocument) {
  const byRef = new Map<string, number>();
  const byDict = new Map<PDFDict, number>();
  const byPageRef = new Map<string, number>();
  const key = (r: PDFRef) => `${r.objectNumber} ${r.generationNumber}`;

  pdfDoc.getPages().forEach((page, p) => {
    byPageRef.set(key(page.ref), p);
    const annots = resolveAs(pdfDoc.context, getAny(page.node, 'Annots'), PDFArray);
    if (!annots) return;
    for (let i = 0; i < annots.size(); i++) {
      const entry = annots.get(i);
      if (entry instanceof PDFRef) {
        if (!byRef.has(key(entry))) byRef.set(key(entry), p);
      } else if (entry instanceof PDFDict && !byDict.has(entry)) {
        byDict.set(entry, p);
      }
    }
  });

  return (widget: WidgetNode): number | undefined => {
    if (widget.ref) {
      const p = byRef.get(key(widget.ref));
      if (p !== undefined) return p;
    }
    const direct = byDict.get(widget.dict);
    if (direct !== undefined) return direct;
    const pRef = widget.dict.get(PDFName.of('P'));
    if (pRef instanceof PDFRef) return byPageRef.get(key(pRef));
    return undefined;
  };
}

/**
 * Collect every logical (terminal) field of the document's AcroForm.
 * Never throws: malformed nodes are skipped.
 */
export function collectLogicalFields(pdfDoc: PDFDocument): LogicalField[] {
  const context = pdfDoc.context;
  const acroForm = resolveAs(context, getAny(pdfDoc.catalog, 'AcroForm'), PDFDict);
  if (!acroForm) return [];
  const topLevel = resolveAs(context, getAny(acroForm, 'Fields'), PDFArray);
  if (!topLevel) return [];

  const pageOf = buildPageIndex(pdfDoc);
  const visited = new Set<PDFDict>();
  const byName = new Map<string, LogicalField>();
  const order: LogicalField[] = [];

  const addTerminal = (name: string, dict: PDFDict, inh: Inherited, widgets: WidgetNode[]) => {
    if (!name) return;
    for (const w of widgets) {
      const p = pageOf(w);
      if (p !== undefined) w.pageIndex = p;
    }
    const existing = byName.get(name);
    if (existing) {
      existing.widgets.push(...widgets);
      return;
    }
    const field: LogicalField = { name, dict, ...inh, widgets };
    byName.set(name, field);
    order.push(field);
  };

  const visit = (obj: PDFObject, parentName: string, inherited: Inherited, depth: number) => {
    if (depth > MAX_DEPTH) return;
    const dict = resolveAs(context, obj, PDFDict);
    if (!dict || visited.has(dict)) return;
    visited.add(dict);

    const partial = getText(dict, 'T');
    const name = partial === undefined ? parentName : parentName ? `${parentName}.${partial}` : partial;
    const inh: Inherited = {
      ft: getNameText(dict, 'FT') ?? inherited.ft,
      ff: getNumber(dict, 'Ff') ?? inherited.ff,
      maxLen: getNumber(dict, 'MaxLen') ?? inherited.maxLen,
      value: getAny(dict, 'V') ?? inherited.value,
    };

    const kids = resolveAs(context, getAny(dict, 'Kids'), PDFArray);
    if (!kids || kids.size() === 0) {
      // Merged field and widget annotation (or a malformed /Kids value).
      addTerminal(name, dict, inh, [{ dict, ...(obj instanceof PDFRef ? { ref: obj } : {}) }]);
      return;
    }

    const widgetKids: WidgetNode[] = [];
    const fieldKids: PDFObject[] = [];
    for (let i = 0; i < kids.size(); i++) {
      const kidObj = kids.get(i);
      const kid = resolveAs(context, kidObj, PDFDict);
      if (!kid || visited.has(kid)) continue;
      if (getText(kid, 'T') !== undefined) {
        fieldKids.push(kidObj);
      } else {
        visited.add(kid);
        widgetKids.push({ dict: kid, ...(kidObj instanceof PDFRef ? { ref: kidObj } : {}) });
      }
    }

    if (widgetKids.length > 0) addTerminal(name, dict, inh, widgetKids);
    for (const kidObj of fieldKids) visit(kidObj, name, inh, depth + 1);
  };

  const root: Inherited = { ft: undefined, ff: 0, maxLen: undefined, value: undefined };
  for (let i = 0; i < topLevel.size(); i++) {
    visit(topLevel.get(i), '', root, 0);
  }
  return order;
}
