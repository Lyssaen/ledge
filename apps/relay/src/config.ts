import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { z } from 'zod';
import { RelayPeerSchema } from '@ledge/protocol';
import type { Who } from './hub.js';
import type { Vapid } from './push.js';

/** A configuration problem. The message names the variable at fault, never its value. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface AccountsConfig {
  mode: 'accounts';
  port: number;
  databaseUrl: string;
  clientId: string;
  clientSecret: string;
  /** GitHub numeric ids, in decimal. */
  allowed: Set<string>;
  /** The relay's public origin, without a path. */
  publicUrl: string;
  githubWeb?: string;
  githubApi?: string;
  /** Directory of the built phone PWA; unset, no static file is served. */
  webDir?: string;
  /** Web Push identity; unset, push is off. */
  vapid?: Vapid;
}
export interface DevConfig {
  mode: 'dev';
  port: number;
  tokens: Record<string, Who>;
  /** Directory of the built phone PWA; unset, no static file is served. */
  webDir?: string;
}
export type Config = AccountsConfig | DevConfig;

const TokensSchema = z.record(z.string().min(1), z.object({ accountId: z.string().min(1), peer: RelayPeerSchema }));
const PortSchema = z.coerce.number().int().min(0).max(65535);

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new ConfigError(`${name} is not set`);
  return v;
}

function parsePort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT;
  const r = PortSchema.safeParse(raw === undefined || raw === '' ? 8787 : raw);
  if (!r.success) throw new ConfigError('PORT must be an integer between 0 and 65535');
  return r.data;
}

function parseAllowed(raw: string): Set<string> {
  const parts = raw.split(',').map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length === 0 || !parts.every((p) => /^[1-9][0-9]*$/.test(p))) {
    throw new ConfigError('LEDGE_RELAY_ALLOWED_GITHUB_IDS must be comma-separated positive integers, at least one');
  }
  return new Set(parts);
}

