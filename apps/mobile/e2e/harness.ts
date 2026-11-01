// The phone's world for the e2e spec and `pnpm serve:local`: the real relay in accounts mode (PGlite, a fake GitHub
// reachable over HTTP) serving the built PWA from apps/mobile/dist, and a fake PC of the same account on it.
import { PGlite } from '@electric-sql/pglite';
import { existsSync } from 'node:fs';
import { createPrivateKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DevicePollResponseSchema, DeviceStartResponseSchema, PHONE_PROTOCOL,
  type PhoneRig, type PhoneEscalation, type PhoneThreadItem, type PhoneExchange, type PhoneLedgeDecision, type PhoneChatTurn, type PhoneClientMessage, type PhoneServerMessage, type PhoneSession, type PushSubscription
} from '@ledge/protocol';
import { startAccountsRelay } from '../../relay/src/app';
import type { AccountsConfig } from '../../relay/src/config';
import type { RelayLogEvent } from '../../relay/src/log';
import { fakeGitHub } from '../../relay/test/fakeGithub';
import type { TestRelay } from '../../../packages/ledge/test/mobile-relay-harness';
import { startFakePc, type DeviceCheck, type FakePc } from '../test/fakePc';

/** The GitHub account of the PC and of the phone. */
export const USER = { id: '4242', login: 'desan' };
/** The name the fake PC gives itself in its snapshots. */
export const PC_NAME = 'PC-Desan';
export const WEB_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../dist');

const T = '2026-10-20T08:00:00.000Z';
const CAPS = { freeTextAnswer: true };
const CHAT_ANSWER = 'Otto attend votre accord.';

/** A session waiting on a low-risk command, as the fake PC shows it first. */
export const waiting = (): PhoneSession => ({
  id: 's1', name: 'Otto', tool: 'claude', project: 'ledge', title: 'Otto · ledge', state: 'waiting_permission', helpers: [],
  startedAt: T, lastActivityAt: T, unread: true,
  pending: { key: 'p1', kind: 'permission', text: 'pnpm test', source: 'hook', risk: 'low', riskReason: 'read_only_command' }
});

/**
 * The daemon's side of the fake PC: it answers every `snapshot.request` with `sessions`, and types each decision once,
 * by its `op`, however often the phone sends it; every copy is answered with the same `applied`.
 */
export interface FakeDaemon {
  openrig: boolean;
  rigs: PhoneRig[];
  escalations: PhoneEscalation[];
  ledgeThread: PhoneThreadItem[];
  decisionsToday: PhoneLedgeDecision[];
  exchanges: PhoneExchange[];
  sessions: PhoneSession[];
  /** The `op` of every decision typed into a terminal, in order. */
  typed: string[];
  /** False: decisions are typed but not answered, as when the relay goes down right after one. */
  answer: boolean;
  /** What the snapshot says of the push (`device.push`); null: it says nothing, as a PC of lot 5. `push.subscribe` makes it `on`. */
  push: 'on' | 'off' | 'stale' | 'unavailable' | null;
  /** The subscription of the last `push.subscribe` the PC applied. */
  subscription: PushSubscription | null;
  /** The device check, once a test turns it on: the snapshot then says `device`, and a risky accept needs an assertion. */
  device: DeviceCheck | null;
  /** True: the snapshot says `device.chat`, and the PC answers the chat as scripted (steps, deltas, a relay card, a launch card). */
  chat: boolean;
  /** True: a question gets its steps and its text so far, but no `chat.done` until `finishChat()`. */
  hold: boolean;
  /** The turns of the phone's thread, as the PC keeps them. */
  turns: PhoneChatTurn[];
  /** Ends the held questions in the thread, without telling the phone (its channel may be down); `chat.history` tells. */
  finishChat(): void;
  /** The `qid` of every launch typed, in order. */
  launched: string[];
  /** True: the next answers carry a close card of two sessions (Nova, Lancée, both already in the phone's list) instead of the relay and launch cards. */
  closeCard: boolean;
  /** The `qid` of every close typed, in order. */
  closed: string[];
  /** True: the snapshot says `daemon.sessionClose`, and the PC closes and resumes a session from its page. */
  sessionClose: boolean;
  /** The ids of the sessions closed, then resumed, from their page, in order. */
  ended: string[];
  resumed: string[];
  /** Replaces a session (or adds it) and tells the phone. */
  update(s: PhoneSession): Promise<void>;
  stop(): void;
}

