/**
 * src/lib/accessforge/generation.ts
 *
 * accessforge-skeleton task 7.3 (design "Revival_Generation", Requirements
 * 3.9, 3.10). The Revival_Frame increments the generation whenever a new
 * document starts loading or loads. Every effect records the generation and
 * the document it started on; work whose stamp is no longer current is
 * dropped or refused.
 *
 * A Page_Version comparison cannot replace this: two loads of the
 * registration page carry the same Page_Version but are different documents.
 */

export interface FrameHandle {
  /** Revival_Generation of the current document. */
  readonly generation: number;
  readonly document: Document | null;
}

/** What an effect records when it starts. */
export interface GenerationStamp {
  readonly generation: number;
  readonly document: Document | null;
}

export const INITIAL_FRAME: FrameHandle = { generation: 0, document: null };

/** A new generation for a document that starts loading (`doc` null) or has loaded. */
export function nextGeneration(handle: FrameHandle, doc: Document | null): FrameHandle {
  return { generation: handle.generation + 1, document: doc };
}

/** The stamp an effect created now would carry. */
export function stampOf(handle: FrameHandle): GenerationStamp {
  return { generation: handle.generation, document: handle.document };
}

/**
 * True when work stamped with `stamp` may still touch the frame: the
 * generation has not moved, the stamp names a document, and that document is
 * both the handle's and the one the iframe shows right now (`liveDocument`,
 * the iframe's `contentDocument`). The last check catches a navigation in the
 * gap between the old document's unload and the next `load` event.
 */
export function isCurrent(handle: FrameHandle, stamp: GenerationStamp, liveDocument: Document | null): boolean {
  return (
    stamp.generation === handle.generation &&
    stamp.document !== null &&
    stamp.document === handle.document &&
    stamp.document === liveDocument
  );
}
