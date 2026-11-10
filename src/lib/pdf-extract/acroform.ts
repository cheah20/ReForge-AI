/**
 * src/lib/pdf-extract/acroform.ts
 *
 * AcroForm traversal and field evidence extraction.
 *
 * Extracts fully-qualified field names, field types, options (with export/display
 * pairs), required/readOnly flags, maxLength, multiline, widget bboxes, and
 * hasValue for signature fields.
 *
 * Per decisions in 00-decisions.md:
 * - Decision 8:  Single-select list boxes → answerType dropdown, preserve PDF widget type
 * - Decision 13: Use low-level APIs for /Opt export/display pairs; always read export values
 * - Decision 14: Use high-level typed getters where available; fall back to raw dict
 * - Decision 18: Never forward /V, /DV, selected indices, widget answer state
 */

import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFRef,
  PDFString,
  PDFHexString,
  PDFNumber,
  PDFBool,
} from 'pdf-lib';
import type { FieldEvidence, FieldOption, Widget } from '../../shared/types.js';

/** Resolve a potentially indirect PDFObject to a PDFDict, or undefined */
function resolveDict(
  pdfDoc: PDFDocument,
  obj: unknown,
): PDFDict | undefined {
  if (obj instanceof PDFRef) {
    const resolved = pdfDoc.context.lookupMaybe(obj, PDFDict);
    return resolved instanceof PDFDict ? resolved : undefined;
  }
  if (obj instanceof PDFDict) return obj;
  return undefined;
}

/** Decode a PDFString or PDFHexString to a JS string */
function decodeString(obj: unknown): string | undefined {
  if (obj instanceof PDFString) return obj.decodeText();
  if (obj instanceof PDFHexString) return obj.decodeText();
  return undefined;
}

