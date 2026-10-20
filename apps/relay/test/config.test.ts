import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const FULL = {
  DATABASE_URL: 'postgres://u:p@h/db',
  GITHUB_CLIENT_ID: 'cid',
  GITHUB_CLIENT_SECRET: 'csecret',
  LEDGE_RELAY_ALLOWED_GITHUB_IDS: '1, 22',
  LEDGE_RELAY_PUBLIC_URL: 'https://relay.example'
};

function failure(env: NodeJS.ProcessEnv): ConfigError {
  try { loadConfig(env); } catch (e) { expect(e).toBeInstanceOf(ConfigError); return e as ConfigError; }
  throw new Error('expected a ConfigError');
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'ledge-config-'));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));
let dirs = 0;
/** A directory standing in for the phone app build, holding the given files. */
function webDir(files: string[]): string {
  const dir = join(tmpRoot, `web${dirs++}`);
  mkdirSync(dir);
  for (const f of files) writeFileSync(join(dir, f), '');
  return dir;
}

const vapidJwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
const vapidRaw = (k: string | undefined) => Buffer.from(k ?? '', 'base64url');

/** A complete production environment: push keys and a phone app build included. */
function productionEnv(): NodeJS.ProcessEnv {
  return {
    ...FULL,
    NODE_ENV: 'production',
    LEDGE_RELAY_WEB_DIR: webDir(['index.html', 'sw.js', 'build.json', 'manifest.webmanifest']),
    LEDGE_RELAY_VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), vapidRaw(vapidJwk.x), vapidRaw(vapidJwk.y)]).toString('base64url'),
    LEDGE_RELAY_VAPID_PRIVATE_KEY: vapidJwk.d as string,
    LEDGE_RELAY_VAPID_SUBJECT: 'mailto:ops@example.com'
  };
}

