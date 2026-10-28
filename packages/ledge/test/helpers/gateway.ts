import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { pendingKey, type ClientMessage, type MobileState, type Pending, type PhoneServerMessage, type ServerMessage, type Session, type Task, type Team, type ThreadItem } from '@ledge/protocol';
import { AttachmentStore } from '../../src/daemon/attachments.js';
import { createPhoneGateway } from '../../src/mobile/gateway.js';
import { createChallengeStore } from '../../src/mobile/challenges.js';
import { rpOf, type DeviceCredential } from '../../src/mobile/webauthn.js';

// The phone gateway's test harness, shared by mobile-gateway.test.ts and mobile-teams-ops.test.ts.

export const T0 = '2026-10-20T08:00:00.000Z';
export const T1 = '2026-10-20T09:00:00.000Z';
export const PUSH = { kind: 'permission', text: 'git push', tool: 'Bash', source: 'hook' } as const;
export const LS = { kind: 'permission', text: 'ls src', tool: 'Bash', source: 'hook' } as const;
export const PICK: Pending = { kind: 'question', text: 'Which one?', options: ['red', 'green', 'blue'], source: 'pane' };
/** What the phone sends back as `expect` for request `p`. */
export const seen = (p: Omit<Pending, 'source'> & { source?: Pending['source'] }) => ({ kind: p.kind, text: p.text, key: pendingKey({ source: 'pane', ...p }) });
export const SEEN_LS = seen(LS);

export const mk = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: id, tool: 'claude', cwd: '/w/repo', project: 'repo', title: `t ${id}`, tmuxSession: `ledge-${id}`, state: 'working', helpers: [],
  startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
});

/** A MobileService stand-in: approved devices, sealed texts sent per device, and a hand on its message and change listeners. */
export function fakeMobile(ids: string[], relayUrl = 'https://relay.test') {
  let devices = ids;
  const sent: Array<[string, string]> = [];
  /** How many texts had been sent when each device was revoked: the answer must be among them. */
  const revoked: Array<{ id: string; sentBefore: number }> = [];
  const messageFns = new Set<(d: string, t: string) => void>();
  const changeFns = new Set<() => void>();
  const offline = new Set<string>();
  const pushes = new Map<string, { endpoint: string; p256dh: string; auth: string; key: string }>();
  let relayKey: string | null | undefined = 'K1';
  return {
    sent,
    pushes,
    setRelayKey(k: string | null | undefined) { relayKey = k; for (const fn of changeFns) fn(); },
    setOnline(id: string, on: boolean) { if (on) offline.delete(id); else offline.add(id); for (const fn of changeFns) fn(); },
    revoked,
    receive(deviceId: string, text: string) { for (const fn of messageFns) fn(deviceId, text); },
    setDevices(next: string[]) { devices = next; for (const fn of changeFns) fn(); },
    mobile: {
      async send(deviceId: string, text: string) { sent.push([deviceId, text]); return devices.includes(deviceId); },
      pushOf: (id: string) => pushes.get(id) ?? null,
      setPush(id: string, p: { endpoint: string; p256dh: string; auth: string; key: string } | null) { if (p) pushes.set(id, p); else pushes.delete(id); for (const fn of changeFns) fn(); },
      relayPushKey: () => relayKey,
      async revoke(id: string) { revoked.push({ id, sentBefore: sent.length }); devices = devices.filter(d => d !== id); for (const fn of changeFns) fn(); },
      onMessage(fn: (d: string, t: string) => void) { messageFns.add(fn); return () => { messageFns.delete(fn); }; },
      onChange(fn: () => void) { changeFns.add(fn); return () => { changeFns.delete(fn); }; },
      state: (): MobileState => ({
        enabled: true, relayUrl, account: null, signin: null, signinError: null, link: { state: 'online' },
        devices: devices.map(id => ({ id, label: id, approvedAt: T0, online: !offline.has(id) })), pairings: []
      })
    }
  };
}

export const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

export const stops: Array<() => void> = [];
/** Stops every gateway `setup` made: call it from the test file's `afterEach`. */
export const stopAll = () => { for (const s of stops.splice(0)) s(); };

