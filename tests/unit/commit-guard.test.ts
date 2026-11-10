/**
 * tests/unit/commit-guard.test.ts
 *
 * The commit-guard hook must block staging of private files (local-* names,
 * anything under .local/) but must never block ordinary file writes,
 * including writes inside .local/.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';

const SCRIPT = path.resolve(__dirname, '../../scripts/commit-guard.cjs');

function run(command: string): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
  });
  return { status: r.status, stderr: r.stderr };
}

const PRIVATE_DIR = '.' + 'local';

describe('commit-guard', () => {
  it('blocks staging a file inside the private folder', () => {
    const r = run(`git add ${PRIVATE_DIR}/kiro-progress.md`);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('BLOCKED');
  });

  it('blocks staging a local-* file', () => {
    const r = run('git add .kiro/steering/local-rules.md');
    expect(r.status).toBe(2);
  });

  it('allows staging ordinary project files', () => {
    expect(run('git add src/lib/batch.ts docs/kiro-usage-log.md').status).toBe(0);
  });

  it('allows locale files (name contains "local" but is not local-*)', () => {
    expect(run('git add src/packs/language/locales/en.json').status).toBe(0);
  });

  it('allows writing files inside the private folder', () => {
    expect(run(`Set-Content ${PRIVATE_DIR}/kiro-progress.md "notes"`).status).toBe(0);
  });

  it('only inspects the git add segment of a chained command', () => {
    const cmd = `Get-Content ${PRIVATE_DIR}/notes.md; git add src/lib/batch.ts`;
    expect(run(cmd).status).toBe(0);
  });

  it('ignores commands unrelated to git', () => {
    expect(run('npx vitest run').status).toBe(0);
  });
});
