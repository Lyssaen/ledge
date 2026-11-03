// Adds or removes the spike's Ledge hooks in the Windows user's Claude Code config and in the spike's Codex home
// (CODEX_HOME, set by env.ps1). The command runs the built
// CLI with the system Node, by absolute, quoted, forward-slash paths (works from cmd and from Git Bash).
//   tsx hooks.ts install|remove
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeClaudeHooks, mergeCodexHooks } from '../../packages/ledge/src/cli/setup.js';

const fwd = (p: string) => p.replace(/\\/g, '/');
const cli = fwd(resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/ledge/dist/cli/index.js'));
const base = `"${fwd(process.execPath)}" "${cli}" hook`;
// Codex on Windows runs a hook as `powershell.exe -NoProfile -Command "<command>"` (spike): a command starting with a
// quoted path is a mere string there and fails with code 1; the call operator runs it, spaces in the paths included.
const codexBase = `& '${fwd(process.execPath)}' '${cli}' hook`;
const files = [
  { path: join(homedir(), '.claude', 'settings.json'), command: base, merge: mergeClaudeHooks },
  { path: join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'hooks.json'), command: `${codexBase} codex`, merge: mergeCodexHooks },
];
type Entry = { hooks?: Array<{ command?: string }> };

const read = async (p: string) => { try { return JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>; } catch { return {}; } };
const mode = process.argv[2];
for (const f of files) {
  const cur = await read(f.path);
  let next: Record<string, unknown>;
  if (mode === 'install') next = f.merge(cur, f.command).settings as Record<string, unknown>;
  else if (mode === 'remove') {
    const hooks: Record<string, Entry[]> = {};
    for (const [ev, list] of Object.entries((cur.hooks ?? {}) as Record<string, Entry[]>)) {
      const kept = list.filter(e => !e.hooks?.some(h => h.command === f.command || h.command === `${f.command} ${ev}`));
      if (kept.length) hooks[ev] = kept;
    }
    next = { ...cur, hooks }; if (!Object.keys(hooks).length) delete next.hooks;
  } else throw new Error('usage: tsx hooks.ts install|remove');
  await mkdir(dirname(f.path), { recursive: true });
  await writeFile(f.path, JSON.stringify(next, null, 2) + '\n');
  console.log(`${mode} ${f.path}`);
}
