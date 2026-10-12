import { dirname, join } from 'node:path';
import type { DaemonInfo, ServerMessage } from '@ledge/protocol';
import { runFile } from '../tmux.js';
import { loginShellEnv } from '../shell-path.js';
import { log } from '../log.js';
import { tmuxServerAtRisk, SERVICE } from './guard.js';

export const PACKAGE = '@paradow/ledge';
const NPM_TIMEOUT_MS = 3 * 60_000;

/** The npm of the node running the daemon: under nvm, the one on PATH may be another node's (and need sudo). */
export const npmCommand = (execPath: string, version: string) => ({ file: join(dirname(execPath), 'npm'), args: ['i', '-g', `${PACKAGE}@${version}`] });
export const lastLines = (output: string, n = 3) => output.split('\n').map(l => l.trimEnd()).filter(Boolean).slice(-n).join('\n');

/** npm's bin is `#!/usr/bin/env node`: the service PATH has no nvm, so put the daemon's own node first. */
export const npmEnv = (execPath: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ ...env, PATH: `${dirname(execPath)}:${env.PATH ?? ''}` });

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
  let busy = false; let restarting = false;
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
        // Once the restart is requested, stay busy: the process is about to be stopped, a second request must not start another npm.
        await deps.restart();
        restarting = true;
      } finally { if (!restarting) busy = false; }
    }
  };
}

export function realUpdaterDeps(opts: { info: DaemonInfo; save: () => Promise<void> }): UpdaterDeps {
  return {
    info: () => opts.info,
    atRisk: () => tmuxServerAtRisk(),
    npm: async cmd => {
      const env = npmEnv(process.execPath, { ...process.env, ...(await loginShellEnv()) });
      const r = await runFile(cmd.file, cmd.args, env, { timeoutMs: NPM_TIMEOUT_MS });
      const output = `${r.stdout}\n${r.stderr}`;
      return r.code === 124 ? { code: 124, output: `npm timed out after 3 minutes\n${output}` } : { code: r.code, output };
    },
    // --no-block: this systemctl runs inside the cgroup being stopped; the job must not depend on it staying alive.
    restart: async () => { await runFile('systemctl', ['--user', 'restart', '--no-block', SERVICE]); },
    save: opts.save
  };
}
