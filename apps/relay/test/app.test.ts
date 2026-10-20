import { PGlite } from '@electric-sql/pglite';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { DevicePollResponseSchema, DeviceStartResponseSchema, parseRelayServerMessage } from '@ledge/protocol';
import { RELAY_PROTOCOL_PREFIX } from '../src/auth.js';
import { startAccountsRelay } from '../src/app.js';
import type { AccountsConfig } from '../src/config.js';
import type { RelayLogEvent } from '../src/log.js';
import { fakeGitHub } from './fakeGithub.js';

let db: PGlite;
beforeAll(async () => { db = new PGlite(); }, 30_000);
afterAll(async () => { await db.close(); });

const cfg: AccountsConfig = {
  mode: 'accounts', port: 0, databaseUrl: 'unused', clientId: 'id', clientSecret: 'secret',
  allowed: new Set(['1']), publicUrl: 'http://127.0.0.1:0'
};

const post = (url: string, body?: unknown) => fetch(url, {
  method: 'POST', headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {})
});

async function listen(app: Awaited<ReturnType<typeof startAccountsRelay>>): Promise<string> {
  await new Promise<void>((res) => app.server.listen(0, '127.0.0.1', res));
  return `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

function welcome(url: string, token: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, [`${RELAY_PROTOCOL_PREFIX}${token}`]);
    ws.once('message', (d) => { resolve(parseRelayServerMessage(JSON.parse(d.toString()))); ws.close(); });
    ws.once('error', reject);
    ws.once('unexpected-response', (_q, r) => reject(new Error(`status ${r.statusCode}`)));
  });
}

describe('startAccountsRelay', () => {
  it('serves /healthz, signs a PC in, and keeps the account across a restart on the same database', async () => {
    const github = fakeGitHub();
    const events: RelayLogEvent[] = [];
    const first = await startAccountsRelay(cfg, { db, github, log: (e) => events.push(e) });
    const host1 = await listen(first);
    expect(await (await fetch(`http://${host1}/healthz`)).text()).toBe('ok');

    const start = DeviceStartResponseSchema.parse(await (await post(`http://${host1}/auth/device/start`)).json());
    github.approve(start.deviceCode, { id: '1', login: 'alice' });
    const poll = DevicePollResponseSchema.parse(await (await post(`http://${host1}/auth/device/poll`, { deviceCode: start.deviceCode })).json());
    if (poll.status !== 'ok') throw new Error('sign-in failed');
    expect(await welcome(`ws://${host1}/ws`, poll.token)).toMatchObject({ type: 'welcome', accountId: '1', self: 'pc' });

    await first.close();
    await db.query('SELECT 1'); // the database outlives the relay

    const second = await startAccountsRelay(cfg, { db, github: fakeGitHub(), log: () => {} });
    const host2 = await listen(second);
    expect(await welcome(`ws://${host2}/ws`, poll.token)).toMatchObject({ type: 'welcome', accountId: '1', self: 'pc' });
    const rows = await db.query<{ login: string }>('SELECT login FROM accounts WHERE github_id = $1', ['1']);
    expect(rows.rows).toEqual([{ login: 'alice' }]);
    await second.close();
  }, 30_000);

  it('flushes the aggregated sign-in refusals on close', async () => {
    const github = fakeGitHub();
    const events: RelayLogEvent[] = [];
    const app = await startAccountsRelay(cfg, { db, github, log: (e) => events.push(e) });
    const host = await listen(app);
    const start = DeviceStartResponseSchema.parse(await (await post(`http://${host}/auth/device/start`)).json());
    github.deny(start.deviceCode);
    await post(`http://${host}/auth/device/poll`, { deviceCode: start.deviceCode });
    expect(events.filter((e) => e.ev === 'sign_in_refused')).toEqual([]);
    await app.close();
    expect(events).toContainEqual({ ev: 'sign_in_refused', reason: 'denied', count: 1 });
  }, 30_000);
});
