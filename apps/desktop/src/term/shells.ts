import { shellCommand, type MachineState } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import type { Messages } from '../i18n/messages';
import type { NativeShell } from './backend';

export type ShellKind = 'wsl' | 'powershell' | 'cmd' | 'gitbash' | 'ledge' | `ssh:${string}`; // ssh:<machine id>
/** What `shells_available` answers: `wsl` is the default distro ("" when wsl.exe did not answer), null when there is no WSL. */
export interface ShellsAvailable { wsl: string | null; powershell: boolean; cmd: boolean; gitBash: boolean }
export interface ShellRow { kind: ShellKind; label: string; hint: string; isDefault: boolean; section: 'local' | 'ledge' | 'machines' }

const KEY = 'ledge.ide.lastShell';
const LEDGE_ARGV = ['sh', '-c', 'cd; ledge who; exec $(getent passwd $(id -un) | cut -d: -f7) -l'];

/** The « + ▾ » menu: the local shells, Ledge, then the machines reached over SSH; « default » on `last`, in place of the row's hint. */
export function shellMenu(avail: ShellsAvailable, machines: readonly MachineState[], last: ShellKind, t: Messages): ShellRow[] {
  const s = t.ide.panel.shells;
  const rows: Omit<ShellRow, 'isDefault'>[] = [];
  const add = (kind: ShellKind, label: string, hint: string, section: ShellRow['section']) => rows.push({ kind, label, hint, section });
  if (avail.wsl !== null) add('wsl', avail.wsl ? `${s.wsl} · ${avail.wsl}` : s.wsl, '', 'local');
  if (avail.powershell) add('powershell', s.powershell, '', 'local');
  if (avail.cmd) add('cmd', s.cmd, '', 'local');
  if (avail.gitBash) add('gitbash', s.gitBash, '', 'local');
  if (machines.find(m => m.id === 'local')?.launcher) add('ledge', s.ledge, s.ledgeHint, 'ledge');
  for (const m of machines) if (m.id && m.id !== 'local' && m.ssh) add(`ssh:${m.id}`, `${s.ssh} · ${m.label}`, m.ssh, 'machines');
  return rows.map(r => r.kind === last ? { ...r, hint: s.isDefault, isDefault: true } : { ...r, isDefault: false });
}

/** `last` while it is still in the menu, else WSL. */
export function defaultShell(rows: readonly ShellRow[], last: ShellKind): ShellKind {
  if (rows.some(r => r.kind === last)) return last;
  return rows.some(r => r.kind === 'wsl') ? 'wsl' : rows[0]?.kind ?? 'wsl';
}

/** What the pseudo-terminal runs: argv in WSL (starting in `dir`), or a native shell; null when it cannot (wsl.exe would refuse the folder, unknown machine). */
export function shellLaunch(kind: ShellKind, ctx: { dir: string; machines: readonly MachineState[] }): { argv: string[] } | { native: NativeShell } | null {
  if (kind === 'powershell' || kind === 'cmd' || kind === 'gitbash') return { native: kind };
  if (kind === 'ledge') return { argv: LEDGE_ARGV };
  if (kind === 'wsl') {
    const local = ctx.machines.find(m => m.id === 'local');
    const argv = local ? shellCommand(local, ctx.dir || '~') : null;
    return argv ? { argv } : null;
  }
  const machine = ctx.machines.find(m => m.id && m.id !== 'local' && m.ssh && `ssh:${m.id}` === kind);
  const argv = machine ? shellCommand(machine, ctx.dir || '~') : null;
  return argv ? { argv } : null;
}

/** A session's own shell (OMP's « Ouvrir un shell »): on its machine, over SSH when that machine is reached that way, else WSL;
 *  in its worktree, else its folder. Never the shell last chosen in the menu, which may not take a folder. */
export function sessionShell(s: Pick<Session, 'machineId' | 'workdir' | 'cwd'>, machines: readonly MachineState[]): { kind: ShellKind; dir: string; remote: boolean } {
  const machine = s.machineId && s.machineId !== 'local' ? machines.find(m => m.id === s.machineId && m.ssh) : undefined;
  return { kind: machine ? `ssh:${machine.id}` : 'wsl', dir: s.workdir ?? s.cwd, remote: !!machine };
}

/** The menu's SSH shells start at the machine's home: the focused session's folder is a path of this machine. */
export function menuDir(kind: ShellKind, dir: string): string { return kind.startsWith('ssh:') ? '' : dir; }

const KINDS = ['wsl', 'powershell', 'cmd', 'gitbash', 'ledge'];
export function loadLastShell(): ShellKind {
  try {
    const v = localStorage.getItem(KEY);
    if (v && (KINDS.includes(v) || v.startsWith('ssh:'))) return v as ShellKind;
  } catch { /* storage unavailable */ }
  return 'wsl';
}
export function saveLastShell(k: ShellKind): void { try { localStorage.setItem(KEY, k); } catch { /* storage unavailable */ } }
