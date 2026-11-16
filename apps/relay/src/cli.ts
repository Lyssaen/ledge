#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from './config.js';
import { DatabaseOpenError } from './database.js';
import type { GitHub } from './github.js';
import { launchEnv, LaunchFileError, missingSettings, readLaunchFile, relayHome, writeLaunchFile } from './launch/home.js';
import { runSetup, type SetupIo } from './launch/setup.js';
import { terminalIo } from './launch/terminal.js';
import { generateVapid } from './launch/vapid.js';
import { DatabaseUnreachableError, ListenError, startRelay } from './run.js';

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

/** The one line a known startup failure prints, or undefined when the error is not one we explain. */
function explain(e: unknown): string | undefined {
  if (e instanceof ConfigError || e instanceof LaunchFileError) return e.message;
  if (e instanceof ListenError) return `cannot listen on port ${e.port}: ${e.code}`;
  if (e instanceof DatabaseUnreachableError) return `cannot start: the database is unreachable or its migration failed${e.code ? ` (${e.code})` : ''}`;
  if (e instanceof DatabaseOpenError) return `cannot open the embedded database at ${e.dir}: move this directory aside to start a fresh one (accounts, sessions, linked phones and push subscriptions are then lost)`;
  return undefined;
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
  try {
    const home = relayHome({ ...(values.data ? { data: values.data } : {}), env: deps.env, homedir: deps.homedir });
    let file = readLaunchFile(home);

    const missing = missingSettings(launchEnv(file, deps.env, deps.webDir));
    if (values.setup || missing.length > 0) {
      if (!deps.isTTY) {
        deps.err(`ledge-relay: missing settings: ${missing.join(', ')}; run \`ledge-relay launch\` once in a terminal, or set these environment variables`);
        return 1;
      }
      const io = deps.io();
      try {
        file = await runSetup(io, file);
      } catch {
        return 1;
      } finally {
        io.close();
      }
      writeLaunchFile(home, file);
    }

    const merged = launchEnv(file, deps.env, deps.webDir);
    if (!file.vapid && !merged.LEDGE_RELAY_VAPID_PUBLIC_KEY) {
      const subject = merged.LEDGE_RELAY_PUBLIC_URL as string;
      file = { ...file, vapid: generateVapid(subject) };
      writeLaunchFile(home, file);
    }

    const cfg = loadConfig(
      { ...launchEnv(file, deps.env, deps.webDir), ...(values.port !== undefined ? { PORT: values.port } : {}) },
      { production: true, pgliteDir: join(home, 'db') }
    );
    const relay = await startRelay(cfg, { host, ...(deps.github ? { github: deps.github } : {}) });
    deps.out(`ledge-relay ${version()} listening on http://${host}:${relay.port} — public URL ${cfg.mode === 'accounts' ? cfg.publicUrl : ''}: put an HTTPS proxy in front, then enter this URL in Ledge Desktop › Settings › Mobile access`);
    deps.out(JSON.stringify({ at: new Date().toISOString(), ev: 'listening', port: relay.port, mode: cfg.mode }));
    await deps.waitForStop();
    await relay.close();
    return 0;
  } catch (e) {
    const line = explain(e);
    if (line === undefined) throw e;
    deps.err(`ledge-relay: ${line}`);
    return 1;
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
