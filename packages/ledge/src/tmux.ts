import { execFile } from 'node:child_process';
import { paths } from './paths.js';

export interface Tmux {
  newSession(opts: { name: string; cwd: string; env: Record<string, string>; command: string[] }): Promise<void>;
  sendText(name: string, text: string): Promise<void>;
  sendKeys(name: string, keys: string[]): Promise<void>;
  capture(name: string, lines: number): Promise<string>;
  hasSession(name: string): Promise<boolean>;
  listSessions(): Promise<string[]>;
  killSession(name: string): Promise<void>;
  attachArgs(name: string): string[];
}

export function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    execFile('tmux', args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number' ? (err as unknown as { code: number }).code : err ? 1 : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export function realTmux(socket = 'ledge'): Tmux {
  const base = () => ['-L', socket, '-f', paths().tmuxConf];
  const t = (args: string[]) => run([...base(), ...args]);
  return {
    async newSession({ name, cwd, env, command }) {
      const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
      const r = await t(['new-session', '-d', '-s', name, '-c', cwd, '-x', '200', '-y', '50', ...envArgs, '--', ...command]);
      if (r.code !== 0) throw new Error(`tmux new-session failed: ${r.stderr.trim()}`);
    },
    async sendText(name, text) {
      if (/[\r\n]/.test(text)) throw new Error('sendText: text must not contain newlines; flatten it first');
      // tmux treats an argv element ending in ';' as a command separator; '\;' sends a literal ';'.
      const arg = text.endsWith(';') ? `${text.slice(0, -1)}\\;` : text;
      const r = await t(['send-keys', '-t', `=${name}:`, '-l', '--', arg]);
      if (r.code !== 0) throw new Error(`tmux send-keys failed: ${r.stderr.trim()}`);
    },
    async sendKeys(name, keys) {
      const r = await t(['send-keys', '-t', `=${name}:`, ...keys]);
      if (r.code !== 0) throw new Error(`tmux send-keys failed: ${r.stderr.trim()}`);
    },
    async capture(name, lines) {
      // History included, then trimmed to exactly the last `lines` lines.
      const r = await t(['capture-pane', '-p', '-J', '-t', `=${name}:`, '-S', String(-lines)]);
      if (r.code !== 0) return '';
      return r.stdout.replace(/\s+$/g, '').split('\n').slice(-lines).join('\n');
    },
    async hasSession(name) {
      return (await t(['has-session', '-t', `=${name}`])).code === 0;
    },
    async listSessions() {
      const r = await t(['list-sessions', '-F', '#{session_name}']);
      return r.code === 0 ? r.stdout.split('\n').map(s => s.trim()).filter(Boolean) : [];
    },
    async killSession(name) { await t(['kill-session', '-t', `=${name}`]); },
    attachArgs(name) { return [...base(), 'attach-session', '-t', `=${name}`]; }
  };
}
