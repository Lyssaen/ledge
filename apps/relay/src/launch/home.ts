import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/** What `ledge-relay launch` keeps in `config.json`; every field is optional and unknown keys are refused. */
export const LaunchFileSchema = z.object({
  publicUrl: z.string(),
  githubClientId: z.string(),
  githubClientSecret: z.string(),
  allowedGithubIds: z.array(z.string()),
  vapid: z.object({ publicKey: z.string(), privateKey: z.string(), subject: z.string() }).strict()
}).partial().strict();
export type LaunchFile = z.infer<typeof LaunchFileSchema>;

/** The data directory: `--data`, else `LEDGE_RELAY_HOME`, else `~/.ledge-relay`. */
export function relayHome(o: { data?: string; env: NodeJS.ProcessEnv; homedir: string }): string {
  return o.data || o.env.LEDGE_RELAY_HOME || join(o.homedir, '.ledge-relay');
}

/** A `config.json` that cannot be used; the message names the file and never its content, which may hold secrets. */
export class LaunchFileError extends Error {
  constructor(readonly path: string) {
    super(`${path} is not a valid ledge-relay config: fix it, or run \`ledge-relay launch --setup\``);
    this.name = 'LaunchFileError';
  }
}

/** The saved settings, or `{}` when nothing was saved yet. */
export function readLaunchFile(home: string): LaunchFile {
  const path = join(home, 'config.json');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
  try {
    return LaunchFileSchema.parse(JSON.parse(text));
  } catch {
    throw new LaunchFileError(path);
  }
}

/** Saves the settings atomically, in a private directory and a private file, since they hold secrets. */
export function writeLaunchFile(home: string, f: LaunchFile): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const tmp = join(home, 'config.json.tmp');
  writeFileSync(tmp, `${JSON.stringify(f, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, join(home, 'config.json'));
}

/** The environment the relay loads: the saved settings fill what `env` leaves empty, so the environment wins. */
export function launchEnv(f: LaunchFile, env: NodeJS.ProcessEnv, webDir: string): NodeJS.ProcessEnv {
  const saved: Record<string, string | undefined> = {
    LEDGE_RELAY_PUBLIC_URL: f.publicUrl,
    GITHUB_CLIENT_ID: f.githubClientId,
    GITHUB_CLIENT_SECRET: f.githubClientSecret,
    LEDGE_RELAY_ALLOWED_GITHUB_IDS: f.allowedGithubIds?.join(','),
    LEDGE_RELAY_VAPID_PUBLIC_KEY: f.vapid?.publicKey,
    LEDGE_RELAY_VAPID_PRIVATE_KEY: f.vapid?.privateKey,
    LEDGE_RELAY_VAPID_SUBJECT: f.vapid?.subject
  };
  const out: NodeJS.ProcessEnv = { ...env, LEDGE_RELAY_WEB_DIR: webDir };
  for (const [k, v] of Object.entries(saved)) if (v && !env[k]) out[k] = v;
  return out;
}

/** The four settings `launch` asks for, in question order. */
export const SETTINGS: ReadonlyArray<{ env: string; label: string }> = [
  { env: 'LEDGE_RELAY_PUBLIC_URL', label: 'public URL' },
  { env: 'GITHUB_CLIENT_ID', label: 'GitHub OAuth App client id' },
  { env: 'GITHUB_CLIENT_SECRET', label: 'GitHub OAuth App client secret' },
  { env: 'LEDGE_RELAY_ALLOWED_GITHUB_IDS', label: 'allowed GitHub account' }
];

/** The `label (ENV)` of each setting that is still empty. */
export function missingSettings(merged: NodeJS.ProcessEnv): string[] {
  return SETTINGS.filter((s) => !merged[s.env]).map((s) => `${s.label} (${s.env})`);
}