function runDaemon(pc: FakePc): FakeDaemon {
  const boot = randomUUID();
  let seen = 0;
  let busy = false;
  const d: FakeDaemon = {
    openrig: false, rigs: [], escalations: [], ledgeThread: [], decisionsToday: [], exchanges: [], sessions: [waiting()], typed: [], answer: true, device: null, push: null, subscription: null, chat: false, hold: false, turns: [], launched: [], closeCard: false, closed: [], sessionClose: false, ended: [], resumed: [],
    finishChat() { d.turns = d.turns.map((t) => (t.answer === undefined ? finished(t) : t)); },
    async update(s) {
      d.sessions = [...d.sessions.filter((x) => x.id !== s.id), s];
      await pc.send({ type: 'session.updated', session: s });
    },
    stop: () => clearInterval(timer)
  };
  const snapshot = (): PhoneServerMessage => ({
    type: 'snapshot', protocol: PHONE_PROTOCOL, sessions: d.sessions,
    capabilities: { claude: CAPS, codex: CAPS, cursor: CAPS, omp: { freeTextAnswer: false } }, daemon: { version: '0.0.0-e2e', name: PC_NAME, boot, ...(d.sessionClose ? { sessionClose: true as const } : {}), ...(d.openrig ? { openrig: true as const } : {}) },
    ...(d.openrig ? { rigs: d.rigs, escalations: d.escalations, decisionsToday: d.decisionsToday } : {}),
    ...(d.device || d.push || d.chat ? { device: { confirm: d.device ? d.device.registered : true, ...(d.push ? { push: d.push } : {}), ...(d.chat ? { chat: true as const } : {}) } } : {})
  });
  /** The scripted answer: short on purpose, a card is never cut (TOOL_TEXT_MAX). */
  const finished = (t: PhoneChatTurn): PhoneChatTurn => d.closeCard ? ({
    ...t, answer: CHAT_ANSWER, answeredAt: T,
    closes: [{ id: 'nova', name: 'Nova', tool: 'claude' }, { id: 'lancee', name: 'Lancée', tool: 'claude' }]
  }) : ({
    ...t, answer: CHAT_ANSWER, answeredAt: T,
    relay: { id: 'nova', name: 'Nova', tool: 'claude', text: 'Relance les tests.' },
    proposals: [{ project: 'ledge', tool: 'claude', prompt: 'Corriger le badge' }]
  });
  const replace = (t: PhoneChatTurn) => { d.turns = d.turns.map((x) => (x.qid === t.qid ? t : x)); };
  const chatMessage = async (m: PhoneClientMessage) => {
    if (m.type === 'chat.history') return pc.send({ type: 'chat.history', turns: d.turns });
    if (m.type === 'chat.ask') {
      const turn: PhoneChatTurn = { qid: m.qid, question: m.text, askedAt: T, steps: [] };
      d.turns.push(turn);
      await pc.send({ type: 'chat.step', qid: m.qid, step: { kind: 'sessions' } });
      await pc.send({ type: 'chat.step', qid: m.qid, step: { kind: 'pane', id: 's1', name: 'Otto' } });
      await pc.send({ type: 'chat.delta', qid: m.qid, text: 'Otto attend ' });
      await pc.send({ type: 'chat.delta', qid: m.qid, text: CHAT_ANSWER });
      if (d.hold) return;
      const done = finished({ ...turn, steps: [{ kind: 'sessions' }, { kind: 'pane', id: 's1', name: 'Otto' }] });
      replace(done);
      return pc.send({ type: 'chat.done', qid: m.qid, turn: done });
    }
    if (m.type === 'chat.close') {
      const turn = d.turns.find((t) => t.qid === m.qid);
      if (!turn?.closes) return pc.send({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'unknown_session' });
      const refused = d.device?.assertClose(m);
      if (refused) return pc.send({ type: 'operation.result', op: m.op, status: 'rejected', reason: refused });
      d.closed.push(m.qid);
      await pc.send({ type: 'operation.result', op: m.op, status: 'applied' });
      const rows = new Set(m.rows ?? turn.closes.map((_, i) => i));
      const after: PhoneChatTurn = { ...turn, closes: turn.closes.map((c, i) => (rows.has(i) ? { ...c, how: 'exit' as const, closedAt: T } : c)) };
      replace(after);
      return pc.send({ type: 'chat.done', qid: m.qid, turn: after });
    }
    if (m.type === 'chat.relay' || m.type === 'chat.launch') {
      const turn = d.turns.find((t) => t.qid === m.qid);
      if (!turn) return pc.send({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'unknown_session' });
      if (m.type === 'chat.launch') {
        const refused = d.device?.assertLaunch(m);
        if (refused) return pc.send({ type: 'operation.result', op: m.op, status: 'rejected', reason: refused });
        d.launched.push(m.qid);
      }
      await pc.send({ type: 'operation.result', op: m.op, status: 'applied' });
      // The card keeps its button disabled until the PC says what became of it: the updated turn.
      const after: PhoneChatTurn = m.type === 'chat.relay'
        ? { ...turn, relay: { ...turn.relay!, status: 'sent', sentAt: T } }
        : { ...turn, proposals: turn.proposals!.map((p) => ({ ...p, launchedId: 'lancee' })) };
      replace(after);
      for (const id of m.type === 'chat.relay' ? ['nova'] : ['lancee']) {
        if (!d.sessions.some((x) => x.id === id)) {
          const { pending: _none, ...base } = waiting();
          d.sessions.push({ ...base, id, name: id === 'nova' ? 'Nova' : 'Lancée', title: id, state: 'working', unread: false });
        }
      }
      return pc.send({ type: 'chat.done', qid: m.qid, turn: after });
    }
  };
  const handle = async (m: PhoneClientMessage) => {
    if (m.type === 'snapshot.request') return pc.send(snapshot());
    if (d.openrig && m.type === 'ledge.thread.request') return pc.send({ type: 'ledge.thread.history', items: d.ledgeThread });
    if (d.openrig && m.type === 'rig.exchanges.request') return pc.send({ type: 'rig.exchanges', key: m.key, items: d.exchanges.filter(e => e.rigKey === m.key) });
    if (d.openrig && m.type === 'escalation.answer') {
      const current = d.escalations.find(e => e.id === m.id);
      if (!current || current.answer) return pc.send({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'already_answered' });
      const answered: PhoneEscalation = { ...current, state: 'answered', answer: { by: 'user', answers: m.answers, at: new Date().toISOString() } };
      d.escalations = d.escalations.map(e => e.id === m.id ? answered : e);
      await pc.send({ type: 'escalation.updated', escalation: answered });
      const at = answered.answer!.at;
      const text = current.questions.map(q => q.options.find(o => o.id === m.answers[q.id])?.label ?? m.answers[q.id]).join(', ');
      const item: PhoneThreadItem = { kind: 'exchanges', id: `answer-${m.id}`, at, rigKey: current.rigKey!, rigName: current.rigName!, from: at, to: at, count: 1, items: [{ id: `reply-${m.id}`, rigKey: current.rigKey!, from: 'Ledge', to: current.from, kind: 'ledge', text, at }] };
      d.ledgeThread.push(item); await pc.send({ type: 'ledge.thread.item', item });
      return pc.send({ type: 'operation.result', op: m.op, status: 'applied' });
    }
    if (d.openrig && m.type === 'rig.prepare') {
      const plan = { id: 'plan1', spec: m.spec || 'starter', goal: m.goal, where: { kind: 'off-project' as const, name: 'demo' }, seats: [{ address: '@build', runtime: 'codex', autonomy: 'standard' }], writes: ['création du rig'], required: true };
      const item: PhoneThreadItem = { kind: 'plan', id: 'plan-plan1', at: new Date().toISOString(), plan }; d.ledgeThread.push(item);
      await pc.send({ type: 'ledge.thread.item', item }); return pc.send({ type: 'operation.result', op: m.op, status: 'applied' });
    }
    if (d.openrig && (m.type === 'rig.launch' || m.type === 'rig.act')) {
      const refused = d.device?.assertRig(m) ?? (d.device ? undefined : 'confirm_required');
      if (refused) return pc.send({ type: 'operation.result', op: m.op, status: 'rejected', reason: refused });
      if (m.type === 'rig.launch') d.launched.push(m.planId);
      return pc.send({ type: 'operation.result', op: m.op, status: 'applied' });
    }

    if (d.chat && (m.type === 'chat.history' || m.type === 'chat.ask' || m.type === 'chat.relay' || m.type === 'chat.launch' || m.type === 'chat.close')) return chatMessage(m);
    if (m.type === 'session.pending') {
      const s = d.sessions.find((x) => x.id === m.id);
      return s && pc.send({ type: 'session.updated', session: s });
    }
    if (m.type === 'confirm.prepare') {
      const r = d.device?.prepare(m, m.qid ? d.turns.some((t) => t.qid === m.qid) : d.sessions.some((x) => x.id === m.id));
      if (r === undefined) return;
      return pc.send(typeof r === 'string' ? { type: 'error', code: r, request: m.type } : r);
    }
    if (m.type === 'credential.register') {
      const r = d.device?.register(m);
      if (r === undefined) return;
      await pc.send({ type: 'operation.result', op: m.op, status: r === 'applied' ? 'applied' : 'rejected', ...(r === 'applied' ? {} : { reason: r }) });
      return r === 'applied' ? pc.send(snapshot()) : undefined;
    }
    if (m.type === 'push.subscribe') {
      d.subscription = m.subscription;
      d.push = 'on';
      await pc.send({ type: 'operation.result', op: m.op, status: 'applied' });
      return pc.send(snapshot());
    }
    if (m.type === 'push.unsubscribe') {
      d.subscription = null;
      d.push = 'off';
      await pc.send({ type: 'operation.result', op: m.op, status: 'applied' });
      return pc.send(snapshot());
    }
    if (m.type === 'session.close' || m.type === 'session.resume') {
      // As the gateway: the session's state first, then the device check, which spends its challenge.
      const s = d.sessions.find((x) => x.id === m.id);
      const closing = m.type === 'session.close';
      if (!d.sessionClose || !s) return pc.send({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'unknown_session' });
      if (closing === (s.state === 'exited')) return pc.send({ type: 'operation.result', op: m.op, status: 'rejected', reason: closing ? 'ended' : 'busy' });
      const refused = d.device?.assertSession(m);
      if (refused) return pc.send({ type: 'operation.result', op: m.op, status: 'rejected', reason: refused });
      (closing ? d.ended : d.resumed).push(m.id);
      const { pending: _gone, exitedAt: _was, ...rest } = s;
      // As the daemon: a resume starts a new run, with a new `startedAt`; an end keeps it.
      const after: PhoneSession = closing ? { ...rest, state: 'exited', exitedAt: new Date().toISOString() } : { ...rest, state: 'idle', startedAt: new Date().toISOString() };
      d.sessions = d.sessions.map((x) => (x.id === m.id ? after : x));
      await pc.send({ type: 'operation.result', op: m.op, status: 'received' });
      await pc.send({ type: 'session.updated', session: after });
      return pc.send({ type: 'operation.result', op: m.op, status: 'applied', ...(closing ? { how: 'exit' as const } : {}) });
    }
    if (m.type !== 'session.decide') return;
    if (d.typed.includes(m.op)) {
      if (d.answer) await pc.send({ type: 'operation.result', op: m.op, status: 'applied' });
      return;
    }
    const s = d.sessions.find((x) => x.id === m.id);
    if (!s?.pending || s.pending.key !== m.expect.key) return pc.send({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'stale' });
    // As the gateway: a changed request is stale first, then the device check, which spends its challenge.
    if (d.device && m.decision !== 'deny' && s.pending.risk !== 'low') {
      const refused = d.device.assert(m);
      if (refused) return pc.send({ type: 'operation.result', op: m.op, status: 'rejected', reason: refused });
    }
    d.typed.push(m.op);
    const { pending: _answered, ...rest } = s;
    const after: PhoneSession = { ...rest, state: 'working' };
    d.sessions = d.sessions.map((x) => (x.id === m.id ? after : x));
    if (!d.answer) return;
    await pc.send({ type: 'operation.result', op: m.op, status: 'applied' });
    await pc.send({ type: 'session.updated', session: after });
  };
  // The fake PC keeps what the phone sent; each message is handled once, in order. A send that fails (the relay is
  // down) is not tried again: the phone asks again once its channel is back.
  const timer = setInterval(() => {
    if (busy || seen >= pc.received.length) return;
    busy = true;
    void (async () => {
      while (seen < pc.received.length) {
        const m = JSON.parse(pc.received[seen++]!) as PhoneClientMessage;
        await handle(m).catch(() => {});
      }
    })().finally(() => { busy = false; });
  }, 20);
  return d;
}

