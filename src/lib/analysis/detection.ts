/**
 * src/lib/analysis/detection.ts
 *
 * Combining the detected form language and country across analysis batches
 * (design: Multi-Batch Result Aggregation). Pure, shared by the browser
 * session state and the label analysis runner.
 */

import { LOW_CONFIDENCE_THRESHOLD } from './reconcile.js';

export interface Vote {
  value: string;
  confidence: number;
}

/** Largest two-decimal value below the 0.7 threshold. */
const BELOW_THRESHOLD = 0.69;

/**
 * Confidence-weighted vote. The winner is the value with the largest summed
 * confidence (first seen wins a tie). Its final confidence is the average over
 * all batches, counting 0 for batches that voted for something else. When a
 * batch disagrees with confidence 0.7 or more, the result is held below the
 * threshold so the user confirms (requirement 5.3).
 */
export function combineVotes(votes: readonly Vote[]): Vote {
  if (votes.length === 0) return { value: '', confidence: 0 };
  const sums = new Map<string, number>();
  for (const v of votes) sums.set(v.value, (sums.get(v.value) ?? 0) + v.confidence);
  let winner = votes[0]!.value;
  for (const [value, sum] of sums) if (sum > sums.get(winner)!) winner = value;

  let confidence = sums.get(winner)! / votes.length;
  const confidentDissent = votes.some((v) => v.value !== winner && v.confidence >= LOW_CONFIDENCE_THRESHOLD);
  if (confidentDissent) confidence = Math.min(confidence, BELOW_THRESHOLD);
  return { value: winner, confidence };
}
