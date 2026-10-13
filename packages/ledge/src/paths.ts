import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

/** The terminal tab shows the session's title (the daemon sets @ledge_title on each tmux session). */
export const TITLE_LINES = `set -g set-titles on
set -g set-titles-string "#{@ledge_title}"
`;
export const TMUX_CONF = `set -g status off
set -g mouse on
set -g default-terminal "tmux-256color"
set -sg escape-time 10
set -g history-limit 20000
set -g remain-on-exit off
${TITLE_LINES}`;

export function ledgeDir(): string {
  return process.env.LEDGE_HOME ?? join(homedir(), '.ledge');
}

export function paths() {
  const dir = ledgeDir();
  return { dir, tmuxConf: join(dir, 'tmux.conf'), journal: join(dir, 'sessions.json'), log: join(dir, 'daemon.log'), pid: join(dir, 'daemon.pid'), history: join(dir, 'history') };
}

export async function ensureLedgeDir(): Promise<void> {
  const p = paths();
  await mkdir(p.dir, { recursive: true });
  let conf: string | null = null;
  try { conf = await readFile(p.tmuxConf, 'utf8'); } catch { /* none yet */ }
  if (conf === null) await writeFile(p.tmuxConf, TMUX_CONF);
  else if (!conf.includes('set-titles')) await writeFile(p.tmuxConf, `${conf.trimEnd()}\n${TITLE_LINES}`);
}
