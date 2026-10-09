import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, access } from 'node:fs/promises';

export const TMUX_CONF = `set -g status off
set -g mouse on
set -g default-terminal "tmux-256color"
set -sg escape-time 10
set -g history-limit 20000
set -g remain-on-exit off
`;

export function ledgeDir(): string {
  return process.env.LEDGE_HOME ?? join(homedir(), '.ledge');
}

export function paths() {
  const dir = ledgeDir();
  return { dir, tmuxConf: join(dir, 'tmux.conf'), journal: join(dir, 'sessions.json'), log: join(dir, 'daemon.log'), pid: join(dir, 'daemon.pid') };
}

export async function ensureLedgeDir(): Promise<void> {
  const p = paths();
  await mkdir(p.dir, { recursive: true });
  try { await access(p.tmuxConf); } catch { await writeFile(p.tmuxConf, TMUX_CONF); }
}
