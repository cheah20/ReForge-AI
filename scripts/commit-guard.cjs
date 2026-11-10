/**
 * scripts/commit-guard.cjs
 *
 * Used by the commit-guard hook (PreToolUse on shell commands).
 * Writing files is always allowed, including inside .local/.
 * Only staging or committing is checked:
 *   - `git add` naming a local-* file or anything under .local/
 *   - `git add -A`, `git add .` or `git commit -a` are not inspected by name,
 *     so the staged list is checked at commit time instead
 *   - `git commit`: blocks if any staged path is a local-* file or under
 *     .local/, or if the staged diff contains a likely secret
 * Exit code 2 blocks the command and prints the reason on stderr.
 */
const { execSync } = require('child_process');

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  // Find the shell command text wherever the host puts it in the payload.
  const found = [];
  (function walk(v, key) {
    if (typeof v === 'string' && key === 'command') found.push(v);
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], k);
  })(event);
  const cmd = found.join('\n');

  const isAdd = /\bgit\s+(?:-C\s+\S+\s+)?add\b/.test(cmd);
  const isCommit = /\bgit\s+(?:-C\s+\S+\s+)?commit\b/.test(cmd);
  if (!isAdd && !isCommit) process.exit(0);

  const isPrivate = (p) => /(^|[\\/])local-[^\\/]*$/.test(p) || /(^|[\\/])\.local([\\/]|$)/.test(p);
  const block = (msg) => {
    process.stderr.write('BLOCKED: ' + msg + '\n');
    process.exit(2);
  };

  if (isAdd) {
    // Only inspect the arguments of each `git add` segment, not the whole command.
    const segments = cmd.split(/\r?\n|;|&&|\|\||\|/);
    const bad = [];
    for (const seg of segments) {
      const m = seg.match(/\bgit\s+(?:-C\s+\S+\s+)?add\b(.*)$/);
      if (!m) continue;
      const args = m[1].split(/\s+/).map((t) => t.replace(/^["']|["']$/g, ''));
      bad.push(...args.filter((t) => t && !t.startsWith('-') && isPrivate(t)));
    }
    if (bad.length) block('refusing to stage private path: ' + bad.join(', '));
  }

  if (isCommit) {
    let staged = [];
    let diff = '';
    try {
      staged = execSync('git diff --cached --name-only', { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
      diff = execSync('git diff --cached -U0', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch {
      process.exit(0);
    }
    const bad = staged.filter(isPrivate);
    if (bad.length) block('staged private files: ' + bad.join(', '));

    const added = diff.split(/\r?\n/).filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    const secret = [
      /CLOUDFLARE_API_TOKEN\s*=\s*[A-Za-z0-9_\-]{12,}/,
      /sk-[A-Za-z0-9]{20,}/,
      /Bearer\s+[A-Za-z0-9\-_.]{20,}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    for (const line of added) {
      if (secret.some((p) => p.test(line))) block('possible secret in staged changes');
    }
  }
  process.exit(0);
});