describe('loadConfig, accounts mode', () => {
  it('reads a full environment', () => {
    const cfg = loadConfig(FULL);
    expect(cfg).toMatchObject({
      mode: 'accounts', port: 8787, databaseUrl: FULL.DATABASE_URL, clientId: 'cid', clientSecret: 'csecret',
      publicUrl: 'https://relay.example'
    });
    if (cfg.mode !== 'accounts') throw new Error('mode');
    expect(cfg.allowed).toEqual(new Set(['1', '22']));
    expect(cfg.githubWeb).toBeUndefined();
  });

  it('reads PORT and the GitHub overrides outside production', () => {
    const cfg = loadConfig({ ...FULL, PORT: '0', LEDGE_RELAY_GITHUB_WEB_URL: 'http://gh.local', LEDGE_RELAY_GITHUB_API_URL: 'http://api.local' });
    expect(cfg).toMatchObject({ port: 0, githubWeb: 'http://gh.local', githubApi: 'http://api.local' });
  });

  it.each(['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'LEDGE_RELAY_ALLOWED_GITHUB_IDS', 'LEDGE_RELAY_PUBLIC_URL'])(
    'names a missing %s',
    (name) => {
      const env: NodeJS.ProcessEnv = { ...FULL };
      delete env[name];
      expect(failure(env).message).toContain(name);
    }
  );

  it('refuses a bad id list', () => {
    expect(failure({ ...FULL, LEDGE_RELAY_ALLOWED_GITHUB_IDS: '1,abc' }).message).toContain('LEDGE_RELAY_ALLOWED_GITHUB_IDS');
    expect(failure({ ...FULL, LEDGE_RELAY_ALLOWED_GITHUB_IDS: '1,0' }).message).toContain('LEDGE_RELAY_ALLOWED_GITHUB_IDS');
    expect(failure({ ...FULL, LEDGE_RELAY_ALLOWED_GITHUB_IDS: ' , ' }).message).toContain('LEDGE_RELAY_ALLOWED_GITHUB_IDS');
  });

  it('refuses a public URL with a path, or that is not http(s)', () => {
    expect(failure({ ...FULL, LEDGE_RELAY_PUBLIC_URL: 'http://x/path' }).message).toContain('LEDGE_RELAY_PUBLIC_URL');
    expect(failure({ ...FULL, LEDGE_RELAY_PUBLIC_URL: 'ftp://x' }).message).toContain('LEDGE_RELAY_PUBLIC_URL');
    expect(failure({ ...FULL, LEDGE_RELAY_PUBLIC_URL: 'nonsense' }).message).toContain('LEDGE_RELAY_PUBLIC_URL');
  });

  it('refuses a bad PORT', () => {
    expect(failure({ ...FULL, PORT: '70000' }).message).toContain('PORT');
    expect(failure({ ...FULL, PORT: 'abc' }).message).toContain('PORT');
  });

  it('requires https in production, and refuses the GitHub overrides there', () => {
    const prod = productionEnv();
    expect(loadConfig(prod).mode).toBe('accounts');
    expect(failure({ ...prod, LEDGE_RELAY_PUBLIC_URL: 'http://relay.example' }).message).toContain('LEDGE_RELAY_PUBLIC_URL');
    expect(failure({ ...prod, LEDGE_RELAY_GITHUB_WEB_URL: 'http://gh.local' }).message).toContain('LEDGE_RELAY_GITHUB_WEB_URL');
    expect(failure({ ...prod, LEDGE_RELAY_GITHUB_API_URL: 'http://gh.local' }).message).toContain('LEDGE_RELAY_GITHUB_API_URL');
  });

  it('reads a complete production environment, with the phone app and push', () => {
    const prod = productionEnv();
    const cfg = loadConfig(prod);
    if (cfg.mode !== 'accounts') throw new Error('mode');
    expect(cfg.webDir).toBe(prod.LEDGE_RELAY_WEB_DIR);
    expect(cfg.vapid?.subject).toBe('mailto:ops@example.com');
  });

  it('reports every missing production variable at once, in order', () => {
    const env = productionEnv();
    delete env.GITHUB_CLIENT_SECRET;
    delete env.LEDGE_RELAY_WEB_DIR;
    delete env.LEDGE_RELAY_VAPID_PUBLIC_KEY;
    delete env.LEDGE_RELAY_VAPID_PRIVATE_KEY;
    delete env.LEDGE_RELAY_VAPID_SUBJECT;
    expect(failure(env).message).toBe(
      'missing in production: GITHUB_CLIENT_SECRET, LEDGE_RELAY_WEB_DIR, LEDGE_RELAY_VAPID_PUBLIC_KEY, LEDGE_RELAY_VAPID_PRIVATE_KEY, LEDGE_RELAY_VAPID_SUBJECT'
    );
    const only = productionEnv();
    delete only.LEDGE_RELAY_VAPID_SUBJECT;
    expect(failure(only).message).toBe('missing in production: LEDGE_RELAY_VAPID_SUBJECT');
  });

  it('refuses a web dir without the phone app build, naming the first absent file', () => {
    const dir = webDir(['index.html', 'sw.js', 'manifest.webmanifest']);
    expect(failure({ ...productionEnv(), LEDGE_RELAY_WEB_DIR: dir }).message).toBe('LEDGE_RELAY_WEB_DIR has no build.json: build @ledge/mobile into it');
    const empty = webDir([]);
    expect(failure({ ...productionEnv(), LEDGE_RELAY_WEB_DIR: empty }).message).toContain('has no index.html');
  });

  it('accepts no web dir and no push outside production', () => {
    const cfg = loadConfig(FULL);
    expect(cfg.mode).toBe('accounts');
    expect(cfg).not.toHaveProperty('webDir');
    expect(cfg).not.toHaveProperty('vapid');
    expect(loadConfig({ ...FULL, LEDGE_RELAY_WEB_DIR: '/not/checked' })).toMatchObject({ webDir: '/not/checked' });
  });

  it('never puts a passed value in a production message', () => {
    const env = { ...productionEnv(), GITHUB_CLIENT_SECRET: 's3cr3t', LEDGE_RELAY_ALLOWED_GITHUB_IDS: '1,abc', DATABASE_URL: 'postgres://u:hunter2@h/db' };
    for (const e of [
      failure(env),
      failure({ ...env, LEDGE_RELAY_ALLOWED_GITHUB_IDS: '4242', LEDGE_RELAY_WEB_DIR: webDir(['index.html']) }),
      failure({ ...env, LEDGE_RELAY_WEB_DIR: undefined, LEDGE_RELAY_VAPID_SUBJECT: undefined })
    ]) {
      for (const v of ['s3cr3t', 'hunter2', 'abc', '4242', tmpRoot, vapidJwk.d as string]) expect(e.message).not.toContain(v);
    }
  });

  it('never puts a value in a message', () => {
    const e = failure({ ...FULL, GITHUB_CLIENT_SECRET: 's3cr3t', LEDGE_RELAY_ALLOWED_GITHUB_IDS: '1,abc', DATABASE_URL: 'postgres://u:hunter2@h/db' });
    expect(e.message).not.toContain('s3cr3t');
    expect(e.message).not.toContain('hunter2');
    expect(e.message).not.toContain('abc');
  });
});

describe('loadConfig, LEDGE_RELAY_WEB_DIR', () => {
  it('is read in accounts mode and absent by default', () => {
    expect(loadConfig({ ...FULL, LEDGE_RELAY_WEB_DIR: '/srv/web' })).toMatchObject({ webDir: '/srv/web' });
    expect(loadConfig(FULL)).not.toHaveProperty('webDir');
  });
  it('is read in dev mode', () => {
    const tokens = JSON.stringify({ t: { accountId: 'a', peer: 'pc' } });
    expect(loadConfig({ LEDGE_RELAY_DEV_TOKENS: tokens, LEDGE_RELAY_WEB_DIR: '/srv/web' })).toMatchObject({ mode: 'dev', webDir: '/srv/web' });
  });
});

describe('loadConfig, dev mode', () => {
  const TOKENS = JSON.stringify({ 'tok-pc-0123456789abcdef': { accountId: 'me', peer: 'pc' } });

  it('is chosen without DATABASE_URL, from LEDGE_RELAY_DEV_TOKENS', () => {
    expect(loadConfig({ LEDGE_RELAY_DEV_TOKENS: TOKENS })).toEqual({
      mode: 'dev', port: 8787, tokens: { 'tok-pc-0123456789abcdef': { accountId: 'me', peer: 'pc' } }
    });
  });

  it('refuses missing or invalid tokens', () => {
    expect(failure({}).message).toContain('LEDGE_RELAY_DEV_TOKENS');
    expect(failure({ LEDGE_RELAY_DEV_TOKENS: '{nope' }).message).toContain('LEDGE_RELAY_DEV_TOKENS');
    expect(failure({ LEDGE_RELAY_DEV_TOKENS: '{"t":{"accountId":"a","peer":"x"}}' }).message).toContain('LEDGE_RELAY_DEV_TOKENS');
  });

  it('refuses a bad PORT', () => {
    expect(failure({ LEDGE_RELAY_DEV_TOKENS: TOKENS, PORT: '-1' }).message).toContain('PORT');
  });

  it('is refused in production, with or without tokens', () => {
    expect(failure({ NODE_ENV: 'production' }).message).toContain('DATABASE_URL');
    expect(failure({ NODE_ENV: 'production', LEDGE_RELAY_DEV_TOKENS: TOKENS }).message).toContain('DATABASE_URL');
  });
});

describe('loadConfig, VAPID', () => {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
  const raw = (k: string | undefined) => Buffer.from(k ?? '', 'base64url');
  const publicKey = Buffer.concat([Buffer.from([4]), raw(jwk.x), raw(jwk.y)]).toString('base64url');
  const VAPID = {
    LEDGE_RELAY_VAPID_PUBLIC_KEY: publicKey,
    LEDGE_RELAY_VAPID_PRIVATE_KEY: jwk.d as string,
    LEDGE_RELAY_VAPID_SUBJECT: 'mailto:ops@example.com'
  };

  it('has no push without the variables', () => {
    const cfg = loadConfig(FULL);
    if (cfg.mode !== 'accounts') throw new Error('mode');
    expect(cfg.vapid).toBeUndefined();
  });

  it('reads the three variables', () => {
    const cfg = loadConfig({ ...FULL, ...VAPID });
    if (cfg.mode !== 'accounts') throw new Error('mode');
    expect(cfg.vapid).toMatchObject({ publicKey, subject: 'mailto:ops@example.com' });
    expect(cfg.vapid?.privateKey.type).toBe('private');
  });

  it.each(Object.keys(VAPID))('refuses a partial set, without %s', (name) => {
    const env: NodeJS.ProcessEnv = { ...FULL, ...VAPID };
    delete env[name];
    expect(failure(env).message).toContain('LEDGE_RELAY_VAPID');
  });

  it('refuses invalid keys and subjects, naming the variable and never the value', () => {
    const e1 = failure({ ...FULL, ...VAPID, LEDGE_RELAY_VAPID_PUBLIC_KEY: Buffer.alloc(64, 1).toString('base64url') });
    expect(e1.message).toContain('LEDGE_RELAY_VAPID_PUBLIC_KEY');
    expect(failure({ ...FULL, ...VAPID, LEDGE_RELAY_VAPID_PUBLIC_KEY: Buffer.alloc(65, 4).toString('base64url') }).message).toContain('LEDGE_RELAY_VAPID_PUBLIC_KEY');
    const e2 = failure({ ...FULL, ...VAPID, LEDGE_RELAY_VAPID_PRIVATE_KEY: Buffer.alloc(31, 1).toString('base64url') });
    expect(e2.message).toContain('LEDGE_RELAY_VAPID_PRIVATE_KEY');
    expect(e2.message).not.toContain(jwk.d as string);
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
    expect(failure({ ...FULL, ...VAPID, LEDGE_RELAY_VAPID_PRIVATE_KEY: other.d as string }).message).toContain('LEDGE_RELAY_VAPID');
    expect(failure({ ...FULL, ...VAPID, LEDGE_RELAY_VAPID_SUBJECT: 'ops@example.com' }).message).toContain('LEDGE_RELAY_VAPID_SUBJECT');
  });
});
