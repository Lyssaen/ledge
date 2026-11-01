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
  return { dir, tmuxConf: join(dir, 'tmux.conf'), journal: join(dir, 'sessions.json'), log: join(dir, 'daemon.log'), pid: join(dir, 'daemon.pid'), history: join(dir, 'history'), mail: join(dir, 'mail.json'), asks: join(dir, 'asks.json'), machines: join(dir, 'machines.json'), projects: join(dir, 'projects.json'), island: join(dir, 'island.json'), token: join(dir, 'token'), mobile: join(dir, 'mobile.json'), mobileSession: join(dir, 'mobile-session.json'), mobileKey: join(dir, 'mobile-key'), devices: join(dir, 'devices.json'), revocations: join(dir, 'revocations.json'), attachments: join(dir, 'attachments'), openrig: join(dir, 'openrig.json'), ledgeThread: join(dir, 'ledge-thread.jsonl'), rigs: join(dir, 'rigs'), rigLaunches: join(dir, 'rig-launches.json'), mandate: join(dir, 'mandat.md'), memoryDir: join(dir, 'memoire'), rules: join(dir, 'memoire', 'rules.json'), decisions: join(dir, 'memoire', 'decisions.jsonl'), brainSettings: join(dir, 'brain.json'), brainDir: join(dir, 'brain') };
}

export async function ensureLedgeDir(): Promise<void> {
  const p = paths();
  await mkdir(p.dir, { recursive: true });
  let conf: string | null = null;
  try { conf = await readFile(p.tmuxConf, 'utf8'); } catch { /* none yet */ }
  if (conf === null) await writeFile(p.tmuxConf, TMUX_CONF);
  else if (!conf.includes('set-titles')) await writeFile(p.tmuxConf, `${conf.trimEnd()}\n${TITLE_LINES}`);
}
