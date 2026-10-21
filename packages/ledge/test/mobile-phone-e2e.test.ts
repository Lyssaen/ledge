// The phone protocol end to end: the real relay, a fake device paired and linked, the real daemon over a fake tmux.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PhoneServerMessageSchema, pendingKey, type PhoneServerMessage, type Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import type { Tmux } from '../src/tmux.js';
import { createMobileService, type MobileService } from '../src/mobile/service.js';
import { writeMobileConfig, writeRelaySession } from '../src/mobile/files.js';
import { startTestRelay, TEST_ACCOUNT } from './mobile-relay-harness.js';
import { fakeDevice, type FakeDevice } from './mobile-fake-device.js';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { rpOf } from '../src/mobile/webauthn.js';

const T0 = '2026-10-20T08:00:00.000Z';
const PEER = 'd_bbbbbbbbbbbbbbbb';
/** A hook-sourced Bash request whose command only reads inside the session's folder: low. */
const PENDING = { kind: 'permission', text: 'ls src', tool: 'Bash', source: 'hook' } as const;
/** Claude Code 2.x's dialog for that command, as the terminal draws it. */
const DIALOG = ['x', '─'.repeat(80), ' Bash command', '╌'.repeat(80), ' ls src', '╌'.repeat(80),
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '', ' Esc to cancel · Tab to amend'].join('\n');

function fakeTmux(panes: Record<string, string[]>): Tmux & { sent: string[][] } {
  const sent: string[][] = [];
  return {
    sent,
    async newSession(o) { panes[o.name] = ['']; }, async sendText(n, t) { sent.push(['text', n, t]); }, async sendKeys(n, k) { sent.push(['keys', n, ...k]); },
    async capture(n) { const q = panes[n] ?? ['']; return q.length > 1 ? q.shift()! : q[0]!; },
    async hasSession(n) { return n in panes; }, async listSessions() { return Object.keys(panes); },
    async setOption() {}, async killSession(n) { delete panes[n]; }, attachArgs: n => ['attach', n]
  };
}

async function until(cond: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 6000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 10));
  }
}

const cleanups: Array<() => Promise<void> | void> = [];
const ledgeHome = process.env.LEDGE_HOME;
beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-phone-e2e-')); });
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  if (ledgeHome === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = ledgeHome;
});

/** A signed-in mobile service on the real relay, the daemon over it, and a phone paired, approved and linked. */
async function linked(extra: { panes?: Record<string, string[]>; server?: Partial<Parameters<typeof startServer>[0]>; tmux?: (t: ReturnType<typeof fakeTmux>) => void; localhost?: boolean } = {}) {
  const relay = await startTestRelay();
  cleanups.push(() => relay.relay.close());
  // A passkey needs a secure relay URL, and `localhost` is the one http host the daemon accepts.
  const pcUrl = extra.localhost ? relay.url.replace('127.0.0.1', 'localhost') : relay.url;
  writeMobileConfig({ enabled: true, relayUrl: pcUrl });
  writeRelaySession({ token: relay.pcToken, accountId: TEST_ACCOUNT, login: 'octocat', relayUrl: pcUrl });
  const mobile: MobileService = await createMobileService();
  cleanups.push(() => mobile.stop());
  await until(() => mobile.state().link.state === 'online', 'link online');
  const store = new Store();
  const tmux = fakeTmux(extra.panes ?? { 'ledge-a': [DIALOG, DIALOG, 'Running…'] });
  extra.tmux?.(tmux);
  const srv = await startServer({ store, tmux, port: 0, mobile, ...extra.server, daemon: { version: '0.2.2', install: 'npm', systemd: true } });
  cleanups.push(() => srv.close());

  const phone: FakeDevice = await fakeDevice({ relayUrl: relay.url, token: relay.deviceToken(PEER), peer: PEER, label: 'Pixel 8' });
  cleanups.push(() => phone.close());
  const { result } = await phone.pair();
  await until(() => mobile.state().pairings[0]?.state === 'confirm', 'pairing to confirm');
  await mobile.handle({ type: 'mobile.pairing.approve', id: mobile.state().pairings[0]!.id });
  expect(await result).toBe('ok');
  await phone.hello();
  await until(() => mobile.state().devices[0]?.online === true, 'device linked');
  return { store, tmux, phone, relayUrl: pcUrl };
}

const parsed = (phone: FakeDevice): PhoneServerMessage[] => phone.received.map(t => PhoneServerMessageSchema.parse(JSON.parse(t)));
const results = (phone: FakeDevice) => parsed(phone).flatMap(m => (m.type === 'operation.result' ? [m] : []));

