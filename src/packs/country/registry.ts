/**
 * src/packs/country/registry.ts
 *
 * Country pack registry. Adding a country: implement CountryPack in its own
 * module and add one entry to PACKS. Any other country uses the universal
 * fallback pack.
 */

import type { CountryPack } from './interface.js';
import { myPack } from './my.js';
import { universalPack } from './universal.js';
import { usPack } from './us.js';

const PACKS: ReadonlyMap<string, CountryPack> = new Map([myPack, usPack].map((p) => [p.code, p]));

/** ISO 3166-1 alpha-2 codes that have their own pack. */
export function registeredCountries(): string[] {
  return [...PACKS.keys()];
}

/**
 * The pack for an ISO 3166-1 alpha-2 code (case-insensitive), or the
 * universal fallback when the country has no pack of its own.
 */
export function getCountryPack(countryCode: string): CountryPack {
  return PACKS.get(countryCode.trim().toUpperCase()) ?? universalPack;
}
