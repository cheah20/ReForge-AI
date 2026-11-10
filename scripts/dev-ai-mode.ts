/**
 * scripts/dev-ai-mode.ts
 *
 * Decides, for `vite` dev and build, whether the Cloudflare plugin may open
 * remote bindings. Workers AI has no local simulation, so a remote connection
 * (and a Cloudflare login) is needed only when real AI is explicitly enabled.
 * Otherwise `remoteBindings` is false and the app runs offline with the mock
 * provider (decision 11).
 *
 * Real AI is enabled by AI_MODE=real in the environment or in `.dev.vars`
 * (the file the Worker itself reads local variables from).
 */

import * as fs from 'fs';
import * as path from 'path';

/** Value of KEY in dotenv-style text (KEY=value, optional quotes, # comments). */
export function readVar(text: string, key: string): string | undefined {
  let found: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() !== key) continue;
    found = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return found;
}

export function devAiMode(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
  read: (file: string) => string | undefined = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined),
): 'real' | 'mock' {
  const fromEnv = env['AI_MODE'];
  const fromFile = fromEnv === undefined ? readVar(read(path.join(cwd, '.dev.vars')) ?? '', 'AI_MODE') : undefined;
  return (fromEnv ?? fromFile) === 'real' ? 'real' : 'mock';
}
