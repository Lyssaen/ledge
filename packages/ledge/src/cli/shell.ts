// #299: `ledge shell [--nonce <hex32>] <dir>` prints the POSIX line that starts the person's login shell in <dir> with Ledge's
// integration (OSC 633 marks, E signed with the nonce). It starts nothing itself: Desktop's shell runs
//   sh -c 'eval "$(<launcher> shell --nonce N <dir>)"; exec <login shell> -l'
// so no Node process stays the shell's parent (Node cannot exec), and a failure here leaves the plain shell of the second half.
// On failure nothing goes to stdout (the eval stays harmless): the reason on stderr, a code that is not 0.
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { paths } from '../paths.js';
import { withIntegration } from '../term/shellIntegration.js';

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The person's login shell: theirs in passwd, else $SHELL, else /bin/sh. */
function loginShell(env: NodeJS.ProcessEnv): string {
  let shell = '';
  try { shell = userInfo().shell ?? ''; } catch { shell = ''; }
  return shell || env.SHELL || '/bin/sh';
}

/** The line for `args`, or the reason it cannot be printed. */
export function shellLine(args: string[], deps: { env?: NodeJS.ProcessEnv; shell?: string; dir?: string } = {}): { line: string } | { error: string } {
  let nonce: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--nonce') { nonce = args[++i]; if (nonce === undefined) return { error: '--nonce needs a value' }; }
    else if (a.startsWith('--nonce=')) nonce = a.slice(8);
    else if (a.startsWith('--')) return { error: `unknown option ${a}` };
    else rest.push(a);
  }
  if (nonce !== undefined && !/^[0-9a-f]{32}$/.test(nonce)) return { error: 'the nonce is 32 lowercase hexadecimal characters' };
  if (rest.length !== 1 || rest[0] === '') return { error: 'usage: ledge shell [--nonce <hex32>] <dir>' };
  const env = deps.env ?? process.env;
  const shell = deps.shell ?? loginShell(env);
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) flat[k] = v;
  const plan = withIntegration(shell, flat, deps.dir ?? join(paths().dir, 'shell-integration'), ...(nonce ? [nonce] : []));
  // As Desktop did before: the folder, else home. `~` and `~/…` are the home folder's (Desktop sends the path as the person gave it).
  const home = env.HOME ?? '';
  const raw = rest[0]!;
  const dir = home && (raw === '~' || raw.startsWith('~/')) ? home + raw.slice(1) : raw;
  const go = `cd ${quote(dir)} 2>/dev/null || cd`;
  if (!plan) return { line: `${go}; exec ${quote(shell)} -l` };
  const exports = Object.entries(plan.env).filter(([k, v]) => flat[k] !== v && NAME.test(k)).map(([k, v]) => `export ${k}=${quote(v)}`);
  return { line: [go, ...exports, `exec ${plan.command.map(quote).join(' ')}`].join('; ') };
}

export function shell(args: string[]): number {
  const r = shellLine(args);
  if ('error' in r) { process.stderr.write(`ledge shell: ${r.error}\n`); return 2; }
  process.stdout.write(`${r.line}\n`);
  return 0;
}
