/**
 * src/lib/document/sniff.ts
 *
 * File_Sniffer (formbridge-any-document Requirement 2, design Q6). The kind of
 * a file comes from its bytes alone: the file name and MIME type never change
 * the result. `sniffHead` is pure and total: it returns exactly one result for
 * any byte sequence and never throws. It reads at most the first 65,536 bytes
 * (2.8). A PDF needs a bounded structure read (`classifyPdf`).
 */

import { PDFDocument } from 'pdf-lib';
import { collectLogicalFields, isAnswerField } from '../pdf-extract/fields.js';
import { hasXfa } from '../pdf-extract/rejection.js';
import { PDF_STRUCTURE_READ_MAX, SNIFF_HEAD_BYTES } from './limits.js';

export type SourceKind =
  | 'fillable-pdf'
  | 'pdf-without-fields'
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'heic'
  | 'svg'
  | 'docx'
  | 'txt'
  | 'refused'
  | 'unknown';

export type RefusedFormat = 'rtf' | 'ole' | 'zip' | 'gif' | 'bmp' | 'tiff' | 'webp' | 'heic' | 'svg' | 'text';

export interface SniffResult {
  kind: SourceKind;
  /** For `refused`: which recognised format, for the plain-language message only. */
  refusedFormat?: RefusedFormat;
}

const at = (b: Uint8Array, offset: number, sig: readonly number[]) => sig.every((v, i) => b[offset + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const refused = (refusedFormat: RefusedFormat): SniffResult => ({ kind: 'refused', refusedFormat });

const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heif'];
const BMP_DIB_SIZES = [12, 40, 52, 56, 64, 108, 124];

function containsPdfHeader(head: Uint8Array): boolean {
  const limit = Math.min(head.length, 1024) - 5;
  for (let i = 0; i <= limit; i++) if (at(head, i, ascii('%PDF-'))) return true;
  return false;
}

/** BMP is only two letters ("BM"), so the reserved field and the DIB header size must fit too. */
function isBmp(b: Uint8Array): boolean {
  if (!at(b, 0, ascii('BM')) || b.length < 18) return false;
  if (b[6] !== 0 || b[7] !== 0 || b[8] !== 0 || b[9] !== 0) return false;
  const dib = b[14]! | (b[15]! << 8) | (b[16]! << 16) | (b[17]! << 24);
  return BMP_DIB_SIZES.includes(dib);
}

function decodeText(head: Uint8Array): string | null {
  for (const byte of head) {
    if (byte === 0) return null;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return null;
    if (byte === 0x7f) return null;
  }
  try {
    // `stream` lets the head end in the middle of a multi-byte character.
    return new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
  } catch {
    return null;
  }
}

function isSvgText(text: string): boolean {
  const t = text.replace(/^\uFEFF/, '').trimStart();
  if (/^<svg[\s>]/i.test(t)) return true;
  return /^<\?xml[\s\S]*?\?>\s*(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(t);
}

/** Pure and total: never throws for any byte sequence. */
export function sniffHead(headIn: Uint8Array): SniffResult | { kind: 'pdf' } {
  const head = headIn.length > SNIFF_HEAD_BYTES ? headIn.subarray(0, SNIFF_HEAD_BYTES) : headIn;
  if (head.length === 0) return { kind: 'unknown' };
  if (containsPdfHeader(head)) return { kind: 'pdf' };
  if (at(head, 0, [0xff, 0xd8, 0xff])) return { kind: 'jpeg' };
  if (at(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return at(head, 12, ascii('IHDR')) ? { kind: 'png' } : { kind: 'unknown' };
  }
  if (at(head, 0, ascii('{\\rtf'))) return refused('rtf');
  if (at(head, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return refused('ole');
  if (at(head, 0, [0x50, 0x4b, 0x03, 0x04])) return refused('zip');
  if (at(head, 0, ascii('RIFF')) && at(head, 8, ascii('WEBP'))) return refused('webp');
  if (at(head, 4, ascii('ftyp')) && HEIC_BRANDS.some((b) => at(head, 8, ascii(b)))) return refused('heic');
  if (at(head, 0, ascii('GIF87a')) || at(head, 0, ascii('GIF89a'))) return refused('gif');
  if (isBmp(head)) return refused('bmp');
  if (at(head, 0, [0x49, 0x49, 0x2a, 0x00]) || at(head, 0, [0x4d, 0x4d, 0x00, 0x2a])) return refused('tiff');
  const text = decodeText(head);
  if (text === null) return { kind: 'unknown' };
  return isSvgText(text) ? refused('svg') : refused('text');
}

/**
 * A PDF is `fillable-pdf` when its AcroForm carries XFA, or when it has at
 * least one answer field (a push button is not an answer field). Everything
 * else is `pdf-without-fields`, including an encrypted file whose AcroForm
 * cannot be read and a malformed file pdf-lib cannot load: the Document_Path
 * then shows the encryption or decoding message (Requirements 2.2, 3.6).
 * This mapping is the defined classification, not a swallowed error.
 */
export async function classifyPdf(bytes: Uint8Array): Promise<'fillable-pdf' | 'pdf-without-fields'> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    return 'pdf-without-fields';
  }
  try {
    if (hasXfa(doc)) return 'fillable-pdf';
    return collectLogicalFields(doc).some(isAnswerField) ? 'fillable-pdf' : 'pdf-without-fields';
  } catch {
    return 'pdf-without-fields';
  }
}

export async function sniffFile(file: Blob): Promise<SniffResult> {
  const head = new Uint8Array(await file.slice(0, SNIFF_HEAD_BYTES).arrayBuffer());
  const result = sniffHead(head);
  if (result.kind !== 'pdf') return result;
  // Past the structure-read bound the size check refuses the file; the PDF is not read.
  if (file.size > PDF_STRUCTURE_READ_MAX) return { kind: 'pdf-without-fields' };
  return { kind: await classifyPdf(new Uint8Array(await file.arrayBuffer())) };
}
