import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { LaunchFileError, launchEnv, missingSettings, readLaunchFile, relayHome, writeLaunchFile } from '../src/launch/home.js';
import { generateVapid } from '../src/launch/vapid.js';

const tmpRoot = mkdtempSync(join(tmpdir(), 'ledge-launch-home-'));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));
let n = 0;
const fresh = () => join(tmpRoot, `h${n++}`);

describe('relayHome', () => {
  it('prefers --data, then LEDGE_RELAY_HOME, then ~/.ledge-relay', () => {
    expect(relayHome({ data: '/d', env: { LEDGE_RELAY_HOME: '/e' }, homedir: '/h' })).toBe('/d');
    expect(relayHome({ env: { LEDGE_RELAY_HOME: '/e' }, homedir: '/h' })).toBe('/e');
    expect(relayHome({ env: {}, homedir: '/h' })).toBe(join('/h', '.ledge-relay'));
  });
});

describe('the launch file', () => {
  it('round-trips with private modes', () => {
    const home = fresh();
    const f = { publicUrl: 'https://a.example', allowedGithubIds: ['1'], vapid: { publicKey: 'p', privateKey: 'k', subject: 'mailto:a@b.c' } };
    writeLaunchFile(home, f);
    expect(readLaunchFile(home)).toEqual(f);
    if (process.platform !== 'win32') {
      expect(statSync(home).mode & 0o777).toBe(0o700);
      expect(statSync(join(home, 'config.json')).mode & 0o777).toBe(0o600);
    }
  });

  it('is empty when config.json is absent', () => {
    expect(readLaunchFile(fresh())).toEqual({});
  });

  it.each(['{"publicUrl":', '{"nope":1}'])('refuses %s without echoing it or touching the file', (content) => {
    const home = fresh();
    mkdirSync(home);
    const file = join(home, 'config.json');
    writeFileSync(file, content);
    let err: unknown;
    try { readLaunchFile(home); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(LaunchFileError);
    expect((err as Error).message).toContain(file);
    expect((err as Error).message).not.toContain('nope');
    expect(readFileSync(file, 'utf8')).toBe(content);
  });
});

describe('launchEnv', () => {
  it('lets the environment win over the file, ignoring empty values', () => {
    expect(launchEnv({ publicUrl: 'https://a.example' }, { LEDGE_RELAY_PUBLIC_URL: 'https://b.example' }, '/w'))
      .toMatchObject({ LEDGE_RELAY_PUBLIC_URL: 'https://b.example', LEDGE_RELAY_WEB_DIR: '/w' });
    expect(launchEnv({ publicUrl: 'https://a.example' }, { LEDGE_RELAY_PUBLIC_URL: '' }, '/w').LEDGE_RELAY_PUBLIC_URL)
      .toBe('https://a.example');
  });

  it('maps every field', () => {
    const env = launchEnv({
      githubClientId: 'i', githubClientSecret: 's', allowedGithubIds: ['1', '2'],
      vapid: { publicKey: 'p', privateKey: 'k', subject: 'mailto:a@b.c' }
    }, {}, '/w');
    expect(env).toMatchObject({
      GITHUB_CLIENT_ID: 'i', GITHUB_CLIENT_SECRET: 's', LEDGE_RELAY_ALLOWED_GITHUB_IDS: '1,2',
      LEDGE_RELAY_VAPID_PUBLIC_KEY: 'p', LEDGE_RELAY_VAPID_PRIVATE_KEY: 'k', LEDGE_RELAY_VAPID_SUBJECT: 'mailto:a@b.c'
    });
  });

  it('reports the settings still missing, in order', () => {
    expect(missingSettings(launchEnv({ publicUrl: 'https://a.example' }, {}, '/w'))).toEqual([
      'GitHub OAuth App client id (GITHUB_CLIENT_ID)',
      'GitHub OAuth App client secret (GITHUB_CLIENT_SECRET)',
      'allowed GitHub account (LEDGE_RELAY_ALLOWED_GITHUB_IDS)'
    ]);
  });
});

describe('generateVapid', () => {
  it('feeds loadConfig', () => {
    const web = fresh();
    mkdirSync(web);
    for (const f of ['index.html', 'sw.js', 'build.json', 'manifest.webmanifest']) writeFileSync(join(web, f), '');
    const v = generateVapid('mailto:a@b.c');
    const cfg = loadConfig({
      NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@h/db', GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 'cs',
      LEDGE_RELAY_ALLOWED_GITHUB_IDS: '1', LEDGE_RELAY_PUBLIC_URL: 'https://relay.example', LEDGE_RELAY_WEB_DIR: web,
      LEDGE_RELAY_VAPID_PUBLIC_KEY: v.publicKey, LEDGE_RELAY_VAPID_PRIVATE_KEY: v.privateKey, LEDGE_RELAY_VAPID_SUBJECT: v.subject
    });
    expect(cfg).toBeTruthy();
  });
});
