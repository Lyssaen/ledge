#!/usr/bin/env node
import { chmodSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadConfig, parsePublicUrl } from './config.js';
import { DirectoryAccessError, isPermissionError } from './database.js';
import type { GitHub } from './github.js';
import { launchEnv, LaunchFileError, missingSettings, readLaunchFile, relayHome, writeLaunchFile } from './launch/home.js';
import { DataDirLockedError, lockDataDir } from './launch/lock.js';
import { runSetup, SetupInterrupted, type SetupIo } from './launch/setup.js';
import { terminalIo } from './launch/terminal.js';
import { generateVapid } from './launch/vapid.js';
import { startRelay, startupErrorLine } from './run.js';

export interface CliDeps {
  env: NodeJS.ProcessEnv;
  homedir: string;
  isTTY: boolean;
  io: () => SetupIo & { close(): void };
  out: (line: string) => void;
  err: (line: string) => void;
  webDir: string;
  github?: GitHub;
  waitForStop: () => Promise<void>;
}

const OPTIONS = { version: { type: 'boolean' }, port: { type: 'string' }, host: { type: 'string' }, data: { type: 'string' }, setup: { type: 'boolean' } } as const;
type Args = ReturnType<typeof parseArgs<{ args: string[]; allowPositionals: true; options: typeof OPTIONS }>>;

const USAGE = 'usage: ledge-relay launch [--port <port>] [--host <host>] [--data <dir>] [--setup] | ledge-relay --version';

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

/** The one line a known launch failure prints, or null when the error is not one we explain. */
function explain(e: unknown): string | null {
  if (e instanceof LaunchFileError || e instanceof DataDirLockedError) return e.message;
  return startupErrorLine(e);
}

/**
 * Creates the data directory, or tightens an existing one, to 0700: everything inside (secrets, and the database whose
 * files pglite makes readable by all) is then out of other users' reach.
 */
function privateDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  } catch (e) {
    if (isPermissionError(e)) throw new DirectoryAccessError(dir);
    throw e;
  }
}

/** Runs the `ledge-relay` command; returns the exit code. */
export async function main(argv: string[], deps: CliDeps): Promise<number> {
  let args: Args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  } catch {
    deps.err(USAGE);
    return 2;
  }
  const { values, positionals } = args;
  if (values.version && positionals.length === 0) {
    deps.out(version());
    return 0;
  }
  if (positionals.length !== 1 || positionals[0] !== 'launch' || values.version) {
    deps.err(USAGE);
    return 2;
  }

  const host = values.host ?? '127.0.0.1';
  let unlock: (() => void) | undefined;
  try {
    const home = relayHome({ ...(values.data ? { data: values.data } : {}), env: deps.env, homedir: deps.homedir });
    let file = readLaunchFile(home);

    const missing = missingSettings(launchEnv(file, deps.env, deps.webDir));
    const asks = values.setup || missing.length > 0;
    if (asks && !deps.isTTY) {
      if (missing.length === 0) {
        deps.err('ledge-relay: --setup needs a terminal');
        return 1;
      }
      deps.err(`ledge-relay: missing settings: ${missing.join(', ')}; run \`ledge-relay launch\` once in a terminal, or set these environment variables`);
      return 1;
    }

    // The lock is taken before anything is written, so that a second launcher neither rewrites the settings of a
    // running relay nor opens its embedded database.
    privateDir(home);
    unlock = lockDataDir(home);

    if (asks) {
      const io = deps.io();
      try {
        file = await runSetup(io, file);
      } catch (e) {
        if (!(e instanceof SetupInterrupted)) throw e;
        deps.err('ledge-relay: setup interrupted, nothing saved');
        return 1;
      } finally {
        io.close();
      }
      writeLaunchFile(home, file);
    }

    // New VAPID keys are saved only once the whole configuration, public URL included, has been accepted.
    const merged = launchEnv(file, deps.env, deps.webDir);
    parsePublicUrl(merged.LEDGE_RELAY_PUBLIC_URL as string, true);
    const vapid = !file.vapid && !merged.LEDGE_RELAY_VAPID_PUBLIC_KEY ? generateVapid(merged.LEDGE_RELAY_PUBLIC_URL as string) : undefined;
    const withVapid = vapid ? { ...file, vapid } : file;
    const cfg = loadConfig(
      { ...launchEnv(withVapid, deps.env, deps.webDir), ...(values.port !== undefined ? { PORT: values.port } : {}) },
      { production: true, pgliteDir: join(home, 'db') }
    );
    if (vapid) writeLaunchFile(home, withVapid);

    const relay = await startRelay(cfg, { host, ...(deps.github ? { github: deps.github } : {}) });
    deps.out(`ledge-relay ${version()} listening on http://${host}:${relay.port} — public URL ${cfg.mode === 'accounts' ? cfg.publicUrl : ''}: put an HTTPS proxy in front, then enter this URL in Ledge Desktop › Settings › Mobile access`);
    deps.out(JSON.stringify({ at: new Date().toISOString(), ev: 'listening', port: relay.port, mode: cfg.mode }));
    await deps.waitForStop();
    await relay.close();
    return 0;
  } catch (e) {
    const line = explain(e);
    if (line === null) throw e;
    deps.err(`ledge-relay: ${line}`);
    return 1;
  } finally {
    unlock?.();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const realDeps: CliDeps = {
    env: process.env,
    homedir: homedir(),
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    io: () => terminalIo(process.stdin, process.stdout),
    out: (line) => { process.stdout.write(`${line}\n`); },
    err: (line) => { process.stderr.write(`${line}\n`); },
    webDir: fileURLToPath(new URL('../web', import.meta.url)),
    waitForStop: () => new Promise<void>((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); })
  };
  process.exitCode = await main(process.argv.slice(2), realDeps);
}
