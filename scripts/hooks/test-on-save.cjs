/**
 * scripts/hooks/test-on-save.cjs
 *
 * PostFileSave hook: run only the unit tests related to the saved file.
 * A test file is related when it is the saved file itself, is named after it
 * (<name>.test.ts), or imports it (by relative path or by @alias path).
 *
 *   node scripts/hooks/test-on-save.cjs           (hook JSON on stdin)
 *   node scripts/hooks/test-on-save.cjs <file>    (manual run)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ALIASES = { '@shared/': 'src/shared/', '@packs/': 'src/packs/', '@lib/': 'src/lib/', '@worker/': 'src/worker/', '@frontend/': 'src/frontend/' };

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function listTests(root) {
  const dir = path.join(root, 'tests', 'unit');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.test\.tsx?$/.test(e.name)) out.push(full);
    }
  })(dir);
  return out;
}

/** Module id of a source file without extension, e.g. "src/lib/pdf-extract/rejection". */
function moduleId(rel) {
  return rel.replace(/\.(ts|tsx|js|cjs|mjs)$/, '');
}

/** Unit test files related to `file` (absolute or relative to root). */
function relatedTests(file, root) {
  const abs = path.resolve(root, file);
  const rel = toPosix(path.relative(root, abs));
  if (rel.startsWith('..')) return [];
  if (/^tests\/unit\/.*\.test\.tsx?$/.test(rel)) return [abs];

  const id = moduleId(rel);
  const base = path.basename(id);
  const aliasIds = Object.entries(ALIASES)
    .filter(([, target]) => id.startsWith(target))
    .map(([alias, target]) => alias + id.slice(target.length));

  return listTests(root).filter((testFile) => {
    if (path.basename(testFile).replace(/\.test\.tsx?$/, '') === base) return true;
    const src = fs.readFileSync(testFile, 'utf8');
    const testDir = path.dirname(testFile);
    // Relative imports in the test, resolved to repo-relative module ids.
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    return imports.some((spec) => {
      if (aliasIds.some((a) => spec === a || spec === `${a}.js`)) return true;
      if (!spec.startsWith('.')) return false;
      const resolved = toPosix(path.relative(root, path.resolve(testDir, spec)));
      return moduleId(resolved) === id;
    });
  });
}

/** Saved file paths found in a hook payload. */
function savedFiles(event) {
  const found = new Set();
  (function walk(v) {
    if (typeof v === 'string') {
      if (/\.(ts|tsx)$/.test(v)) found.add(v);
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) walk(v[k]);
    }
  })(event);
  return [...found];
}

function runVitest(root, files) {
  const cli = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
  const r = spawnSync(process.execPath, [cli, 'run', '--reporter=verbose', ...files.map((f) => toPosix(path.relative(root, f)))], {
    cwd: root,
    encoding: 'utf8',
  });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  return r.status ?? 1;
}

function main(files) {
  const root = process.cwd();
  const tests = [...new Set(files.flatMap((f) => relatedTests(f, root)))];
  if (tests.length === 0) {
    console.log(`test-on-save: no related unit tests for ${files.join(', ') || '(no file)'}`);
    return 0;
  }
  console.log(`test-on-save: running ${tests.map((t) => path.basename(t)).join(', ')}`);
  return runVitest(root, tests);
}

module.exports = { relatedTests, savedFiles };

if (require.main === module) {
  if (process.argv.length > 2) {
    process.exitCode = main(process.argv.slice(2));
  } else {
    let raw = '';
    process.stdin.on('data', (d) => (raw += d));
    process.stdin.on('end', () => {
      let event = {};
      try {
        event = JSON.parse(raw);
      } catch {
        // no payload
      }
      process.exitCode = main(savedFiles(event));
    });
  }
}