/** A GitHub authorize page that always says yes: it sends the browser back to the relay with a code for `USER`. */
async function fakeGitHubWeb(github: ReturnType<typeof fakeGitHub>): Promise<{ origin: string; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    const q = new URL(req.url ?? '/', 'http://github').searchParams;
    const back = new URL(q.get('redirect_uri') ?? '');
    back.search = new URLSearchParams({ code: github.codeFor(USER), state: q.get('state') ?? '' }).toString();
    res.writeHead(302, { location: back.toString() });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })
  };
}

export interface Harness {
  /** `http://localhost:<port>`: the relay's public URL, where the phone opens the PWA. */
  url: string;
  pc: FakePc;
  daemon: FakeDaemon;
  /** Every event the relay logged. */
  events: RelayLogEvent[];
  /** Stops the relay: every socket drops without a close frame (1006). */
  stopRelay(): Promise<void>;
  /** Starts the relay again on the same port and database; the fake PC reconnects. */
  startRelay(): Promise<void>;
  close(): Promise<void>;
}

export async function startHarness(opts: { webDir?: string } = {}): Promise<Harness> {
  const webDir = opts.webDir ?? WEB_DIR;
  if (!existsSync(path.join(webDir, 'build.json'))) throw new Error(`no built PWA in ${webDir}: run pnpm --filter @ledge/mobile build first`);
  const github = fakeGitHub();
  const web = await fakeGitHubWeb(github);
  const gh: typeof github = {
    ...github,
    authorizeUrl: (state, redirectUri) => `${web.origin}/login/oauth/authorize?${new URLSearchParams({ state, redirect_uri: redirectUri }).toString()}`
  };
  const db = new PGlite();
  const events: RelayLogEvent[] = [];
  let current: Awaited<ReturnType<typeof startAccountsRelay>> | null = null;
  /** Stops the relay if it runs; the db is closed only after this (apps/relay/src/app.ts). */
  const stopRelay = async () => {
    const app = current;
    current = null;
    await app?.close();
  };
  let pc: FakePc | undefined;
  let daemon: FakeDaemon | undefined;
  /** Everything started so far, in reverse: the relay before its db. */
  const teardown = async () => {
    daemon?.stop();
    await pc?.close();
    await stopRelay();
    await web.close();
    await db.close();
  };

  try {
    // A free port first, so PUBLIC_URL is known before the relay starts, and the same one after every restart.
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const url = `http://localhost:${port}`;
    // The relay pushes when it has a VAPID identity: /push/key answers, which the phone asks before it subscribes.
    const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = keys.privateKey.export({ format: 'jwk' });
    const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]).toString('base64url');
    const cfg: AccountsConfig = {
      mode: 'accounts', port, databaseUrl: 'pglite://memory', clientId: 'fake', clientSecret: 'fake',
      allowed: new Set([USER.id]), publicUrl: url, webDir,
      vapid: { publicKey, privateKey: createPrivateKey({ key: jwk, format: 'jwk' }), subject: 'mailto:e2e@example.com' }
    };

    const startRelay = async () => {
      if (current) throw new Error('relay still running');
      const app = await startAccountsRelay(cfg, { db, github: gh, log: (e) => events.push(e) });
      await new Promise<void>((resolve, reject) => {
        app.server.once('error', reject);
        app.server.listen(port, '127.0.0.1', () => { app.server.off('error', reject); resolve(); });
      });
      current = app;
    };
    await startRelay();

    // The PC signs in as the daemon does: GitHub's device flow, approved at once.
    const post = async (route: string, body?: unknown) => {
      const res = await fetch(`http://127.0.0.1:${port}${route}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {})
      });
      return res.json() as Promise<unknown>;
    };
    const { deviceCode } = DeviceStartResponseSchema.parse(await post('/auth/device/start'));
    github.approve(deviceCode, USER);
    const poll = DevicePollResponseSchema.parse(await post('/auth/device/poll', { deviceCode }));
    if (poll.status !== 'ok') throw new Error(`the PC could not sign in: ${poll.status}`);

    const relay: TestRelay = {
      url: `http://127.0.0.1:${port}`,
      port,
      pcToken: poll.token,
      deviceToken() { throw new Error('the phone signs in with GitHub here'); },
      relay: { close: stopRelay },
      restart: startRelay
    };
    const thePc = await startFakePc({ relay, learnPeer: true });
    pc = thePc;
    daemon = runDaemon(thePc);

    return {
      url, pc: thePc, daemon, events, stopRelay,
      async startRelay() {
        await startRelay();
        await thePc.reconnect();
      },
      close: teardown
    };
  } catch (e) {
    await teardown().catch(() => {});
    throw e;
  }
}

// `pnpm --filter @ledge/mobile serve:local`: the same world, kept running, every pairing approved on the PC.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const h = await startHarness();
  process.stdout.write(`Ledge mobile, local: ${h.url} (GitHub and the PC say yes)\n`);
  let last: string | null = null;
  const approve = async () => {
    const code = await h.pc.code();
    if (code !== last) {
      last = code;
      process.stdout.write(`pairing code ${code}: approved on the PC\n`);
      h.pc.ok();
    }
    setTimeout(() => { void approve(); }, 500);
  };
  void approve();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void h.close().finally(() => process.exit(0)); });
}
