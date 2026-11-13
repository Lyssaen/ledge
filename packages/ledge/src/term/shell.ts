// A shell born beside the daemon: a short tmux session on Ledge's socket, then the same control watch as the harness pane.
// Closing the watch kills the session. Nothing here is written to the log except that it failed.
import { randomBytes } from 'node:crypto';
import type { PaneExitWhy } from '@ledge/protocol';

export async function bornShell(opts: {
  session: { id: string; cwd: string; workdir?: string };
  tag: string;
  cols: number;
  rows: number;
  env(): Promise<Record<string, string>>;
  newSession(o: { name: string; cwd: string; env: Record<string, string>; command: string[] }): Promise<void>;
  watch(session: { id: string; tmuxName: string; shell: string; owned: true; nonce?: string }, size: { cols: number; rows: number }): void;
  reply(msg: { type: 'term.exit'; id: string; shell: string; why: PaneExitWhy }): void;
  /** False once the socket has closed: the session is killed and nothing is watched. */
  alive?(): boolean;
  /** The session went away while the shell was starting. */
  gone?(): boolean;
  killSession?(name: string): void;
  name?(): string;
  log?(line: string): void;
  /** #299: how to start the shell with its integration (OSC 633 marks), or null to start it as before. */
  integration?(shell: string, env: Record<string, string>): { command: string[]; env: Record<string, string>; nonce?: string } | null;
}): Promise<void> {
  const name = opts.name?.() ?? `sh-${randomBytes(6).toString('hex')}`;
  if (opts.alive && !opts.alive()) return;
  const cwd = opts.session.workdir ?? opts.session.cwd;
  let env: Record<string, string> = {};
  let nonce: string | undefined;
  try { env = await opts.env(); } catch { env = {}; }
  const shell = env.SHELL || process.env.SHELL || '/bin/bash';
  try {
    const start: { command: string[]; env: Record<string, string>; nonce?: string } = opts.integration?.(shell, env) ?? { command: [shell, '-l'], env };
    nonce = start.nonce;
    await opts.newSession({ name, cwd, env: start.env, command: start.command });
  } catch {
    opts.log?.(`shell ${opts.tag} of ${opts.session.id} failed`);
    if (!opts.alive || opts.alive()) opts.reply({ type: 'term.exit', id: opts.session.id, shell: opts.tag, why: 'failed' });
    return;
  }
  // The await above let the socket close or the session end. A session nobody watches must not stay behind.
  if (opts.gone?.() || (opts.alive && !opts.alive())) {
    opts.killSession?.(name);
    if (opts.gone?.() && (!opts.alive || opts.alive())) opts.reply({ type: 'term.exit', id: opts.session.id, shell: opts.tag, why: 'gone' });
    return;
  }
  opts.watch({ id: opts.session.id, tmuxName: name, shell: opts.tag, owned: true, ...(nonce ? { nonce } : {}) }, { cols: opts.cols, rows: opts.rows });
}