describe('phone protocol end to end', () => {
  it('a snapshot without tmux names; a low decision received then applied, typed once, its replay applied with no key', async () => {
    const { store, tmux, phone } = await linked();
    const session: Session = {
      id: 'a', name: 'Otto', tool: 'claude', cwd: '/w/repo', project: 'repo', title: 'Otto · repo', tmuxSession: 'ledge-a', state: 'waiting_permission',
      pending: { ...PENDING }, helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher'
    };
    store.upsert(session);

    await phone.send(JSON.stringify({ type: 'snapshot.request' }));
    await until(() => phone.received.length >= 1, 'the snapshot');
    const first = PhoneServerMessageSchema.parse(JSON.parse(phone.received[0]!));
    expect(first.type).toBe('snapshot');
    if (first.type !== 'snapshot') return;
    expect(first.sessions.map(s => s.id)).toEqual(['a']);
    for (const s of first.sessions) expect(s).not.toHaveProperty('tmuxSession');
    expect(first.sessions[0]!.pending).toMatchObject({ risk: 'low', key: pendingKey(PENDING) });

    const decide = JSON.stringify({ type: 'session.decide', op: randomUUID(), id: 'a', decision: 'accept', expect: { kind: 'permission', text: 'ls src', key: pendingKey(PENDING) } });
    await phone.send(decide);
    await until(() => results(phone).length >= 2, 'the decision applied');
    expect(results(phone).map(r => r.status)).toEqual(['received', 'applied']);
    expect(tmux.sent).toEqual([['text', 'ledge-a', '1']]);
    expect(store.get('a')?.pending).toBeUndefined();

    await phone.send(decide);
    await until(() => results(phone).length >= 3, 'the replay answered');
    expect(results(phone).at(-1)?.status).toBe('applied');
    expect(tmux.sent).toHaveLength(1);
  }, 20_000);

  it('a signed chat.close closes the sessions of the phone\'s close card, and the phone reads it in chat.history', async () => {
    const panes: Record<string, string[]> = { 'ledge-a': ['> '] };
    const { store, tmux, phone, relayUrl } = await linked({
      panes, localhost: true,
      tmux: t => {
        // A pane leaves once `/exit` is entered, like a session that quits.
        const keys = t.sendKeys.bind(t);
        t.sendKeys = async (n, k) => {
          const prev = t.sent.filter(x => x[1] === n).at(-1);
          await keys(n, k);
          if (!k.includes('Enter') || prev?.[0] !== 'text' || prev[2] !== '/exit') return;
          delete panes[n];
          const s = store.all().find(x => x.tmuxSession === n);
          if (s) store.apply(s.id, { name: 'PaneGone', at: new Date().toISOString(), source: 'pane' });
        };
      },
      server: {
        close: { freeMs: 200, exitMs: 200 },
        agentEnv: async () => ({ ...process.env, FAKE_ANSWER: 'Je la ferme.\n```ledge-close\n{"session": "a"}\n```' }),
        claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))]
      }
    });
    store.upsert({
      id: 'a', name: 'Otto', tool: 'claude', cwd: tmpdir(), project: 'repo', title: 'Otto · repo', tmuxSession: 'ledge-a', state: 'idle',
      helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher'
    });
    const rp = rpOf(relayUrl)!;
    const auth = softAuthenticator();
    const ask = (m: object) => phone.send(JSON.stringify(m));
    const challenge = async (purpose: 'register' | 'close', qid?: string) => {
      const before = parsed(phone).length;
      await ask({ type: 'confirm.prepare', purpose, ...(qid ? { qid } : {}) });
      await until(() => parsed(phone).slice(before).some(m => m.type === 'confirm.challenge'), `the ${purpose} challenge`);
      const m = parsed(phone).slice(before).find(x => x.type === 'confirm.challenge');
      if (m?.type !== 'confirm.challenge') throw new Error('no challenge');
      return m.challenge;
    };
    await ask({ type: 'credential.register', op: randomUUID(), credential: auth.create(rp, await challenge('register')) });
    await until(() => results(phone).some(r => r.status === 'applied'), 'the credential registered');

    const qid = randomUUID();
    await ask({ type: 'chat.ask', qid, text: 'ferme Otto' });
    const closes = () => parsed(phone).flatMap(m => (m.type === 'chat.history' ? m.turns : m.type === 'chat.done' ? [m.turn] : [])).filter(t => t.qid === qid).at(-1)?.closes;
    await until(() => closes() !== undefined, 'the close card');
    expect(closes()).toEqual([{ id: 'a', name: 'Otto', tool: 'claude' }]);

    const op = randomUUID();
    await ask({ type: 'chat.close', op, qid, assertion: auth.get(rp, await challenge('close', qid), { counter: 1 }) });
    await until(() => results(phone).some(r => r.op === op && r.status === 'applied'), 'the close applied');
    await until(() => closes()?.[0]?.closedAt !== undefined, 'the closed row in chat.history');
    expect(closes()?.[0]).toMatchObject({ id: 'a', how: 'exit' });
    expect(store.get('a')?.state).toBe('exited');
    expect(tmux.sent.filter(x => x[0] === 'text')).toEqual([['text', 'ledge-a', '/exit']]);
  }, 20_000);
});
