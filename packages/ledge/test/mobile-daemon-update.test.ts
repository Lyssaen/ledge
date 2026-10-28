import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PhoneServerMessageSchema, type ServerMessage } from '@ledge/protocol';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { flush, setup, stopAll } from './helpers/gateway.js';

afterEach(stopAll);

type G = ReturnType<typeof setup>;
const rp = { rpId: 'relay.test', origin: 'https://relay.test' };

/** A gateway whose daemon can update (`canUpdate`) and restart (`canRestart`); `calls` records what reached the updater. */
function make(o: { canUpdate?: boolean; canRestart?: boolean; refuse?: ServerMessage } = {}) {
  const calls: string[] = [];
  const g = setup({
    deps: {
      pc: {
        canUpdate: o.canUpdate ?? true, canRestart: o.canRestart ?? true,
        update: (version, reply) => { calls.push(`update ${version}`); if (o.refuse) reply(o.refuse); },
        restart: reply => { calls.push('restart'); if (o.refuse) reply(o.refuse); }
      }
    }
  });
  return { g, calls };
}

const regOps = new Set<string>();
const enroll = async (g: G) => {
  const auth = softAuthenticator();
  g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
  await flush();
  const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
  if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
  const op = randomUUID();
  regOps.add(op);
  g.send('dev1', { type: 'credential.register', op, credential: auth.create(rp, reg.challenge) });
  await flush();
  return auth;
};
const prepare = async (g: G, action: 'update' | 'restart', version?: string) => {
  const before = g.got('dev1').length;
  g.send('dev1', { type: 'confirm.prepare', purpose: 'pc', action, ...(version ? { version } : {}) });
  await flush();
  return g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge' || x.type === 'error');
};
const challengeOf = async (g: G, action: 'update' | 'restart', version?: string) => {
  const m = await prepare(g, action, version);
  if (m?.type !== 'confirm.challenge') throw new Error('no challenge');
  return m.challenge;
};
/** The final answer of `op`. */
const outcome = (g: G, op: string) => g.results('dev1').filter(r => r.op === op && r.status !== 'received').at(-1);
const send = async (g: G, msg: object) => { const op = randomUUID(); g.send('dev1', { ...msg, op }); await flush(); return outcome(g, op); };

describe('phone gateway: the PC says what it can do', () => {
  it('the snapshot carries daemon.update and daemon.restart as the daemon allows', async () => {
    const daemonOf = async (g: G) => {
      g.send('dev1', { type: 'snapshot.request' });
      await flush();
      const snap = g.got('dev1').find(x => x.type === 'snapshot');
      return snap?.type === 'snapshot' ? snap.daemon : undefined;
    };
    expect(await daemonOf(make().g)).toMatchObject({ update: true, restart: true });
    const clone = await daemonOf(make({ canUpdate: false }).g);
    expect(clone).toMatchObject({ restart: true });
    expect(clone).not.toHaveProperty('update');
    const bare = await daemonOf(setup());
    expect(bare).not.toHaveProperty('update');
    expect(bare).not.toHaveProperty('restart');
  });
});

describe('phone gateway: confirm.prepare for the PC', () => {
  it('needs an action, a version for an update only, a daemon that can, and a credential', async () => {
    const { g } = make({ canUpdate: false });
    expect(await prepare(g, 'restart')).toEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
    await enroll(g);
    expect(await prepare(g, 'update', '1.3.0')).toEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
    expect(await prepare(g, 'restart', '1.3.0')).toEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
    g.send('dev1', { type: 'confirm.prepare', purpose: 'pc' });
    await flush();
    expect(g.got('dev1').at(-1)).toEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
    expect(await prepare(g, 'restart')).toMatchObject({ type: 'confirm.challenge', purpose: 'pc' });
  });
});

describe('phone gateway: daemon.update and daemon.restart', () => {
  it('an update confirmed for its version is applied and handed to the updater', async () => {
    const { g, calls } = make();
    const auth = await enroll(g);
    const ch = await challengeOf(g, 'update', '1.3.0');
    expect(await send(g, { type: 'daemon.update', version: '1.3.0', assertion: auth.get(rp, ch, { counter: 1 }) })).toMatchObject({ status: 'applied' });
    expect(calls).toEqual(['update 1.3.0']);
  });

  it('a challenge for one version covers neither another version nor a restart', async () => {
    const { g, calls } = make();
    const auth = await enroll(g);
    const ch = await challengeOf(g, 'update', '1.3.0');
    expect(await send(g, { type: 'daemon.update', version: '1.4.0', assertion: auth.get(rp, ch, { counter: 1 }) })).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    const ch2 = await challengeOf(g, 'update', '1.3.0');
    expect(await send(g, { type: 'daemon.restart', assertion: auth.get(rp, ch2, { counter: 2 }) })).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(calls).toEqual([]);
  });

  it('refuses without an assertion, a version not newer than the daemon, and an action the daemon cannot do', async () => {
    const { g, calls } = make({ canUpdate: false });
    await enroll(g);
    expect(await send(g, { type: 'daemon.restart' })).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    expect(await send(g, { type: 'daemon.update', version: '1.3.0' })).toMatchObject({ status: 'rejected', reason: 'unavailable' });
    const { g: g2 } = make();
    const auth = await enroll(g2);
    const ch = await challengeOf(g2, 'update', '1.2.3');
    // The running version (1.2.3) and an older one: refused before the challenge is spent.
    expect(await send(g2, { type: 'daemon.update', version: '1.2.3', assertion: auth.get(rp, ch, { counter: 1 }) })).toMatchObject({ status: 'rejected', reason: 'invalid' });
    expect(await send(g2, { type: 'daemon.update', version: '1.0.0', assertion: auth.get(rp, ch, { counter: 1 }) })).toMatchObject({ status: 'rejected', reason: 'invalid' });
    expect(calls).toEqual([]);
  });

  it('a restart confirmed as such is applied; a busy refusal reaches the asker as daemon.failed', async () => {
    const { g, calls } = make({ refuse: { type: 'update.failed', version: '1.2.3', reason: 'busy' } });
    const auth = await enroll(g);
    const ch = await challengeOf(g, 'restart');
    expect(await send(g, { type: 'daemon.restart', assertion: auth.get(rp, ch, { counter: 1 }) })).toMatchObject({ status: 'applied' });
    expect(calls).toEqual(['restart']);
    expect(g.got('dev1').filter(m => m.type === 'daemon.failed')).toEqual([{ type: 'daemon.failed', version: '1.2.3', reason: 'busy' }]);
  });
});

describe('phone gateway: the updater\'s progress', () => {
  it('forwards update.progress and update.failed to the phones, without npm\'s output nor a command', async () => {
    const { g } = make();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    g.gw.forward({ type: 'update.progress', version: '1.3.0', step: 'installing' });
    g.gw.forward({ type: 'update.failed', version: '1.3.0', reason: 'npm-failed', detail: 'EACCES /usr/local/lib/node_modules', command: '/home/u/.nvm/bin/npm i -g @paradow/ledge@1.3.0' });
    await flush();
    const got = g.got('dev1').filter(m => m.type === 'daemon.progress' || m.type === 'daemon.failed');
    expect(got).toEqual([{ type: 'daemon.progress', version: '1.3.0', step: 'installing' }, { type: 'daemon.failed', version: '1.3.0', reason: 'npm-failed' }]);
    for (const m of got) expect(PhoneServerMessageSchema.safeParse(m).success).toBe(true);
    expect(JSON.stringify(got)).not.toContain('/');
  });
});