/** Extract text value from a PDFName (strip leading /) */
function nameString(obj: unknown): string | undefined {
  if (obj instanceof PDFName) return obj.asString().replace(/^\//, "");
  return undefined;
}

/**
 * Collect all terminal field dicts with their fully-qualified names.
 * Also resolves inherited attributes (/FT, /Ff, /DA).
 */
interface TerminalFieldInfo {
  dict: PDFDict;
  fullyQualifiedName: string;
  /** Inherited field type PDFName (e.g. 'Tx', 'Btn', 'Ch', 'Sig') */
  ft: string;
  /** Inherited Ff integer (field flags) */
  ff: number;
  /** All widget annotation dicts for this field */
  widgets: { dict: PDFDict; ref: PDFRef }[];
}

function collectTerminals(
  pdfDoc: PDFDocument,
  fieldsArray: PDFArray,
  parentName: string,
  inheritedFt: string | undefined,
  inheritedFf: number,
  result: TerminalFieldInfo[],
): void {
  for (let i = 0; i < fieldsArray.size(); i++) {
    const item = fieldsArray.get(i);
    let ref: PDFRef | undefined;
    let fieldDict: PDFDict | undefined;

    if (item instanceof PDFRef) {
      ref = item;
      fieldDict = resolveDict(pdfDoc, item);
    } else if (item instanceof PDFDict) {
      fieldDict = item;
    }
    if (!fieldDict) continue;

    // Local /T is the partial name component
    const tObj = fieldDict.lookup(PDFName.of('T'));
    const partialName = decodeString(tObj) ?? '';

    const qualifiedName = parentName
      ? partialName
        ? `${parentName}.${partialName}`
        : parentName
      : partialName;

    // Resolve /FT — may be inherited from parent
    const ftObj = fieldDict.lookup(PDFName.of('FT'));
    const localFt = nameString(ftObj) ?? inheritedFt;

    // Resolve /Ff — may be inherited
    const ffObj = fieldDict.lookup(PDFName.of('Ff'));
    const localFf =
      ffObj instanceof PDFNumber ? ffObj.asNumber() : inheritedFf;

    // Check /Kids
    const kidsObj = fieldDict.lookupMaybe(PDFName.of('Kids'), PDFArray);

    if (kidsObj instanceof PDFArray && kidsObj.size() > 0) {
      // Check if children are widgets or sub-fields
      const firstKid = kidsObj.get(0);
      const firstKidDict = resolveDict(pdfDoc, firstKid);
      const isRadioOrCheckbox = localFt === 'Btn' && (localFf & 32768) !== 0;

      if (firstKidDict && isRadioOrCheckbox) {
        // Radio group: parent is the terminal field, kids are widget annotations
        const widgetDicts: { dict: PDFDict; ref: PDFRef }[] = [];
        for (let k = 0; k < kidsObj.size(); k++) {
          const kItem = kidsObj.get(k);
          const kRef = kItem instanceof PDFRef ? kItem : undefined;
          const kDict = resolveDict(pdfDoc, kItem);
          if (kDict && kRef) {
            widgetDicts.push({ dict: kDict, ref: kRef });
          }
        }
        if (localFt) {
          result.push({
            dict: fieldDict,
            fullyQualifiedName: qualifiedName,
            ft: localFt,
            ff: localFf,
            widgets: widgetDicts,
          });
        }
      } else {
        // Sub-fields: recurse
        collectTerminals(pdfDoc, kidsObj, qualifiedName, localFt, localFf, result);
      }
    } else if (localFt) {
      // Terminal field — the dict itself is both field and widget annotation
      const widgetRef = ref ?? (fieldDict ? undefined : undefined);
      result.push({
        dict: fieldDict,
        fullyQualifiedName: qualifiedName,
        ft: localFt,
        ff: localFf,
        widgets: ref ? [{ dict: fieldDict, ref }] : [],
      });
    }
  }
}

/** Extract /Opt entries as export/display pairs */
function extractOptions(
  pdfDoc: PDFDocument,
  fieldDict: PDFDict,
): FieldOption[] {
  const optObj = fieldDict.lookupMaybe(PDFName.of('Opt'), PDFArray);
  if (!(optObj instanceof PDFArray)) return [];

  const options: FieldOption[] = [];
  for (let i = 0; i < optObj.size(); i++) {
    const entry = optObj.get(i);
    const entryResolved =
      entry instanceof PDFRef ? pdfDoc.context.lookup(entry) : entry;

    if (entryResolved instanceof PDFArray && entryResolved.size() >= 2) {
      // [exportValue, displayLabel] pair
      const exportVal = decodeString(entryResolved.get(0));
      const displayLabel = decodeString(entryResolved.get(1));
      if (exportVal !== undefined && displayLabel !== undefined) {
        options.push({ exportValue: exportVal, displayLabel });
      } else if (exportVal !== undefined) {
        options.push({ exportValue: exportVal, displayLabel: exportVal });
      }
    } else {
      // Simple string — export value = display label
      const val = decodeString(entryResolved);
      if (val !== undefined) {
        options.push({ exportValue: val, displayLabel: val });
      }
    }
  }
  return options;
}

/** Extract radio on-state values from widget /AP dicts */
function extractRadioOptions(
  pdfDoc: PDFDocument,
  widgets: { dict: PDFDict; ref: PDFRef }[],
): FieldOption[] {
  const options: FieldOption[] = [];
  const seen = new Set<string>();

  for (const { dict: widgetDict } of widgets) {
    // Check /AP/N for export values
    const apObj = widgetDict.lookupMaybe(PDFName.of('AP'), PDFDict);
    if (apObj instanceof PDFDict) {
      const normalAp = resolveDict(pdfDoc, apObj.lookup(PDFName.of('N')));
      if (normalAp instanceof PDFDict) {
        for (const key of normalAp.keys()) {
          const keyStr = key.asString().replace(/^\//, "");
          if (keyStr !== 'Off' && !seen.has(keyStr)) {
            seen.add(keyStr);
            options.push({ exportValue: keyStr, displayLabel: keyStr });
          }
        }
      }
    }
  }
  return options;
}

/** Map pdf-lib field type string to our FieldEvidence fieldType */
function mapFieldType(ft: string, ff: number): FieldEvidence['fieldType'] {
  switch (ft) {
    case 'Tx':
      return 'text';
    case 'Btn':
      // Radio: Ff bit 15 (32768) set; Pushbutton: bit 16 (65536) set
      if ((ff & 32768) !== 0) return 'radio';
      return 'checkbox';
    case 'Ch':
      return 'dropdown'; // Both Combo and ListBox map to dropdown (decision 8)
    case 'Sig':
      return 'signature';
    default:
      return 'text';
  }
}

/** Extract widget bounding boxes (top-origin coordinates) */
function extractWidgetBbox(
  pdfDoc: PDFDocument,
  widgetDict: PDFDict,
  pageIndex: number,
): Widget['bbox'] {
  const rectObj = widgetDict.lookupMaybe(PDFName.of('Rect'), PDFArray);
  if (!(rectObj instanceof PDFArray) || rectObj.size() < 4) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }

  const page = pdfDoc.getPage(pageIndex);
  const pageH = page.getHeight();

  const left = (rectObj.get(0) as PDFNumber).asNumber();
  const pdfBottom = (rectObj.get(1) as PDFNumber).asNumber();
  const right = (rectObj.get(2) as PDFNumber).asNumber();
  const pdfTop = (rectObj.get(3) as PDFNumber).asNumber();

  // Convert from PDF bottom-origin to top-origin
  return {
    left,
    top: pageH - pdfTop,
    right,
    bottom: pageH - pdfBottom,
  };
}

/** Find which page a widget annotation belongs to */
function findPageIndex(
  pdfDoc: PDFDocument,
  widgetRef: PDFRef | undefined,
): number {
  if (!widgetRef) return 0;
  for (let p = 0; p < pdfDoc.getPageCount(); p++) {
    const page = pdfDoc.getPage(p);
    const annotsArray = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!(annotsArray instanceof PDFArray)) continue;
    for (let j = 0; j < annotsArray.size(); j++) {
      const annot = annotsArray.get(j);
      if (annot instanceof PDFRef && annot.objectNumber === widgetRef.objectNumber) {
        return p;
      }
    }
  }
  return 0;
}

