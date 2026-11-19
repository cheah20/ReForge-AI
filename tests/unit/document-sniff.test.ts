/**
 * tests/unit/document-sniff.test.ts
 *
 * File_Sniffer, limits and the image header reader (formbridge-any-document
 * tasks 4.1, 4.2, 4.5, 4.6). Every bundled fixture kind, the 15 MB limit and
 * one byte over, the empty file, a push-button-only PDF and an encrypted PDF.
 * Validates: Requirements 2.1, 2.2, 2.7, 2.8, 3.3
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { classifyPdf, sniffFile, sniffHead } from '../../src/lib/document/sniff.js';
import { displayedSize, readImageHeader } from '../../src/lib/document/image-header.js';
import { MAX_DECODED_PIXELS, MAX_DOCUMENT_BYTES, SNIFF_HEAD_BYTES, VALIDATED_OCR_LANGUAGES } from '../../src/lib/document/limits.js';
import { oversizeBytes } from '../../scripts/create-fixtures/documents.js';

const doc = (name: string) => new Uint8Array(readFileSync(path.join('fixtures', 'documents', name)));
const fix = (name: string) => new Uint8Array(readFileSync(path.join('fixtures', name)));
const blob = (bytes: Uint8Array) => new Blob([bytes as unknown as BlobPart]);
const kindOf = async (bytes: Uint8Array) => (await sniffFile(blob(bytes))).kind;

describe('limits (task 4.1)', () => {
  it('holds the numbers of Requirement 3', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(15 * 1024 * 1024);
    expect(MAX_DECODED_PIXELS).toBe(20_000_000);
    expect(SNIFF_HEAD_BYTES).toBe(65_536);
  });

  it('offers English and, because Malay passed the bar, Malay', () => {
    expect(VALIDATED_OCR_LANGUAGES).toEqual(['eng', 'msa']);
  });
});

describe('sniffFile on the bundled fixtures (2.1, 2.2)', () => {
  it.each([
    ['clean-en.png', 'png'],
    ['clean-en.jpg', 'jpeg'],
    ['rotated-exif6.jpg', 'jpeg'],
    ['glary.jpg', 'jpeg'],
    ['mixed-text-and-scan.pdf', 'pdf-without-fields'],
    ['six-pages.pdf', 'pdf-without-fields'],
    ['push-button-only.pdf', 'pdf-without-fields'],
    ['truncated.jpg', 'jpeg'],
    ['truncated.png', 'png'],
    ['bad-crc.png', 'png'],
    ['broken.pdf', 'pdf-without-fields'],
    ['empty.bin', 'unknown'],
  ])('%s is %s', async (file, kind) => {
    expect((await sniffFile(blob(doc(file)))).kind).toBe(kind);
  });

  it('refuses RTF and legacy Word, naming the format only for the message', async () => {
    expect(await sniffFile(blob(doc('form.rtf')))).toEqual({ kind: 'refused', refusedFormat: 'rtf' });
    expect(await sniffFile(blob(doc('form.doc')))).toEqual({ kind: 'refused', refusedFormat: 'ole' });
  });

  it('a fillable PDF with answer fields is fillable-pdf, and so is one with XFA', async () => {
    expect(await kindOf(fix('clinic-registration.pdf'))).toBe('fillable-pdf');
    expect(await kindOf(fix('us-community-clinic.pdf'))).toBe('fillable-pdf');
    expect(await kindOf(fix('xfa-acroform.pdf'))).toBe('fillable-pdf');
  });

  it('an existing PDF with no fields is pdf-without-fields (it no longer ends in a rejection)', async () => {
    expect(await kindOf(fix('no-fields.pdf'))).toBe('pdf-without-fields');
  });

  it('an encrypted PDF whose form cannot be read is pdf-without-fields', async () => {
    expect(await kindOf(fix('encrypted.pdf'))).toBe('pdf-without-fields');
  });
});

describe('sniffHead rows of the design table', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  const head = (...b: number[]) => new Uint8Array(b);

  it('the file name and type never matter: the same bytes give the same kind in any Blob', async () => {
    const png = doc('clean-en.png');
    const named = new File([png as unknown as BlobPart], 'photo.pdf', { type: 'application/pdf' });
    expect((await sniffFile(named)).kind).toBe('png');
  });

  it.each([
    ['GIF', bytes('GIF89a....'), 'gif'],
    ['TIFF little-endian', head(0x49, 0x49, 0x2a, 0x00, 1, 2), 'tiff'],
    ['TIFF big-endian', head(0x4d, 0x4d, 0x00, 0x2a, 1, 2), 'tiff'],
    ['WebP', bytes('RIFF\0\0\0\0WEBPVP8 '), 'webp'],
    ['ZIP', head(0x50, 0x4b, 0x03, 0x04, 0, 0), 'zip'],
    ['SVG', bytes('\uFEFF  <svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'svg'],
    ['SVG after an XML declaration', bytes('<?xml version="1.0"?>\n<svg width="1"></svg>'), 'svg'],
    ['plain text', bytes('Name: someone\nPhone: 555-0100\n'), 'text'],
  ])('%s is refused as %s', (_name, data, format) => {
    expect(sniffHead(data)).toEqual({ kind: 'refused', refusedFormat: format });
  });

  it('HEIC is recognised by its brand at offset 8', () => {
    const heic = new Uint8Array(16);
    heic.set(bytes('ftypheic'), 4);
    expect(sniffHead(heic)).toEqual({ kind: 'refused', refusedFormat: 'heic' });
  });

  it('two letters "BM" at the start of a text file are text, not a bitmap', () => {
    expect(sniffHead(bytes('BMW service form\n'))).toEqual({ kind: 'refused', refusedFormat: 'text' });
  });

  it('a PNG signature without an IHDR chunk is unknown', () => {
    const png = doc('clean-en.png').slice(0, 40);
    png.set(bytes('XXXX'), 12);
    expect(sniffHead(png)).toEqual({ kind: 'unknown' });
  });

  it('binary data with a control byte or a NUL is unknown, and text cut in a multi-byte character is still text', () => {
    expect(sniffHead(head(0x01, 0x02, 0x03))).toEqual({ kind: 'unknown' });
    expect(sniffHead(bytes('abc\0def'))).toEqual({ kind: 'unknown' });
    const cut = bytes('Nama: Ali \u00e9\u00e9').slice(0, -1);
    expect(sniffHead(cut)).toEqual({ kind: 'refused', refusedFormat: 'text' });
  });

  it('finds %PDF- within the first 1,024 bytes only', () => {
    const early = new Uint8Array(2000).fill(0x20);
    early.set(bytes('%PDF-1.7'), 1000);
    const late = new Uint8Array(2000).fill(0x20);
    late.set(bytes('%PDF-1.7'), 1100);
    expect(sniffHead(early).kind).toBe('pdf');
    expect(sniffHead(late).kind).not.toBe('pdf');
  });

  it('reads only the head: bytes past 65,536 never change the result', () => {
    const a = new Uint8Array(SNIFF_HEAD_BYTES + 100).fill(0x41);
    const b = a.slice();
    b.fill(0x00, SNIFF_HEAD_BYTES);
    expect(sniffHead(a)).toEqual(sniffHead(b));
  });
});

describe('the 15 MB limit (Requirement 3.1)', () => {
  it('the oversize file is one byte over the limit, and is still recognised by its bytes', async () => {
    const big = oversizeBytes();
    expect(big.byteLength).toBe(MAX_DOCUMENT_BYTES + 1);
    expect(big.byteLength > MAX_DOCUMENT_BYTES).toBe(true);
    expect(await kindOf(big)).toBe('jpeg');
  });

  it('a PDF larger than the structure-read bound is not read and is left to the size check', async () => {
    const big = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
    big.set(new TextEncoder().encode('%PDF-1.7\n'));
    expect(await kindOf(big)).toBe('pdf-without-fields');
  });
});

describe('classifyPdf', () => {
  it('returns pdf-without-fields for bytes pdf-lib cannot load', async () => {
    expect(await classifyPdf(new TextEncoder().encode('%PDF-1.7\nnot a pdf'))).toBe('pdf-without-fields');
  });
});

describe('image header reader (task 4.6, Requirement 3.3)', () => {
  it('reads the size of the PNG and JPEG fixtures without decoding them', () => {
    expect(readImageHeader(doc('clean-en.png'))).toEqual({ width: 1556, height: 2200, orientation: 1 });
    expect(readImageHeader(doc('clean-en.jpg'))).toEqual({ width: 1556, height: 2200, orientation: 1 });
  });

  it('reads EXIF orientation 6 from the tagged photo and swaps the displayed size', () => {
    const h = readImageHeader(doc('rotated-exif6.jpg'))!;
    expect(h).toEqual({ width: 2200, height: 1556, orientation: 6 });
    expect(displayedSize(h)).toEqual({ width: 1556, height: 2200 });
    expect(readImageHeader(doc('rotated-untagged.jpg'))!.orientation).toBe(1);
  });

  it('computes more than the pixel limit from the header alone for a 5,000 x 4,500 PNG', () => {
    const png = doc('clean-en.png').slice(0, 64);
    new DataView(png.buffer).setUint32(16, 5000);
    new DataView(png.buffer).setUint32(20, 4500);
    const h = readImageHeader(png)!;
    expect(h.width * h.height).toBeGreaterThan(MAX_DECODED_PIXELS);
  });

  it('returns null for a truncated header, a scan with no frame header and empty input', () => {
    expect(readImageHeader(doc('clean-en.jpg').slice(0, 10))).toBeNull();
    expect(readImageHeader(doc('clean-en.png').slice(0, 20))).toBeNull();
    expect(readImageHeader(new Uint8Array(0))).toBeNull();
    expect(readImageHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x04, 0x00, 0x00]))).toBeNull();
  });
});
