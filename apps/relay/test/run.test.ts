import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DevicePollResponseSchema, DeviceStartResponseSchema } from '@ledge/protocol';
import type { AccountsConfig } from '../src/config.js';
import { DatabaseOpenError } from '../src/database.js';
import { ListenError, startRelay } from '../src/run.js';
import { fakeGitHub } from './fakeGithub.js';

const dirs: string[] = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'relay-run-')); dirs.push(d); return d; };
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

const configFor = (dir: string): AccountsConfig => ({
  mode: 'accounts', port: 0, database: { kind: 'pglite', dir }, clientId: 'id', clientSecret: 'secret',
  allowed: new Set(['1']), publicUrl: 'http://127.0.0.1:0'
});
const quiet = { host: '127.0.0.1', log: () => {} };

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (rel: string): Promise<void> => {
    for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
      const p = join(rel, e.name);
      if (e.isDirectory()) { out[`${p}/`] = ''; await walk(p); } else out[p] = (await readFile(join(dir, p))).toString('base64');
    }
  };
  await walk('');
  return out;
}

describe('startRelay', () => {
  it('starts on pglite, and a session survives a restart', async () => {
    const dir = join(await tmp(), 'db');
    const github = fakeGitHub();
    const first = await startRelay(configFor(dir), { ...quiet, github });
    const base1 = `http://127.0.0.1:${first.port}`;
    const start = DeviceStartResponseSchema.parse(await (await fetch(`${base1}/auth/device/start`, { method: 'POST' })).json());
    github.approve(start.deviceCode, { id: '1', login: 'alice' });
    const poll = DevicePollResponseSchema.parse(await (await fetch(`${base1}/auth/device/poll`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceCode: start.deviceCode })
    })).json());
    if (poll.status !== 'ok') throw new Error('sign-in failed');
    await first.close();

    const second = await startRelay(configFor(dir), { ...quiet, github: fakeGitHub() });
    const me = await fetch(`http://127.0.0.1:${second.port}/auth/me`, { headers: { authorization: `Bearer ${poll.token}` } });
    expect(me.status).toBe(200);
    await second.close();
  }, 60_000);

  it('refuses a database directory it cannot open, and leaves it untouched', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'PG_VERSION'), '99\n');
    await mkdir(join(dir, 'base'));
    await writeFile(join(dir, 'base', 'x'), 'precious');
    const before = await snapshot(dir);
    await expect(startRelay(configFor(dir), { ...quiet, github: fakeGitHub() })).rejects.toSatisfy(
      (e) => e instanceof DatabaseOpenError && e.dir === dir
    );
    expect(await snapshot(dir)).toEqual(before);
  }, 60_000);

  it('reports a taken port', async () => {
    const first = await startRelay(configFor(join(await tmp(), 'db')), { ...quiet, github: fakeGitHub() });
    const second = { ...configFor(join(await tmp(), 'db')), port: first.port };
    await expect(startRelay(second, { ...quiet, github: fakeGitHub() })).rejects.toSatisfy(
      (e) => e instanceof ListenError && e.code === 'EADDRINUSE'
    );
    await first.close();
  }, 60_000);
});
