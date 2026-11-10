/**
 * tests/helpers/pdf-builder.ts
 *
 * Builds small synthetic AcroForm PDFs in memory for edge-case tests.
 * Rects are native PDF rects: [left, bottom, right, top].
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFString,
  StandardFonts,
  type PDFPage,
} from 'pdf-lib';

export type Rect = [number, number, number, number];

export class FormBuilder {
  readonly fields: PDFArray;
  private constructor(
    readonly doc: PDFDocument,
    readonly acroForm: PDFDict,
  ) {
    this.fields = acroForm.lookup(PDFName.of('Fields'), PDFArray);
  }

  static async create(pageCount = 1, size: [number, number] = [595.28, 841.89]): Promise<FormBuilder> {
    const doc = await PDFDocument.create({ updateMetadata: false });
    for (let i = 0; i < pageCount; i++) doc.addPage(size);
    const acroForm = doc.context.obj({ Fields: doc.context.obj([]) });
    doc.catalog.set(PDFName.of('AcroForm'), doc.context.register(acroForm));
    return new FormBuilder(doc, acroForm);
  }

  get ctx() {
    return this.doc.context;
  }

  page(i = 0): PDFPage {
    return this.doc.getPage(i);
  }

  /** Add an annotation ref to a page's /Annots array. */
  annotate(ref: PDFRef, pageIndex = 0): void {
    const node = this.page(pageIndex).node;
    let annots = node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) {
      annots = this.ctx.obj([]);
      node.set(PDFName.of('Annots'), annots);
    }
    annots.push(ref);
  }

  /** Register a dict built from `entries`; optionally list it in /Fields. */
  node(entries: Record<string, unknown>, topLevel = false): { ref: PDFRef; dict: PDFDict } {
    const dict = this.ctx.obj(entries as never) as unknown as PDFDict;
    const ref = this.ctx.register(dict);
    if (topLevel) this.fields.push(ref);
    return { ref, dict };
  }

  /** A widget annotation (no /T) on a page, optionally with a parent. */
  widget(rect: Rect, opts: { parent?: PDFRef; page?: number; onAnnots?: boolean; extra?: Record<string, unknown> } = {}) {
    const w = this.node({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Widget'),
      Rect: this.ctx.obj(rect),
      ...(opts.parent ? { Parent: opts.parent } : {}),
      ...(opts.extra ?? {}),
    });
    if (opts.onAnnots !== false) this.annotate(w.ref, opts.page ?? 0);
    return w;
  }

  /** A merged field + widget at the top level. */
  textField(name: string, rect: Rect, extra: Record<string, unknown> = {}, page = 0) {
    const f = this.node(
      {
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Widget'),
        FT: PDFName.of('Tx'),
        T: PDFString.of(name),
        Rect: this.ctx.obj(rect),
        ...extra,
      },
      true,
    );
    this.annotate(f.ref, page);
    return f;
  }

  /** Add kids to a field node. */
  setKids(parent: PDFDict, kids: PDFRef[]): void {
    parent.set(PDFName.of('Kids'), this.ctx.obj(kids));
  }

  async drawText(text: string, x: number, y: number, size = 10, page = 0): Promise<void> {
    const font = await this.doc.embedFont(StandardFonts.Helvetica);
    this.page(page).drawText(text, { x, y, size, font });
  }

  async save(): Promise<Uint8Array> {
    return this.doc.save({ updateFieldAppearances: false });
  }
}
