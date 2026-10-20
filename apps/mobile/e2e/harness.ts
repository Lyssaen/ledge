// The phone's world for the e2e spec and `pnpm serve:local`: the real relay in accounts mode (PGlite, a fake GitHub
// reachable over HTTP) serving the built PWA from apps/mobile/dist, and a fake PC of the same account on it.
import { PGlite } from '@electric-sql/pglite';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DevicePollResponseSchema, DeviceStartResponseSchema, PHONE_PROTOCOL,
  type PhoneClientMessage, type PhoneServerMessage, type PhoneSession
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
  sessions: PhoneSession[];
  /** The `op` of every decision typed into a terminal, in order. */
  typed: string[];
  /** False: decisions are typed but not answered, as when the relay goes down right after one. */
  answer: boolean;
  /** The device check, once a test turns it on: the snapshot then says `device`, and a risky accept needs an assertion. */
  device: DeviceCheck | null;
  /** Replaces a session (or adds it) and tells the phone. */
  update(s: PhoneSession): Promise<void>;
  stop(): void;
}

function runDaemon(pc: FakePc): FakeDaemon {
  const boot = randomUUID();
  let seen = 0;
  let busy = false;
  const d: FakeDaemon = {
    sessions: [waiting()], typed: [], answer: true, device: null,
    async update(s) {
      d.sessions = [...d.sessions.filter((x) => x.id !== s.id), s];
      await pc.send({ type: 'session.updated', session: s });
    },
    stop: () => clearInterval(timer)
  };
  const snapshot = (): PhoneServerMessage => ({
    type: 'snapshot', protocol: PHONE_PROTOCOL, sessions: d.sessions,
    capabilities: { claude: CAPS, codex: CAPS, cursor: CAPS, omp: { freeTextAnswer: false } }, daemon: { version: '0.0.0-e2e', name: PC_NAME, boot },
    ...(d.device ? { device: { confirm: d.device.registered } } : {})
  });
  const handle = async (m: PhoneClientMessage) => {
    if (m.type === 'snapshot.request') return pc.send(snapshot());
    if (m.type === 'session.pending') {
      const s = d.sessions.find((x) => x.id === m.id);
      return s && pc.send({ type: 'session.updated', session: s });
    }
    if (m.type === 'confirm.prepare') {
      const r = d.device?.prepare(m, d.sessions.some((x) => x.id === m.id));
      if (r === undefined) return;
      return pc.send(typeof r === 'string' ? { type: 'error', code: r, request: m.type } : r);
    }
    if (m.type === 'credential.register') {
      const r = d.device?.register(m);
      if (r === undefined) return;
      await pc.send({ type: 'operation.result', op: m.op, status: r === 'applied' ? 'applied' : 'rejected', ...(r === 'applied' ? {} : { reason: r }) });
      return r === 'applied' ? pc.send(snapshot()) : undefined;
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
    const cfg: AccountsConfig = {
      mode: 'accounts', port, databaseUrl: 'pglite://memory', clientId: 'fake', clientSecret: 'fake',
      allowed: new Set([USER.id]), publicUrl: url, webDir
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
