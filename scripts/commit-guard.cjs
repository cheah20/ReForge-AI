/**
 * scripts/commit-guard.cjs
 *
 * PreToolUse guard for shell commands. It is deliberately simple, not a git parser:
 *
 *   git add     blocked with -f / --force, or with any pathspec that is a private
 *               path (a local-* file name or anything under .local/)
 *   git commit  blocked with -a / --all or with pathspecs (always stage first,
 *               then `git commit -m`); otherwise the staged changes are inspected
 *               and the commit is blocked if they include a private path or a
 *               likely secret. If git cannot be inspected, the commit is blocked.
 *
 * Only command segments whose first word is `git` are checked. Ordinary file
 * writes are never blocked, even when the text being written mentions git.
 *
 * Exit 2 blocks the command (reason on stderr). Exit 0 allows it.
 * Usage: node scripts/commit-guard.cjs  (hook JSON on stdin)
 */
'use strict';

const { execFileSync } = require('child_process');

const SECRET_PATTERNS = [
  /CLOUDFLARE_API_TOKEN\s*[=:]\s*["']?[A-Za-z0-9_\-]{20,}/,
  /\bsk-[A-Za-z0-9]{20,}/,
  /Bearer\s+[A-Za-z0-9\-_.]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

/**
 * Non-Latin scripts (Tamil, Devanagari, Bengali, Thai, Myanmar, Arabic, Hangul,
 * kana and CJK). Latin-script languages such as Malay cannot be told apart from
 * English this way, so they are not detected.
 */
const NON_LATIN = /[\u0600-\u06FF\u0900-\u0DFF\u0E00-\u0E7F\u1000-\u109F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;

/** Paths where product-language text is allowed (review 1 answers). */
function allowsNonEnglish(p) {
  const norm = String(p).replace(/\\/g, '/');
  return (
    norm.startsWith('src/packs/language/locales/') ||
    norm.startsWith('fixtures/') ||
    norm.startsWith('scripts/create-fixtures/') ||
    norm.startsWith('tests/')
  );
}

/** A private path: a file named local-* or anything inside a .local folder. */
function isPrivate(p) {
  const norm = String(p).replace(/\\/g, '/').replace(/^["']|["']$/g, '');
  return /(^|\/)local-[^/]*$/.test(norm) || /(^|\/)\.local(\/|$)/.test(norm);
}

/**
 * Split a shell command into segments of words. Quotes group words; the
 * separators ; && || | and newlines end a segment when they are not quoted.
 */
function segments(command) {
  const out = [];
  let words = [];
  let word = '';
  let inWord = false;
  let quote = null;
  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inWord = true;
      continue;
    }
    if (ch === '\n' || ch === '\r' || ch === ';' || ch === '|' || (ch === '&' && command[i + 1] === '&')) {
      if (ch === '&' || (ch === '|' && command[i + 1] === '|')) i++;
      endSegment();
      continue;
    }
    if (/\s/.test(ch)) {
      endWord();
      continue;
    }
    word += ch;
    inWord = true;
  }
  endSegment();
  return out;
}

/**
 * Remove shell redirections (2>&1, >out.txt, > out.txt, 2> err, <in) so they
 * are not mistaken for git arguments.
 */
function stripRedirections(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^\d*[<>]{1,2}(&\d+)?$/.test(w)) {
      if (!/&\d+$/.test(w)) i++; // bare operator: the next word is its target
      continue;
    }
    if (/^\d*[<>]{1,2}\S/.test(w)) continue; // operator joined to its target
    out.push(w);
  }
  return out;
}

/** For a `git ...` segment, return { sub, args } after git's global options. */
function gitInvocation(rawWords) {
  const words = stripRedirections(rawWords);
  if (!words.length || !/^git(\.exe)?$/i.test(words[0])) return null;
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) {
    if (words[i] === '-C' || words[i] === '-c' || words[i] === '--git-dir' || words[i] === '--work-tree') i += 2;
    else i += 1;
  }
  if (i >= words.length) return null;
  return { sub: words[i], args: words.slice(i + 1) };
}

/** git commit options that take a separate value argument. */
const COMMIT_VALUE_OPTIONS = new Set([
  '-m', '--message', '-F', '--file', '-C', '--reuse-message', '-c', '--reedit-message',
  '--author', '--date', '--cleanup', '--fixup', '--squash', '-t', '--template', '--trailer',
]);

