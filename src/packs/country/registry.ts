/**
 * src/packs/country/registry.ts
 *
 * Country pack registry.
 * Adding a country: implement CountryPack + add one entry here.
 */

import type { CountryPack } from './interface.js';
import { universalPack } from './universal.js';

/** All registered country packs. Universal is the fallback and is not listed here. */
const registry = new Map<string, CountryPack>();

/**
 * Register a country pack. Called by each pack module at import time.
 * @param pack - CountryPack implementation
 */
export function registerCountryPack(pack: CountryPack): void {
  registry.set(pack.code.toUpperCase(), pack);
}

/**
 * Look up a country pack by ISO 3166-1 alpha-2 code.
 * Returns the universal fallback pack if no specific pack is registered.
 */
export function getCountryPack(countryCode: string): CountryPack {
  return registry.get(countryCode.toUpperCase()) ?? universalPack;
}
