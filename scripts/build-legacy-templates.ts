/**
 * scripts/build-legacy-templates.ts
 *
 * Generates and verifies the legacy portal templates (accessforge-skeleton
 * task 4.5) and writes the committed src/worker/legacy/generated/templates.ts.
 * Runs as `npm run build:legacy`, and before `npm run build` and `npm run dev`.
 * Exits non-zero, naming the template and the construct, when a template
 * contains anything unsafe.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateAll, renderModule, UnsafeTemplateError } from '../src/lib/legacy-build/generate.js';

const OUT = path.join(process.cwd(), 'src', 'worker', 'legacy', 'generated', 'templates.ts');

generateAll()
  .then((set) => {
    const source = renderModule(set);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const previous = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (previous !== source) fs.writeFileSync(OUT, source);
    console.log(`legacy templates: ${previous === source ? 'unchanged' : 'written'}; home ${set.versions.home.slice(0, 12)}, register ${set.versions.register.slice(0, 12)}`);
  })
  .catch((err: unknown) => {
    if (err instanceof UnsafeTemplateError) console.error(`legacy templates: ${err.message}`);
    else console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