function checkAdd(args) {
  const problems = [];
  for (const a of args) {
    if (a === '--force' || /^-[A-Za-z]*f[A-Za-z]*$/.test(a)) problems.push(`forced add (${a})`);
    else if (!a.startsWith('-') && isPrivate(a)) problems.push(`private path ${a}`);
  }
  return problems;
}

function checkCommitArgs(args) {
  const problems = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      if (i + 1 < args.length) problems.push('commit with pathspecs');
      break;
    }
    // --all, or a short flag cluster containing a: -a, -am, -sa ...
    if (a === '--all' || (!a.startsWith('--') && /^-[A-Za-z]*a[A-Za-z]*$/.test(a))) {
      problems.push(`commit with ${a} (stage files first, then git commit -m)`);
      continue;
    }
    if (COMMIT_VALUE_OPTIONS.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith('-')) continue;
    problems.push(`commit with pathspec ${a} (stage files first, then git commit -m)`);
  }
  return problems;
}

/** Inspect the staged changes. Throws if git cannot be run (fail closed). */
function checkStaged(cwd) {
  const opts = { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] };
  // -z: NUL-separated raw names, so quoting of unusual names cannot hide a private path.
  const names = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], opts).split('\0').filter(Boolean);
  const diff = execFileSync('git', ['diff', '--cached', '-U0', '--no-color'], opts);
  const problems = names.filter(isPrivate).map((n) => `staged private file ${n}`);
  let file = '';
  let secret = false;
  const nonEnglish = new Set();
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      file = line.slice(4).replace(/^b\//, '');
      continue;
    }
    if (!line.startsWith('+')) continue;
    if (!secret && SECRET_PATTERNS.some((p) => p.test(line))) secret = true;
    if (file && !allowsNonEnglish(file) && NON_LATIN.test(line)) nonEnglish.add(file);
  }
  if (secret) problems.push('possible secret in staged changes');
  for (const f of nonEnglish) problems.push(`non-English text in ${f} (allowed only in locale files, fixtures and tests)`);
  return problems;
}

/** Collect every "command" string in the hook payload. */
function commandsIn(event) {
  const found = [];
  (function walk(v, key) {
    if (typeof v === 'string') {
      if (key === 'command') found.push(v);
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) walk(v[k], k);
    }
  })(event, '');
  return found;
}

function cwdIn(event) {
  const c = event && (event.cwd || (event.tool_input && event.tool_input.cwd));
  return typeof c === 'string' && c ? c : process.cwd();
}

/** `git commit --dry-run` (also implied by --short, --porcelain, --long) commits nothing. */
function isDryRun(args) {
  return args.some((a) => ['--dry-run', '--short', '--porcelain', '--long'].includes(a));
}

function evaluate(event) {
  const commands = commandsIn(event);
  // The hook only runs for shell tools; a payload without a command string is a shape we do not know.
  if (commands.length === 0) return ['unrecognised hook payload (no command found)'];

  const problems = [];
  const cwd = cwdIn(event);
  for (const command of commands) {
    const gits = segments(command).map(gitInvocation).filter(Boolean);
    const stages = gits.some((g) => ['add', 'rm', 'mv', 'stage'].includes(g.sub));
    const commits = gits.some((g) => g.sub === 'commit' && !isDryRun(g.args));
    // At hook time the staging has not happened yet, so the commit cannot be inspected.
    if (stages && commits) problems.push('stage and commit in separate commands, so the staged result can be checked');

    for (const git of gits) {
      if (git.sub === 'add') problems.push(...checkAdd(git.args));
      if (git.sub === 'commit' && !isDryRun(git.args)) {
        const argProblems = checkCommitArgs(git.args);
        problems.push(...argProblems);
        if (argProblems.length === 0) {
          try {
            problems.push(...checkStaged(cwd));
          } catch (err) {
            problems.push(`could not inspect staged changes (${err.message.split('\n')[0]})`);
          }
        }
      }
    }
  }
  return problems;
}

module.exports = { evaluate, segments, isPrivate };

if (require.main === module) {
  let raw = '';
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      // Fail closed: input we cannot read could hide a commit.
      process.stderr.write('BLOCKED: unreadable hook payload (not JSON)\n');
      process.exit(2);
    }
    const problems = evaluate(event);
    if (problems.length) {
      process.stderr.write(`BLOCKED: ${problems.join('; ')}\n`);
      process.exit(2);
    }
    process.exit(0);
  });
}
