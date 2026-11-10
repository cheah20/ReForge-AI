/**
 * src/lib/pdf-fill/font.ts
 *
 * Fonts for PDF appearance streams.
 *
 * A FontMap is an ordered list of fonts. For each text answer, the first font
 * that has a glyph for every character is used (requirement 8.7); if none does,
 * the write is blocked with CharacterNotRepresentableError. Glyph coverage uses
 * fontkit's `hasGlyphForCodePoint`, never `encodeText`, because encodeText maps
 * missing characters to .notdef instead of failing.
 *
 * Coverage is necessary, not sufficient: it does not prove correct shaping for
 * complex scripts such as Tamil.
 */

import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument, PDFFont } from 'pdf-lib';

export type FontScript = 'latin';

export interface FontSource {
  /** Stable id, used as the key for embedding and caching. */
  id: string;
  bytes: Uint8Array;
  /**
   * Subset the embedded font to the glyphs used (default true). Large CJK fonts
   * may need `false` if subsetting corrupts them (Spike 2 decides).
   */
  subset?: boolean;
}

/** Ordered by priority. */
export type FontMap = readonly FontSource[];

/** Self-hosted font files by script. */
export const FONT_URLS: Readonly<Record<FontScript, string>> = {
  latin: '/fonts/NotoSans-Regular.ttf',
};

const loaded = new Map<string, Promise<FontSource>>();

/** Fetch a script's font once (lazy); later calls share the same promise. */
export function loadFont(script: FontScript, fetchFn: typeof fetch = fetch): Promise<FontSource> {
  let promise = loaded.get(script);
  if (!promise) {
    promise = fetchFn(FONT_URLS[script])
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load the ${script} font (HTTP ${res.status})`);
        return { id: `noto-${script}`, bytes: new Uint8Array(await res.arrayBuffer()) };
      })
      .catch((err) => {
        loaded.delete(script); // allow a retry
        throw err;
      });
    loaded.set(script, promise);
  }
  return promise;
}

/** Forget downloaded fonts (tests). */
export function clearLoadedFonts(): void {
  loaded.clear();
}

interface ParsedFont {
  hasGlyphForCodePoint(codePoint: number): boolean;
}

const parsed = new WeakMap<Uint8Array, ParsedFont>();

function parse(source: FontSource): ParsedFont {
  let font = parsed.get(source.bytes);
  if (!font) {
    font = fontkit.create(source.bytes as unknown as Buffer) as unknown as ParsedFont;
    parsed.set(source.bytes, font);
  }
  return font;
}

/** First code point of `text` that `source` cannot draw, or undefined. Line breaks are not drawn. */
export function firstMissingCodePoint(source: FontSource, text: string): number | undefined {
  const font = parse(source);
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x0a || cp === 0x0d) continue;
    if (!font.hasGlyphForCodePoint(cp)) return cp;
  }
  return undefined;
}

export interface FontChoice {
  source: FontSource;
}

/**
 * The font to draw `text` with: the first in the map covering every character.
 * When none does, `missing` is the first character the best candidate lacks
 * (the first font's, so the message names a character the user can fix).
 */
export function chooseFont(map: FontMap, text: string): { source: FontSource } | { missing: number } {
  let firstMissing: number | undefined;
  for (const source of map) {
    const missing = firstMissingCodePoint(source, text);
    if (missing === undefined) return { source };
    firstMissing ??= missing;
  }
  return { missing: firstMissing ?? 0xfffd };
}

const embedded = new WeakMap<PDFDocument, Map<string, Promise<PDFFont>>>();

/** Embed a font in a document once (registering fontkit on first use). */
export function embedFont(pdfDoc: PDFDocument, source: FontSource): Promise<PDFFont> {
  let perDoc = embedded.get(pdfDoc);
  if (!perDoc) {
    pdfDoc.registerFontkit(fontkit);
    perDoc = new Map();
    embedded.set(pdfDoc, perDoc);
  }
  let font = perDoc.get(source.id);
  if (!font) {
    font = pdfDoc.embedFont(source.bytes, { subset: source.subset ?? true });
    perDoc.set(source.id, font);
  }
  return font;
}
