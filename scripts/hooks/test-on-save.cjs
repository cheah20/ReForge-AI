/**
 * scripts/hooks/test-on-save.cjs
 *
 * PostFileSave hook: run only the unit tests related to the saved file.
 * - A saved test file (tests/unit/**, src/**\/*.test.ts) runs itself.
 * - A source file (.ts, .tsx, .cjs) runs the tests named after it or importing
 *   it, by relative path, @alias or require().
 * - A locale file (src/packs/language/locales/*.json) runs the tests that use
 *   the language registry or a locale file.
 * The run stops after TEST_TIMEOUT_MS so a hanging test cannot block the editor.
 *
 *   node scripts/hooks/test-on-save.cjs           (hook JSON on stdin)
 *   node scripts/hooks/test-on-save.cjs <file>    (manual run)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TEST_TIMEOUT_MS = 90_000;
const ALIASES = { '@shared/': 'src/shared/', '@packs/': 'src/packs/', '@lib/': 'src/lib/', '@worker/': 'src/worker/', '@frontend/': 'src/frontend/' };
const SOURCE_EXT = /\.(ts|tsx|cjs)$/;
const TEST_FILE = /\.test\.tsx?$/;
const LOCALE_FILE = /^src\/packs\/language\/locales\/[^/]+\.json$/;

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

/** Every unit test file: tests/unit/** and src/**\/*.test.ts(x). */
function listTests(root) {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (TEST_FILE.test(e.name)) out.push(full);
    }
  };
  walk(path.join(root, 'tests', 'unit'));
  walk(path.join(root, 'src'));
  return out;
}

function moduleId(rel) {
  return rel.replace(/\.(ts|tsx|js|cjs|mjs|json)$/, '');
}

/** Module specifiers a test file imports or requires. */
function importsOf(src) {
  return [
    ...[...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
    ...[...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ];
}

/** Unit test files related to `file` (absolute or relative to root). */
function relatedTests(file, root) {
  const abs = path.resolve(root, file);
  const rel = toPosix(path.relative(root, abs));
  if (rel.startsWith('..')) return [];
  if (TEST_FILE.test(rel) && (rel.startsWith('tests/unit/') || rel.startsWith('src/'))) return [abs];

  const tests = listTests(root);
  const resolvedImports = (testFile) => {
    const dir = path.dirname(testFile);
    return importsOf(fs.readFileSync(testFile, 'utf8')).map((spec) => {
      if (spec.startsWith('.')) return moduleId(toPosix(path.relative(root, path.resolve(dir, spec))));
      const alias = Object.keys(ALIASES).find((a) => spec.startsWith(a));
      return alias ? moduleId(ALIASES[alias] + spec.slice(alias.length)) : spec;
    });
  };

  if (LOCALE_FILE.test(rel)) {
    return tests.filter((t) =>
      resolvedImports(t).some((id) => id === 'src/packs/language/registry' || id.startsWith('src/packs/language/locales/')) ||
      /locale-sync/.test(fs.readFileSync(t, 'utf8')),
    );
  }

  if (!SOURCE_EXT.test(rel)) return [];
  const id = moduleId(rel);
  const base = path.basename(id);
  return tests.filter(
    (t) => path.basename(t).replace(TEST_FILE, '') === base || resolvedImports(t).includes(id),
  );
}

/** Saved file paths found in a hook payload. */
function savedFiles(event) {
  const found = new Set();
  (function walk(v) {
    if (typeof v === 'string') {
      if (SOURCE_EXT.test(v) || /\.json$/.test(v)) found.add(v);
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) walk(v[k]);
    }
  })(event);
  return [...found];
}

function runVitest(root, files, timeoutMs = TEST_TIMEOUT_MS) {
  const cli = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
  const r = spawnSync(process.execPath, [cli, 'run', '--reporter=verbose', ...files.map((f) => toPosix(path.relative(root, f)))], {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (r.error && /ETIMEDOUT/.test(String(r.error.code || r.error.message))) {
    console.error(`test-on-save: tests did not finish within ${timeoutMs / 1000} s and were stopped.`);
    return 1;
  }
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

module.exports = { relatedTests, savedFiles, runVitest, TEST_TIMEOUT_MS };

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
