/**
 * scripts/generate-fixture-cache.ts
 *
 * Precomputes real Workers AI analyses for the bundled fixtures, one file per
 * (fixture, core interface language), as
 *   src/worker/cache/precomputed/<sha256-of-pdf>-<bcp47>.json
 * The Worker serves these only when the live AI call fails with a quota, rate
 * limit or timeout error (requirement 12.7). Files are committed, never
 * regenerated at deploy time.
 *
 * How it runs: it calls POST /api/forms/analyze on a running Worker that uses
 * real AI. Start one first (this spends neurons):
 *   wrangler login
 *   npx vite --port 5173        # with AI_MODE=real, e.g. set in .dev.vars
 * then:
 *   npm run generate-fixture-cache -- clinic-registration
 *   npm run generate-fixture-cache -- us-community-clinic
 * Options: --base-url <url> (default http://localhost:5173), --languages ms,es
 *
 * Safety: a reply is only written when the Worker says it came from real AI
 * (x-reforge-ai-mode: real), was not itself served from a cache, passes
 * AnalyzeResponseSchema and covers every submitted field.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { extractFields } from '../src/lib/pdf-extract/index.js';
import { getCoreLanguages } from '../src/packs/language/registry.js';
import { AnalyzeResponseSchema } from '../src/shared/schemas.js';
import { cacheKey } from '../src/worker/cache/fixture-cache.js';

export const CACHE_DIR = path.join(process.cwd(), 'src', 'worker', 'cache', 'precomputed');
const MAX_FIELDS_PER_REQUEST = 30;

export interface GenerateOptions {
  baseUrl: string;
  /** Fixture names without extension. */
  fixtures: string[];
  /** Language tags; defaults to every core language. */
  languages?: string[];
  fetchFn?: typeof fetch;
  readFixture?: (name: string) => Uint8Array;
  writeFile?: (file: string, text: string) => void;
  log?: (line: string) => void;
}

export interface GenerateResult {
  written: string[];
  failed: Array<{ fixture: string; language: string; reason: string }>;
}

export async function generateFixtureCache(options: GenerateOptions): Promise<GenerateResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const readFixture = options.readFixture ?? ((n: string) => new Uint8Array(fs.readFileSync(path.join('fixtures', `${n}.pdf`))));
  const write =
    options.writeFile ??
    ((file: string, text: string) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    });
  const log = options.log ?? console.log;
  const languages = options.languages ?? getCoreLanguages().map((l) => l.tag);
  const result: GenerateResult = { written: [], failed: [] };

  for (const fixture of options.fixtures) {
    const extracted = await extractFields(readFixture(fixture));
    if (!extracted.ok) throw new Error(`${fixture}.pdf was rejected: ${extracted.code}`);
    if (extracted.fields.length > MAX_FIELDS_PER_REQUEST) {
      throw new Error(`${fixture}.pdf has ${extracted.fields.length} fields; the cache generator sends one request of at most ${MAX_FIELDS_PER_REQUEST}`);
    }

    for (const language of languages) {
      const fail = (reason: string) => {
        result.failed.push({ fixture, language, reason });
        log(`FAILED  ${fixture} ${language}: ${reason}`);
      };
      try {
        const res = await fetchFn(`${options.baseUrl.replace(/\/$/, '')}/api/forms/analyze`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contentHash: extracted.fileHash, fields: extracted.fields, interfaceLanguage: language }),
        });
        if (res.headers.get('x-reforge-ai-mode') !== 'real') {
          fail('the Worker answered with the mock provider; start it with AI_MODE=real');
          continue;
        }
        if (!res.ok) {
          fail(`HTTP ${res.status}`);
          continue;
        }
        const parsed = AnalyzeResponseSchema.safeParse(await res.json());
        if (!parsed.success) {
          fail('reply does not match AnalyzeResponseSchema');
          continue;
        }
        if (parsed.data.servedFromCache) {
          fail('reply was itself served from a cache');
          continue;
        }
        const answered = new Set(parsed.data.fields.map((f) => f.fieldId));
        const missing = extracted.fields.filter((f) => !answered.has(f.fieldId)).map((f) => f.fieldId);
        if (missing.length > 0) {
          fail(`reply omits ${missing.length} field(s): ${missing.slice(0, 3).join(', ')}`);
          continue;
        }
        const { servedFromCache: _ignored, ...stored } = parsed.data;
        const file = path.join(CACHE_DIR, `${cacheKey(extracted.fileHash, language)}.json`);
        write(file, `${JSON.stringify(stored, null, 2)}\n`);
        result.written.push(file);
        log(`wrote   ${fixture} ${language}`);
      } catch (err) {
        fail(err instanceof Error ? err.message.split('\n')[0]! : 'unknown error');
      }
    }
  }
  return result;
}

function parseArgs(argv: string[]) {
  const fixtures: string[] = [];
  let baseUrl = 'http://localhost:5173';
  let languages: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--base-url') baseUrl = argv[++i] ?? baseUrl;
    else if (a === '--languages') languages = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (!a.startsWith('--')) fixtures.push(a.replace(/\.pdf$/, ''));
  }
  return { fixtures, baseUrl, languages };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { fixtures, baseUrl, languages } = parseArgs(process.argv.slice(2));
  if (fixtures.length === 0) {
    console.error('Usage: npm run generate-fixture-cache -- <fixture-name>... [--base-url URL] [--languages ms,es]');
    process.exit(2);
  }
  generateFixtureCache({ baseUrl, fixtures, ...(languages ? { languages } : {}) })
    .then((r) => {
      console.log(`${r.written.length} written, ${r.failed.length} failed`);
      process.exitCode = r.failed.length > 0 ? 1 : 0;
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
