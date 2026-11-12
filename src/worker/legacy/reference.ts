/**
 * src/worker/legacy/reference.ts
 *
 * accessforge-skeleton task 5.4: SR-DEMO-YYYYMMDD-NNNNNN from the UTC date and
 * injected random digits. No submitted value is an input (Requirement 2.9).
 */

export function newReferenceNumber(now: Date, randomDigits: () => string): string {
  const digits = randomDigits();
  if (!/^\d{6}$/.test(digits)) throw new Error('randomDigits must return exactly six digits');
  const ymd = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `SR-DEMO-${ymd}-${digits}`;
}

/** Six digits from crypto.getRandomValues, without modulo bias. */
export function cryptoDigits(): string {
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0]!;
  } while (n >= 4_294_000_000); // largest multiple of 1,000,000 below 2^32
  return String(n % 1_000_000).padStart(6, '0');
}