function parsePublicUrl(raw: string, production: boolean): string {
  const bad = () => new ConfigError('LEDGE_RELAY_PUBLIC_URL must be an http(s) origin without a path, e.g. https://relay.example');
  let u: URL;
  try { u = new URL(raw); } catch { throw bad(); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad();
  if (u.pathname !== '/' || u.search !== '' || u.hash !== '' || u.username !== '' || u.password !== '' || raw.endsWith('/')) throw bad();
  if (production && u.protocol !== 'https:') throw new ConfigError('LEDGE_RELAY_PUBLIC_URL must be https when NODE_ENV=production');
  return u.origin;
}

function optionalBase(env: NodeJS.ProcessEnv, name: string, production: boolean): string | undefined {
  const raw = env[name];
  if (!raw) return undefined;
  if (production) throw new ConfigError(`${name} is not allowed when NODE_ENV=production`);
  let u: URL;
  try { u = new URL(raw); } catch { throw new ConfigError(`${name} must be an http(s) URL`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ConfigError(`${name} must be an http(s) URL`);
  return raw;
}

const VAPID_NAMES = ['LEDGE_RELAY_VAPID_PUBLIC_KEY', 'LEDGE_RELAY_VAPID_PRIVATE_KEY', 'LEDGE_RELAY_VAPID_SUBJECT'] as const;
/** Production needs all of these; reported together, in this order. */
const PRODUCTION_REQUIRED = [
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'LEDGE_RELAY_ALLOWED_GITHUB_IDS', 'LEDGE_RELAY_PUBLIC_URL', 'LEDGE_RELAY_WEB_DIR', ...VAPID_NAMES
] as const;
/** What `@ledge/mobile` builds into the web directory. */
const WEB_BUILD_FILES = ['index.html', 'sw.js', 'build.json', 'manifest.webmanifest'] as const;

/** The three `LEDGE_RELAY_VAPID_*` variables, or none. Messages name a variable, never its value. */
function parseVapid(env: NodeJS.ProcessEnv): Vapid | undefined {
  const names = VAPID_NAMES;
  const [pub, priv, subject] = names.map((n) => env[n] || undefined);
  if (!pub && !priv && !subject) return undefined;
  if (!pub || !priv || !subject) throw new ConfigError(`${names.join(', ')} must be set together or not at all`);
  const b64u = /^[A-Za-z0-9_-]+$/;
  const pubBytes = b64u.test(pub) ? Buffer.from(pub, 'base64url') : Buffer.alloc(0);
  if (pubBytes.length !== 65 || pubBytes[0] !== 4) throw new ConfigError('LEDGE_RELAY_VAPID_PUBLIC_KEY must be an uncompressed P-256 point (65 bytes, base64url)');
  const privBytes = b64u.test(priv) ? Buffer.from(priv, 'base64url') : Buffer.alloc(0);
  if (privBytes.length !== 32) throw new ConfigError('LEDGE_RELAY_VAPID_PRIVATE_KEY must be a 32-byte P-256 scalar, base64url');
  if (!/^(mailto:|https:\/\/)\S+$/.test(subject)) throw new ConfigError('LEDGE_RELAY_VAPID_SUBJECT must be a mailto: or https: URL');
  const jwk = { kty: 'EC', crv: 'P-256', x: pubBytes.subarray(1, 33).toString('base64url'), y: pubBytes.subarray(33).toString('base64url') };
  try {
    const privateKey = createPrivateKey({ key: { ...jwk, d: priv }, format: 'jwk' });
    // The pair must match: a signature by the private key has to verify with the public point.
    const probe = Buffer.from('ledge');
    const sig = sign('sha256', probe, { key: privateKey, dsaEncoding: 'ieee-p1363' });
    if (!verify('sha256', probe, { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, sig)) throw new Error('mismatch');
    return { publicKey: pub, privateKey, subject };
  } catch {
    throw new ConfigError('LEDGE_RELAY_VAPID_PUBLIC_KEY and LEDGE_RELAY_VAPID_PRIVATE_KEY are not a valid P-256 key pair');
  }
}

/** `DATABASE_URL` selects the accounts mode; without it the relay runs on dev tokens, which production refuses. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const production = env.NODE_ENV === 'production';
  const port = parsePort(env);
  const webDir = env.LEDGE_RELAY_WEB_DIR ? { webDir: env.LEDGE_RELAY_WEB_DIR } : {};

  if (env.DATABASE_URL) {
    const githubWeb = optionalBase(env, 'LEDGE_RELAY_GITHUB_WEB_URL', production);
    const githubApi = optionalBase(env, 'LEDGE_RELAY_GITHUB_API_URL', production);
    if (production) {
      const missing = PRODUCTION_REQUIRED.filter((n) => !env[n]);
      if (missing.length > 0) throw new ConfigError(`missing in production: ${missing.join(', ')}`);
    }
    const vapid = parseVapid(env);
    if (production && env.LEDGE_RELAY_WEB_DIR) {
      const absent = WEB_BUILD_FILES.find((f) => !existsSync(join(env.LEDGE_RELAY_WEB_DIR as string, f)));
      if (absent) throw new ConfigError(`LEDGE_RELAY_WEB_DIR has no ${absent}: build @ledge/mobile into it`);
    }
    return {
      mode: 'accounts',
      port,
      databaseUrl: env.DATABASE_URL,
      clientId: required(env, 'GITHUB_CLIENT_ID'),
      clientSecret: required(env, 'GITHUB_CLIENT_SECRET'),
      allowed: parseAllowed(required(env, 'LEDGE_RELAY_ALLOWED_GITHUB_IDS')),
      publicUrl: parsePublicUrl(required(env, 'LEDGE_RELAY_PUBLIC_URL'), production),
      ...(githubWeb ? { githubWeb } : {}),
      ...(githubApi ? { githubApi } : {}),
      ...(vapid ? { vapid } : {}),
      ...webDir
    };
  }

  if (production) throw new ConfigError('DATABASE_URL is not set: refusing to start with dev tokens in production');
  const raw = env.LEDGE_RELAY_DEV_TOKENS;
  const usage = 'it must be JSON {"<token>":{"accountId":"...","peer":"pc"|"d_..."}}';
  if (!raw) throw new ConfigError(`DATABASE_URL and LEDGE_RELAY_DEV_TOKENS are not set; set DATABASE_URL for accounts, or LEDGE_RELAY_DEV_TOKENS (${usage})`);
  let tokens: Record<string, Who>;
  try { tokens = TokensSchema.parse(JSON.parse(raw)); } catch { throw new ConfigError(`LEDGE_RELAY_DEV_TOKENS is not valid: ${usage}`); }
  return { mode: 'dev', port, tokens, ...webDir };
}
