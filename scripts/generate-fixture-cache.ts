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
 * --pages (accessforge-skeleton task 20.1) does the same for the AccessForge registration page:
 *   npm run generate-fixture-cache -- --pages [--languages en,zh-Hans]
 * It writes src/worker/cache/precomputed/pages/<pageVersion>-<bcp47>.json, only for replies that
 * come from real AI (analysisMode live), pass PageAnalyzeResponseSchema and the Plan_Validator, and
 * map every field. Any failing key writes nothing and the script exits non-zero.
 *
 * Safety: a reply is only written when the Worker says it came from real AI
 * (x-reforge-ai-mode: real), was not itself served from a cache, passes
 * AnalyzeResponseSchema and covers every submitted field.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { JSDOM } from 'jsdom';
import { extractPageModel } from '../src/lib/accessforge/extract.js';
import { validatePlan } from '../src/lib/accessforge/plan-validator.js';
import { extractFields } from '../src/lib/pdf-extract/index.js';
import { PageAnalyzeResponseSchema, PrecomputedPagePlanSchema } from '../src/shared/page-schemas.js';
import { PAGE_VERSIONS, TEMPLATES } from '../src/worker/legacy/generated/templates.js';
import { fill } from '../src/worker/legacy/render.js';
import { getCoreLanguages } from '../src/packs/language/registry.js';
import { AnalyzeResponseSchema } from '../src/shared/schemas.js';
// Not fixture-cache.ts: that module uses Vite's import.meta.glob, which plain Node cannot run.
import { cacheKey } from '../src/worker/cache/cache-key.js';

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

// ---------------------------------------------------------------------------
// AccessForge page plans (accessforge-skeleton task 20.1)
// ---------------------------------------------------------------------------

export const PAGE_CACHE_DIR = path.join(CACHE_DIR, 'pages');
/** Slice 1 saves plans for these interface languages. */
export const PAGE_PLAN_LANGUAGES = ['en', 'zh-Hans'];

export interface GeneratePagesOptions {
  baseUrl: string;
  languages?: string[];
  fetchFn?: typeof fetch;
  writeFile?: (file: string, text: string) => void;
  log?: (line: string) => void;
}

export interface GeneratePagesResult {
  written: string[];
  failed: Array<{ language: string; reason: string }>;
}

export async function generatePagePlans(options: GeneratePagesOptions): Promise<GeneratePagesResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const write =
    options.writeFile ??
    ((file: string, text: string) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    });
  const log = options.log ?? console.log;
  const result: GeneratePagesResult = { written: [], failed: [] };

  // The same extractor the browser uses, on the same generated registration page.
  const doc = new JSDOM(fill(TEMPLATES.register, {})).window.document;
  const extracted = extractPageModel(doc as unknown as Document, PAGE_VERSIONS.register);
  if (!extracted.ok) throw new Error(`the registration page could not be read: ${extracted.code}`);
  const model = extracted.model;
  const fieldIds = model.entries.filter((e) => e.control !== 'submit' && e.control !== 'reset').map((e) => e.elementId);

  for (const language of options.languages ?? PAGE_PLAN_LANGUAGES) {
    const fail = (reason: string) => {
      result.failed.push({ language, reason });
      log(`FAILED  page plan ${language}: ${reason}`);
    };
    try {
      const res = await fetchFn(`${options.baseUrl.replace(/\/$/, '')}/api/pages/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageModel: model, interfaceLanguage: language }),
      });
      if (res.headers.get('x-reforge-ai-mode') !== 'real') {
        fail('the Worker answered with the mock provider; start it with AI_MODE=real');
        continue;
      }
      if (!res.ok) {
        fail(`HTTP ${res.status}`);
        continue;
      }
      const parsed = PageAnalyzeResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        fail('reply does not match PageAnalyzeResponseSchema');
        continue;
      }
      if (parsed.data.analysisMode !== 'live') {
        fail(`analysis mode was ${parsed.data.analysisMode}, not live`);
        continue;
      }
      // Validate again here: the saved file must pass the Plan_Validator on its own.
      const plan = validatePlan(model, parsed.data.entries);
      const missing = fieldIds.filter((id) => !plan.mapped.has(id));
      if (missing.length > 0) {
        fail(`plan leaves ${missing.length} field(s) unmapped: ${missing.slice(0, 3).join(', ')}`);
        continue;
      }
      const stored = PrecomputedPagePlanSchema.parse({ pageVersion: model.pageVersion, interfaceLanguage: language, entries: model.entries.flatMap((e) => plan.mapped.get(e.elementId) ?? []) });
      const file = path.join(PAGE_CACHE_DIR, `${model.pageVersion}-${language}.json`);
      write(file, `${JSON.stringify(stored, null, 2)}\n`);
      result.written.push(file);
      log(`wrote   page plan ${language}`);
    } catch (err) {
      fail(err instanceof Error ? err.message.split('\n')[0]! : 'unknown error');
    }
  }
  return result;
}
function parseArgs(argv: string[]) {
  const fixtures: string[] = [];
  let pages = false;
  let baseUrl = 'http://localhost:5173';
  let languages: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--pages') pages = true;
    else if (a === '--base-url') baseUrl = argv[++i] ?? baseUrl;
    else if (a === '--languages') languages = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (!a.startsWith('--')) fixtures.push(a.replace(/\.pdf$/, ''));
  }
  return { fixtures, baseUrl, languages, pages };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { fixtures, baseUrl, languages, pages } = parseArgs(process.argv.slice(2));
  if (pages) {
    generatePagePlans({ baseUrl, ...(languages ? { languages } : {}) })
      .then((r) => {
        console.log(`${r.written.length} written, ${r.failed.length} failed`);
        process.exitCode = r.failed.length > 0 ? 1 : 0;
      })
      .catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
      });
  } else if (fixtures.length === 0) {
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
