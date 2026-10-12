import { dirname, join } from 'node:path';
import type { DaemonInfo, ServerMessage } from '@ledge/protocol';
import { runFile } from '../tmux.js';
import { log } from '../log.js';
import { tmuxServerAtRisk, SERVICE } from './guard.js';

export const PACKAGE = '@paradow/ledge';
const NPM_TIMEOUT_MS = 3 * 60_000;

/** The npm of the node running the daemon: under nvm, the one on PATH may be another node's (and need sudo). */
export const npmCommand = (execPath: string, version: string) => ({ file: join(dirname(execPath), 'npm'), args: ['i', '-g', `${PACKAGE}@${version}`] });
export const lastLines = (output: string, n = 3) => output.split('\n').map(l => l.trimEnd()).filter(Boolean).slice(-n).join('\n');

export interface UpdaterDeps {
  info: () => DaemonInfo;
  atRisk: () => Promise<boolean>;
  npm: (cmd: { file: string; args: string[] }) => Promise<{ code: number; output: string }>;
  restart: () => Promise<void>;
  save: () => Promise<void>;
  execPath?: string;
}

/** Spec 2026-10-12 auto-update §6: every refusal leaves the install untouched; the restart comes only after npm succeeded. */
export function createDaemonUpdater(deps: UpdaterDeps) {
  let busy = false;
  return {
    running: () => busy,
    async update(version: string, send: (m: ServerMessage) => void): Promise<void> {
      if (busy) return send({ type: 'update.failed', version, reason: 'busy' });
      const info = deps.info();
      const cmd = npmCommand(deps.execPath ?? process.execPath, version);
      const shown = `${cmd.file} ${cmd.args.join(' ')}`;
      if (info.install !== 'npm') return send({ type: 'update.failed', version, reason: 'git-install', ...(info.manual ? { command: info.manual } : {}) });
      if (!info.systemd) return send({ type: 'update.failed', version, reason: 'no-systemd', command: shown });
      busy = true;
      try {
        if (await deps.atRisk()) return send({ type: 'update.failed', version, reason: 'sessions-at-risk' });
        send({ type: 'update.progress', version, step: 'installing' });
        log(`update: ${shown}`);
        const r = await deps.npm(cmd);
        if (r.code !== 0) { log(`update: npm failed (${r.code})\n${r.output}`); return send({ type: 'update.failed', version, reason: 'npm-failed', detail: lastLines(r.output), command: shown }); }
        send({ type: 'update.progress', version, step: 'restarting' });
        await deps.save();
        await deps.restart();
      } finally { busy = false; }
    }
  };
}

export function realUpdaterDeps(opts: { info: DaemonInfo; save: () => Promise<void> }): UpdaterDeps {
  return {
    info: () => opts.info,
    atRisk: () => tmuxServerAtRisk(),
    npm: cmd => new Promise(resolve => {
      // runFile exposes no handle to kill the child: on timeout we stop waiting and report failure, but npm may
      // still finish in the background (a later install of the same version is harmless; no restart follows it).
      const timer = setTimeout(() => resolve({ code: 124, output: 'npm timed out after 3 minutes' }), NPM_TIMEOUT_MS);
      runFile(cmd.file, cmd.args, process.env).then(r => { clearTimeout(timer); resolve({ code: r.code, output: `${r.stdout}\n${r.stderr}` }); });
    }),
    // --no-block: this systemctl runs inside the cgroup being stopped; the job must not depend on it staying alive.
    restart: async () => { await runFile('systemctl', ['--user', 'restart', '--no-block', SERVICE]); },
    save: opts.save
  };
}
