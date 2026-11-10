/**
 * scripts/spike-model-comparison.ts
 *
 * Spike 1 (task 13): compare the two candidate models on the real extracted
 * evidence of fixtures/clinic-registration.pdf, interface language zh-Hans,
 * with the production prompt and provider. Spends real neurons.
 *
 *   wrangler login
 *   npx tsx scripts/spike-model-comparison.ts [--runs 3] [--out <file>]
 *
 * Per run it records the first reply only (no retry), so validity is measured
 * honestly: parses as JSON, passes AnalyzeResponseSchema, field omissions,
 * latency, token counts and the neurons Workers AI reports in usage.neurons
 * (estimated from published rates only if a reply lacks it).
 * Raw replies (with the model's Chinese questions) go to --out, outside the repo
 * by default. Never commit them; only the summary goes into design.md.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getPlatformProxy } from 'wrangler';
import { CfWorkersAiProvider, GEMMA_MODEL, QWEN_MODEL, type AiBinding } from '../src/lib/ai/cf-workers.js';
import { extractFields } from '../src/lib/pdf-extract/index.js';
import { AnalyzeResponseSchema } from '../src/shared/schemas.js';
import { isCompatible } from '../src/lib/analysis/reconcile.js';

/** Neurons per million tokens, from the Workers AI pricing page (design.md, Neuron cost per batch). */
const RATES: Record<string, { input: number; output: number }> = {
  [GEMMA_MODEL]: { input: 9_091, output: 27_273 },
  [QWEN_MODEL]: { input: 40_909, output: 290_909 },
};

interface RunRecord {
  model: string;
  run: number;
  seed: number;
  ok: boolean;
  error?: string;
  schemaValid: boolean;
  fieldsSubmitted: number;
  fieldsReturned: number;
  omitted: string[];
  incompatibleTypes: number;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  neurons?: number;
  neuronsEstimated?: boolean;
  finishReason?: string;
  reply?: unknown;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function main() {
  const runs = Number(arg('--runs', '3'));
  const out = arg('--out', path.join(os.tmpdir(), `reforge-spike1-${Date.now()}.json`));

  const extracted = await extractFields(new Uint8Array(fs.readFileSync('fixtures/clinic-registration.pdf')));
  if (!extracted.ok) throw new Error(`fixture rejected: ${extracted.code}`);
  const request = { contentHash: extracted.fileHash, fields: extracted.fields, interfaceLanguage: 'zh-Hans' };
  const byType = new Map(extracted.fields.map((f) => [f.fieldId, f.fieldType]));

  const proxy = await getPlatformProxy<{ AI: AiBinding }>({ configPath: 'wrangler.jsonc', remoteBindings: true });
  const records: RunRecord[] = [];
  try {
    for (const model of [GEMMA_MODEL, QWEN_MODEL]) {
      for (let run = 1; run <= runs; run++) {
        const seed = 1000 + run;
        // Same provider code as production; the wrapper only adds a per-run seed.
        const binding: AiBinding = { run: (m, inputs) => proxy.env.AI.run(m, { ...inputs, seed }) };
        const provider = new CfWorkersAiProvider(binding, { model, timeoutMs: 120_000 });
        const started = Date.now();
        const rec: RunRecord = {
          model, run, seed, ok: false, schemaValid: false,
          fieldsSubmitted: request.fields.length, fieldsReturned: 0, omitted: [], incompatibleTypes: 0, latencyMs: 0,
        };
        try {
          const reply = await provider.analyze({ request, interfaceLanguageName: 'Simplified Chinese' });
          rec.ok = true;
          rec.latencyMs = reply.usage.durationMs;
          if (reply.usage.promptTokens !== undefined) rec.promptTokens = reply.usage.promptTokens;
          if (reply.usage.completionTokens !== undefined) rec.completionTokens = reply.usage.completionTokens;
          if (reply.usage.neurons !== undefined) rec.neurons = reply.usage.neurons;
          if (reply.usage.finishReason !== undefined) rec.finishReason = reply.usage.finishReason;
          rec.reply = reply.value;
          const parsed = AnalyzeResponseSchema.safeParse(reply.value);
          rec.schemaValid = parsed.success;
          if (parsed.success) {
            const ids = new Set(parsed.data.fields.map((f) => f.fieldId));
            rec.fieldsReturned = parsed.data.fields.length;
            rec.omitted = request.fields.map((f) => f.fieldId).filter((id) => !ids.has(id));
            rec.incompatibleTypes = parsed.data.fields.filter((f) => {
              const t = byType.get(f.fieldId);
              return t !== undefined && !isCompatible(t, f.answerType);
            }).length;
          }
        } catch (err) {
          rec.latencyMs = Date.now() - started;
          rec.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        }
        // Workers AI reports usage.neurons; the published-rate estimate is only a fallback.
        const rate = RATES[model];
        if (rec.neurons === undefined && rate && rec.promptTokens !== undefined && rec.completionTokens !== undefined) {
          rec.neurons = (rec.promptTokens * rate.input + rec.completionTokens * rate.output) / 1_000_000;
          rec.neuronsEstimated = true;
        }
        records.push(rec);
        console.log(
          [model.split('/').pop(), `run ${run}`, rec.ok ? 'reply' : `ERROR ${rec.error}`,
            `schema=${rec.schemaValid}`, `omitted=${rec.omitted.length}`, `incompatible=${rec.incompatibleTypes}`,
            `finish=${rec.finishReason ?? '?'}`, `${rec.latencyMs}ms`, `in=${rec.promptTokens ?? '?'}`, `out=${rec.completionTokens ?? '?'}`,
            `neurons=${rec.neurons?.toFixed(1) ?? '?'}`].join('  '),
        );
      }
    }
  } finally {
    await proxy.dispose();
  }

  fs.writeFileSync(out, JSON.stringify(records, null, 2));
  console.log(`raw results: ${out}`);
  const total = records.reduce((s, r) => s + (r.neurons ?? 0), 0);
  console.log(`total neurons (computed): ${total.toFixed(1)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
