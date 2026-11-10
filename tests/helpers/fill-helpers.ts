/**
 * tests/helpers/fill-helpers.ts
 *
 * Helpers for the PDF fill tests: fonts, reading values back, and decoding
 * what an appearance stream draws.
 */

import { readFileSync } from 'fs';
import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, type PDFField, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { FontMap, FontSource } from '../../src/lib/pdf-fill/font.js';

const NOTO = new Uint8Array(readFileSync('public/fonts/NotoSans-Regular.ttf'));

/** Whole (unsubsetted) Noto Sans, so glyph ids match a fresh encodeText. */
export const FULL_FONT: FontSource = { id: 'noto-full', bytes: NOTO, subset: false };
export const SUBSET_FONT: FontSource = { id: 'noto-subset', bytes: NOTO, subset: true };
export const LATIN_MAP: FontMap = [FULL_FONT];

export const fixtureBytes = (name: string) => new Uint8Array(readFileSync(`fixtures/${name}`));

export async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

/** The hex glyph string `text` becomes when drawn with the full Noto font. */
export async function glyphHex(text: string): Promise<string> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font: PDFFont = await doc.embedFont(NOTO, { subset: false });
  const hex = font.encodeText(text).toString().replace(/[<>]/g, '').toUpperCase();
  return `<${hex}>`;
}

/** Content of the normal appearance stream of each widget of `field`. */
export function appearanceStreams(field: PDFField): string[] {
  return field.acroField.getWidgets().map((w) => {
    const n = w.dict.lookup(PDFName.of('AP'));
    const normal = n && 'lookup' in n ? (n as unknown as { lookup(k: PDFName): unknown }).lookup(PDFName.of('N')) : undefined;
    return normal instanceof PDFStream ? streamText(normal) : '';
  });
}

/** Decoded (inflated) content of a stream, as text. */
export function streamText(stream: PDFStream): string {
  const bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  return Buffer.from(bytes).toString('latin1');
}

/** Normal appearance state names of a button widget. */
export function appearanceState(field: PDFField): string[] {
  return field.acroField.getWidgets().map((w) => String(w.dict.get(PDFName.of('AS')) ?? ''));
}

export function isRef(x: unknown): x is PDFRef {
  return x instanceof PDFRef;
}

/** Snapshot of a field that must not change when it is untouched. */
export function snapshot(doc: PDFDocument, name: string): string {
  const field = doc.getForm().getField(name);
  const dict = field.acroField.dict;
  const parts = [String(dict.get(PDFName.of('V'))), String(dict.get(PDFName.of('DV'))), String(dict.get(PDFName.of('I')))];
  field.acroField.getWidgets().forEach((w) => {
    parts.push(String(w.dict.get(PDFName.of('AS'))));
    const ap = w.dict.lookup(PDFName.of('AP'));
    parts.push(ap ? JSON.stringify(streamsIn(ap)) : 'no-ap');
  });
  return JSON.stringify(parts);
}

/** All stream contents reachable in an /AP dictionary (normal, rollover, down). */
function streamsIn(obj: unknown, depth = 0): unknown {
  if (depth > 3) return 'deep';
  if (obj instanceof PDFStream) return streamText(obj);
  if (obj && typeof obj === 'object' && 'entries' in obj) {
    const dict = obj as { entries(): [PDFName, unknown][]; lookup(k: PDFName): unknown };
    return Object.fromEntries(dict.entries().map(([k]) => [String(k), streamsIn(dict.lookup(k), depth + 1)]));
  }
  return String(obj);
}
