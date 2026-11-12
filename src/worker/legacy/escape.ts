/**
 * src/worker/legacy/escape.ts
 *
 * accessforge-skeleton task 5.1. Every dynamic part of a legacy response goes
 * through this before it is joined into a template. Every slot sits in a text
 * position or a quoted attribute, so encoding & < > " ' is enough.
 */

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