/**
 * Check whether a signature field's /V is populated.
 * Structural detection only — no cryptographic validation.
 */
function isSigPopulated(fieldDict: PDFDict): boolean {
  // lookup() resolves indirect references, so /V may be a ref to the signature dict
  const v = fieldDict.lookup(PDFName.of('V'));
  if (v instanceof PDFDict) {
    return (
      v.lookup(PDFName.of('Filter')) !== undefined ||
      v.lookup(PDFName.of('Contents')) !== undefined
    );
  }
  return false;
}
/**
 * Extract all terminal fields from an already-loaded PDFDocument.
 * Requires that the document has passed rejection checks (not encrypted, not XFA, etc.)
 *
 * Per decision 18: Never forward /V, /DV, selected indices, or widget answer state.
 */
export function extractAcroFormFields(pdfDoc: PDFDocument): FieldEvidence[] {
  const catalogDict = pdfDoc.catalog;
  const acroFormRef = catalogDict.lookup(PDFName.of('AcroForm'));
  const acroFormDict = resolveDict(pdfDoc, acroFormRef);
  if (!acroFormDict) return [];

  const fieldsVal = acroFormDict.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!(fieldsVal instanceof PDFArray)) return [];

  const terminals: TerminalFieldInfo[] = [];
  collectTerminals(pdfDoc, fieldsVal, '', undefined, 0, terminals);

  const result: FieldEvidence[] = [];

  for (const { dict, fullyQualifiedName, ft, ff, widgets } of terminals) {
    if (!fullyQualifiedName) continue; // skip unnamed fields

    const fieldType = mapFieldType(ft, ff);

    // Required: Ff bit 1 (value 2)
    const required = (ff & 2) !== 0;
    // ReadOnly: Ff bit 0 (value 1)
    const readOnly = (ff & 1) !== 0;

    // /TU — tooltip
    const tuObj = dict.lookup(PDFName.of('TU'));
    const tooltip = decodeString(tuObj);

    // /MaxLen
    const maxLenObj = dict.lookupMaybe(PDFName.of('MaxLen'), PDFNumber);
    const maxLength =
      maxLenObj instanceof PDFNumber ? maxLenObj.asNumber() : undefined;

    // Multiline: Ff bit 12 (value 4096)
    const multiline = fieldType === 'text' ? (ff & 4096) !== 0 : undefined;

    // Options (do NOT include current /V)
    let options: FieldOption[] | undefined;
    if (fieldType === 'dropdown') {
      const opts = extractOptions(pdfDoc, dict);
      options = opts.length > 0 ? opts : undefined;
    } else if (fieldType === 'radio') {
      const opts = extractRadioOptions(pdfDoc, widgets);
      options = opts.length > 0 ? opts : undefined;
    }

    // hasValue: for signature fields, structural check only
    const hasValue = fieldType === 'signature' ? isSigPopulated(dict) : false;

    // Build widget list — one per widget annotation
    const widgetList: Widget[] = [];
    for (const { dict: wDict, ref: wRef } of widgets) {
      const pageIndex = findPageIndex(pdfDoc, wRef);
      const bbox = extractWidgetBbox(pdfDoc, wDict, pageIndex);
      widgetList.push({
        pageNumber: pageIndex + 1,
        bbox,
        pageSnippet: '', // filled in by page-text.ts
      });
    }

    // For single-widget fields, use the field dict's own /Rect
    if (widgetList.length === 0) {
      const pageIndex = 0;
      const rectObj = dict.lookupMaybe(PDFName.of('Rect'), PDFArray);
      if (rectObj instanceof PDFArray && rectObj.size() >= 4) {
        const bbox = extractWidgetBbox(pdfDoc, dict, pageIndex);
        widgetList.push({
          pageNumber: pageIndex + 1,
          bbox,
          pageSnippet: '',
        });
      }
    }

    if (widgetList.length === 0) continue; // skip fields with no locatable widget

    const evidence: FieldEvidence = {
      fieldId: fullyQualifiedName,
      fieldType,
      required,
      readOnly,
      hasValue,
      widgets: widgetList,
    };

    if (tooltip !== undefined) evidence.tooltip = tooltip.substring(0, 200);
    if (maxLength !== undefined) evidence.maxLength = maxLength;
    if (multiline !== undefined && multiline) evidence.multiline = multiline;
    if (options !== undefined && options.length > 0) evidence.options = options.slice(0, 50);

    result.push(evidence);
  }

  return result;
}
