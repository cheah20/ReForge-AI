/**
 * tests/unit/commit-guard.test.ts
 *
 * Review item 15: the commit guard blocks forced adds, private pathspecs,
 * `commit -a` and commits with pathspecs; inspects the staged changes for
 * private files and secrets; fails closed when git cannot be inspected; and
 * never blocks ordinary file writes, even when their text mentions git.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync, execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const SCRIPT = path.resolve(__dirname, '../../scripts/commit-guard.cjs');
const PRIVATE_DIR = '.' + 'local';

function run(command: string, cwd?: string): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify({ tool_input: { command }, ...(cwd ? { cwd } : {}) }),
    encoding: 'utf8',
  });
  return { status: r.status, stderr: r.stderr };
}

/** A throwaway repository with files staged by the test itself (not through the guard). */
function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'guard-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
    execFileSync('git', ['add', '-f', '--', name], { cwd: dir });
  }
  return dir;
}

const repos: string[] = [];
let clean: string;
beforeAll(() => {
  clean = tempRepo({ 'src/a.ts': 'export const a = 1;\n' });
  repos.push(clean);
});
afterAll(() => {
  for (const r of repos) rmSync(r, { recursive: true, force: true });
});

describe('git add', () => {
  it('blocks staging a file inside the private folder', () => {
    expect(run(`git add ${PRIVATE_DIR}/kiro-progress.md`).status).toBe(2);
  });

  it('blocks staging a local-* file, with either slash style', () => {
    expect(run('git add .kiro/steering/local-rules.md').status).toBe(2);
    expect(run('git add .kiro\\steering\\local-rules.md').status).toBe(2);
  });

  it('blocks -f and --force, alone or in a cluster', () => {
    expect(run('git add -f src/a.ts').status).toBe(2);
    expect(run('git add --force src/a.ts').status).toBe(2);
    expect(run('git add -Af').status).toBe(2);
  });

  it('allows staging ordinary files, including locale files', () => {
    expect(run('git add src/lib/batch.ts docs/kiro-usage-log.md src/packs/language/locales/en.json').status).toBe(0);
  });

  it('checks git add after global options such as -C', () => {
    expect(run(`git -C some/dir add ${PRIVATE_DIR}/x.md`).status).toBe(2);
  });
});

describe('git commit', () => {
  it('blocks -a, --all and clusters such as -am', () => {
    expect(run('git commit -a -m "msg"', clean).status).toBe(2);
    expect(run('git commit --all -m "msg"', clean).status).toBe(2);
    expect(run('git commit -am "msg"', clean).status).toBe(2);
  });

  // Found when the guard blocked a real commit: `2>&1` was read as a pathspec.
  it('ignores shell redirections after a commit or add', () => {
    expect(run('git commit -m "msg" 2>&1', clean).status).toBe(0);
    expect(run('git commit -m "msg" > out.txt 2> err.txt', clean).status).toBe(0);
    expect(run('git add src/a.ts 2>&1').status).toBe(0);
    expect(run(`git add ${PRIVATE_DIR}/x.md 2>&1`).status).toBe(2);
  });

  it('blocks commits with pathspecs', () => {
    expect(run('git commit -m "msg" src/a.ts', clean).status).toBe(2);
    expect(run('git commit -m "msg" -- src/a.ts', clean).status).toBe(2);
  });

  it('allows a plain commit of clean staged changes, with a message that mentions -a', () => {
    expect(run('git commit -m "Add -a flag handling" -m "Second paragraph"', clean).status).toBe(0);
    expect(run('git commit --amend --no-edit', clean).status).toBe(0);
  });

  it('blocks when a private file is staged', () => {
    const repo = tempRepo({ [`${PRIVATE_DIR}/notes.md`]: 'private\n', 'ok.txt': 'ok\n' });
    repos.push(repo);
    const r = run('git commit -m "msg"', repo);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('staged private file');
  });

  it('blocks when the staged diff contains a likely secret', () => {
    const token = ['CLOUDFLARE_API_TOKEN', '=', 'abcdefghijklmnopqrstuvwxyz123456'].join('');
    const repo = tempRepo({ 'config.env.example': `${token}\n` });
    repos.push(repo);
    const r = run('git commit -m "msg"', repo);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('possible secret');
  });

  it('blocks non-Latin text in source and docs, but allows it in locale files, fixtures and tests', () => {
    const chinese = String.fromCodePoint(0x4e2d, 0x6587);
    const blocked = tempRepo({ 'src/app.ts': `// ${chinese}\n` });
    const allowed = tempRepo({
      'src/packs/language/locales/zh-Hans.json': `{"a": "${chinese}"}\n`,
      'tests/unit/x.test.ts': `const s = '${chinese}';\n`,
      'docs/notes.md': 'Plain English and Bahasa Melayu text.\n',
    });
    repos.push(blocked, allowed);
    const r = run('git commit -m "msg"', blocked);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('non-English text in src/app.ts');
    expect(run('git commit -m "msg"', allowed).status).toBe(0);
  });

  it('fails closed when git cannot inspect the staged changes', () => {
    const notRepo = mkdtempSync(path.join(tmpdir(), 'guard-norepo-'));
    repos.push(notRepo);
    const r = run('git commit -m "msg"', notRepo);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('could not inspect');
  });
});

describe('everything else is allowed', () => {
  it('allows writing files inside the private folder', () => {
    expect(run(`Set-Content ${PRIVATE_DIR}/kiro-progress.md "notes"`).status).toBe(0);
  });

  it('allows writes whose text mentions git add of a private path', () => {
    expect(run(`Set-Content notes.md "remember: git add ${PRIVATE_DIR}/x"`).status).toBe(0);
    expect(run(`echo 'git add ${PRIVATE_DIR}/x; git commit -a' > notes.txt`).status).toBe(0);
  });

  it('only inspects the git segments of a chained command', () => {
    expect(run(`Get-Content ${PRIVATE_DIR}/notes.md; git add src/lib/batch.ts`).status).toBe(0);
    expect(run(`npm test && git add ${PRIVATE_DIR}/x`).status).toBe(2);
  });

  it('ignores commands unrelated to git and non-JSON input', () => {
    expect(run('npx vitest run').status).toBe(0);
    const r = spawnSync(process.execPath, [SCRIPT], { input: 'not json', encoding: 'utf8' });
    expect(r.status).toBe(0);
  });
});
