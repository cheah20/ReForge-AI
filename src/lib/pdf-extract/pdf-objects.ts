/**
 * src/lib/pdf-extract/pdf-objects.ts
 *
 * Safe accessors for pdf-lib objects. Uploaded PDFs are untrusted, so a value
 * of the wrong type, a dangling reference or a malformed entry must give
 * `undefined`, never an exception. pdf-lib's `lookupMaybe(key, Type)` throws on
 * a type mismatch, so extraction code uses these helpers instead.
 */

import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFContext,
  type PDFObject,
} from 'pdf-lib';

/** Any class, including pdf-lib classes with private or protected constructors. */
type Ctor<T> = { prototype: T };

/** Resolve `obj` (following an indirect reference) and return it only if it is a `Type`. */
export function resolveAs<T>(
  context: PDFContext,
  obj: PDFObject | undefined,
  Type: Ctor<T>,
): T | undefined {
  let value: PDFObject | undefined = obj;
  try {
    if (value instanceof PDFRef) value = context.lookup(value);
  } catch {
    return undefined;
  }
  return isInstance(value, Type) ? value : undefined;
}

function isInstance<T>(value: unknown, Type: Ctor<T>): value is T {
  return value instanceof (Type as unknown as abstract new () => unknown);
}

/** Follow an indirect reference (if any) without a type requirement. */
export function resolveAny(context: PDFContext, obj: PDFObject | undefined): PDFObject | undefined {
  try {
    return obj instanceof PDFRef ? context.lookup(obj) : obj;
  } catch {
    return undefined;
  }
}

/** Look up `key` in `dict`, resolving references; `undefined` unless the value is a `Type`. */
export function getAs<T>(dict: PDFDict, key: string, Type: Ctor<T>): T | undefined {
  let value: PDFObject | undefined;
  try {
    value = dict.lookup(PDFName.of(key));
  } catch {
    return undefined;
  }
  return isInstance(value, Type) ? value : undefined;
}

/** Look up `key` in `dict` with no type requirement, resolving references. */
export function getAny(dict: PDFDict, key: string): PDFObject | undefined {
  try {
    return dict.lookup(PDFName.of(key));
  } catch {
    return undefined;
  }
}

/** Decode a PDF name to text without the leading slash, decoding `#xx` escapes. */
export function decodeName(name: PDFName): string {
  const text = name.decodeText();
  return text.startsWith('/') ? text.slice(1) : text;
}

/** Text of a PDF string, hex string or name; `undefined` for anything else. */
export function textOf(obj: PDFObject | undefined): string | undefined {
  try {
    if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
    if (obj instanceof PDFName) return decodeName(obj);
  } catch {
    return undefined;
  }
  return undefined;
}

/** Look up a text value (string, hex string or name). */
export function getText(dict: PDFDict, key: string): string | undefined {
  return textOf(getAny(dict, key));
}

/** Look up a finite number. */
export function getNumber(dict: PDFDict, key: string): number | undefined {
  const n = getAs(dict, key, PDFNumber);
  if (!n) return undefined;
  const v = n.asNumber();
  return Number.isFinite(v) ? v : undefined;
}

/** Look up a field type name such as `Tx`, `Btn`, `Ch` or `Sig`. */
export function getNameText(dict: PDFDict, key: string): string | undefined {
  const n = getAs(dict, key, PDFName);
  return n ? decodeName(n) : undefined;
}

/** A rectangle with exactly four finite numbers, normalised so left<=right and bottom<=top. */
export interface PdfRect {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export function getRect(context: PDFContext, dict: PDFDict, key = 'Rect'): PdfRect | undefined {
  const arr = getAs(dict, key, PDFArray);
  if (!arr || arr.size() !== 4) return undefined;
  const nums: number[] = [];
  for (let i = 0; i < 4; i++) {
    const n = resolveAs(context, arr.get(i), PDFNumber);
    if (!n) return undefined;
    const v = n.asNumber();
    if (!Number.isFinite(v)) return undefined;
    nums.push(v);
  }
  const [x1, y1, x2, y2] = nums as [number, number, number, number];
  return {
    left: Math.min(x1, x2),
    bottom: Math.min(y1, y2),
    right: Math.max(x1, x2),
    top: Math.max(y1, y2),
  };
}

/** Byte length of a stream's raw contents, or `undefined` if it cannot be read. */
export function streamSize(stream: PDFStream): number | undefined {
  try {
    return stream.getContentsSize();
  } catch {
    return undefined;
  }
}
