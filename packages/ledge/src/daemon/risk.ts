import { homedir } from 'node:os';
import { resolve, sep, join } from 'node:path';
import type { Pending, Risk, RiskReason } from '@ledge/protocol';

export interface RiskInput { kind: Pending['kind']; tool?: string; text: string; cwd: string; source: 'hook' | 'pane' }
export interface RiskVerdict { risk: Risk; reason: RiskReason }

/** Tools whose request text is a shell command. Codex's shell tool joins them only once a real capture is in `test/fixtures`. */
export const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash']);

const high = (reason: RiskReason): RiskVerdict => ({ risk: 'high', reason });
const low = (reason: RiskReason): RiskVerdict => ({ risk: 'low', reason });

const inside = (cwd: string, p: string): boolean => {
  const root = resolve(cwd);
  const full = resolve(root, p);
  return full === root || full.startsWith(root + sep);
};

function isSensitive(cwd: string, p: string): boolean {
  if (/^~[\\/]\.(ssh|ledge)(?:[\\/]|$)/.test(p)) return true;
  const full = resolve(cwd, p);
  const segs = full.split(sep);
  if (segs.includes('.git') || segs.some(s => s.startsWith('.env'))) return true;
  const home = homedir();
  return [join(home, '.ssh'), join(home, '.ledge')].some(d => full === d || full.startsWith(d + sep));
}

const PUSH = /\bgit\s+push\b/;
const DESTROYS = [/\brm\s+-\w*[rRf]/, /\bgit\s+reset\s+--hard\b/, /\bgit\s+clean\b/, /\bgit\s+branch\s+-D\b/, /\bgit\s+checkout\s+--\s/];
const DEPLOYS = [/\bdeploy\b/, /\bterraform\s+apply\b/, /\bkubectl\s+(apply|delete)\b/];
const PUBLISHES = /\b(npm|pnpm|yarn)\s+publish\b/;
const PIPES_TO_SHELL = /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/;
const SHELL_SYNTAX = /[\n;&|<>`]|\$\(|\$\{|"[^"]*[$`][^"]*"|'[^']*[$`][^']*'/;
const FORBIDDEN_FLAG = /^(--output|--pre|--ext-diff$|--textconv$|-c$|-exec$|-execdir$|-ok$|-okdir$|-delete$|-fprint|-fls$)/;
const READ_ONLY = new Set(['ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'rg', 'grep', 'find']);
const GIT_READ_ONLY = new Set(['status', 'diff', 'log', 'show', 'rev-parse']);
const GIT_BRANCH_FLAGS = new Set(['-a', '-v', '--list', '--show-current']);
const SCRIPT_WORDS = new Set(['pnpm', 'npm', 'yarn', 'npx', 'node', 'make', 'cargo', 'go', 'bash', 'sh']);

function classifyShell(command: string, cwd: string): RiskVerdict {
  if (PUSH.test(command)) return high('pushes');
  if (DESTROYS.some(r => r.test(command))) return high('destroys');
  if (DEPLOYS.some(r => r.test(command))) return high('deploys');
  if (PUBLISHES.test(command)) return high('publishes');
  if (PIPES_TO_SHELL.test(command)) return high('pipes_to_shell');
  if (SHELL_SYNTAX.test(command)) return high('shell_syntax');
  const words = command.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first || first.includes('=')) return high('unknown');
  const args = words.slice(1);
  if (args.some(a => FORBIDDEN_FLAG.test(a))) return high('unsafe_flag');
  if (args.some(a => a.startsWith('~') || (a.startsWith('/') && !inside(cwd, a)))) return high('sensitive_path');
  if (READ_ONLY.has(first)) return low('read_only_command');
  if (first === 'git') {
    const sub = args[0];
    if (sub && GIT_READ_ONLY.has(sub)) return low('read_only_command');
    if (sub === 'branch' && args.slice(1).every(a => GIT_BRANCH_FLAGS.has(a))) return low('read_only_command');
  }
  if (SCRIPT_WORDS.has(first) || first.startsWith('python') || first.startsWith('./')) return high('script');
  return high('unknown');
}

/** How much accepting a request blindly could do, by the conservative policy table: the first applicable rule wins. Pure. */
export function classify(input: RiskInput): RiskVerdict {
  const { kind, tool, text, cwd } = input;
  if (kind === 'question') return low('question');
  if (kind === 'plan') return high('plan');
  if (kind === 'diff') {
    const t = text.trim();
    const paths = t === '' || t === 'patch' ? [] : t.split(', ').map(p => p.trim()).filter(Boolean);
    if (paths.length === 0) return high('unknown');
    if (paths.some(p => isSensitive(cwd, p))) return high('sensitive_path');
    if (paths.some(p => !inside(cwd, p))) return high('writes_outside_folder');
    return low('edit_inside_folder');
  }
  if (kind !== 'permission') return high('unknown');
  if (tool === 'Read') {
    const p = text.trim();
    if (isSensitive(cwd, p)) return high('sensitive_path');
    return inside(cwd, p) ? low('read_only_command') : high('unknown');
  }
  if (tool === 'WebFetch' || tool === 'WebSearch') return high('network');
  if (!tool || !SHELL_TOOLS.has(tool)) return high('unknown');
  return classifyShell(text, cwd);
}