export function setup(opts: { boot?: string; dispatch?: (msg: ClientMessage, reply: (m: ServerMessage) => void) => Promise<void>; relayUrl?: string; chats?: Parameters<typeof createPhoneGateway>[0]['chats']; relay?: Parameters<typeof createPhoneGateway>[0]['relay']; launchChat?: Parameters<typeof createPhoneGateway>[0]['launchChat']; closeChat?: Parameters<typeof createPhoneGateway>[0]['closeChat']; actChat?: Parameters<typeof createPhoneGateway>[0]['actChat']; teams?: () => Team[]; tasks?: () => Task[]; deps?: Partial<Parameters<typeof createPhoneGateway>[0]>; onChatEnd?: Parameters<typeof createPhoneGateway>[0]['onChatEnd']; devices?: string[]; attachments?: AttachmentStore } = {}) {
  const fm = fakeMobile(opts.devices ?? ['dev1', 'dev2'], opts.relayUrl);
  const clock = { t: 1_000_000 };
  const challenges = createChallengeStore({ now: () => clock.t });
  const creds = new Map<string, DeviceCredential>();
  const stored: string[] = [];
  const sessions = new Map<string, Session>([
    ['a', mk('a', { state: 'waiting_permission', pending: { ...PUSH }, lastReply: { text: 'done', at: T1 } })],
    ['b', mk('b', { state: 'waiting_permission', pending: { ...LS } })],
    ['c', mk('c', { tmuxSession: null })],
    ['q', mk('q', { state: 'waiting_input', pending: { ...PICK, options: [...PICK.options!] } })]
  ]);
  const previews = new Map<string, string[]>([['a', ['$ ls', 'src']]]);
  const threads = new Map<string, ThreadItem[]>([['a', [{ kind: 'message', id: 'm1', at: T0, turn: 0, text: 'hello' }]]]);
  const dispatched: ClientMessage[] = [];
  const logs: string[] = [];
  const dispatch = opts.dispatch ?? (async (msg: ClientMessage) => { dispatched.push(msg); });
  const attachments = opts.attachments ?? new AttachmentStore(join(mkdtempSync(join(tmpdir(), 'ledge-gw-att-')), 'attachments'));
  const gw = createPhoneGateway({
    mobile: fm.mobile,
    attachments,
    ...(opts.chats ? { chats: opts.chats } : {}),
    ...(opts.relay ? { relay: opts.relay } : {}),
    ...(opts.launchChat ? { launchChat: opts.launchChat } : {}),
    ...(opts.closeChat ? { closeChat: opts.closeChat } : {}),
    ...(opts.actChat ? { actChat: opts.actChat } : {}),
    ...(opts.onChatEnd ? { onChatEnd: opts.onChatEnd } : {}),
    ...(opts.teams ? { teams: opts.teams, projectName: (id: string | null) => (id === 'repo' ? 'Repo' : null) } : {}),
    ...(opts.tasks ? { tasks: opts.tasks } : {}),
    sessions: () => [...sessions.values()],
    session: id => sessions.get(id),
    thread: id => threads.get(id),
    preview: id => previews.get(id),
    dispatch: async (msg, reply) => { if (opts.dispatch) dispatched.push(msg); await dispatch(msg, reply); },
    version: '1.2.3',
    boot: opts.boot ?? randomUUID(),
    log: line => logs.push(line),
    now: () => T0,
    rp: () => rpOf(fm.mobile.state().relayUrl),
    challenges,
    credential: id => creds.get(id) ?? null,
    setCredential: (id, c) => { stored.push(id); creds.set(id, c); },
    ...opts.deps
  });
  stops.push(() => gw.stop());
  /** What `deviceId` received, parsed. */
  const got = (deviceId: string): PhoneServerMessage[] => fm.sent.filter(([d]) => d === deviceId).map(([, t]) => JSON.parse(t) as PhoneServerMessage);
  const results = (deviceId: string) => got(deviceId).filter(m => m.type === 'operation.result');
  const send = (deviceId: string, m: unknown) => fm.receive(deviceId, typeof m === 'string' ? m : JSON.stringify(m));
  return { fm, gw, sessions, dispatched, logs, got, results, send, clock, creds, stored, attachments };
}

export const decide = (id: string, decision: 'accept' | 'deny' | 'always', pending: Session['pending'] & object, extra: { key?: string; op?: string } = {}) => ({
  type: 'session.decide', op: extra.op ?? randomUUID(), id, decision, expect: { kind: pending.kind, text: pending.text, key: extra.key ?? pendingKey(pending) }
});
