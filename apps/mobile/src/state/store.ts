// The phone's state: what the PC said about its sessions, kept up to date from the link, and what this phone asked
// of it. Every write is an operation named by a uuid, sent again with that same uuid after a lost connection.
import { useSyncExternalStore } from 'react';
import {
  PhoneClientMessageSchema, type Assertion, type CapabilitiesByTool, type Credential, type PhoneClientMessage, type PhonePending, type PhoneServerMessage,
  type PhoneSession, type ThreadItem
} from '@ledge/protocol';
import type { PhoneLink } from '../link/link';
import { clearOps, expectKey, isLive, isNew, loadOps, newOperationId, pruneOps, resendable, saveOps, UNCERTAIN_MS, type Op, type OpMessage } from './operations';
import { clearLastState, loadLastState, loadReads, saveLastState, saveReads } from './persist';

/** `loading`: asked, not answered yet. `gone`: the PC no longer knows the session. */
export interface ThreadState {
  status: 'loading' | 'ready' | 'gone';
  items: ThreadItem[];
  /** The ids of the items the PC shortened. */
  cut: string[];
  /** Older items were left out. */
  more: boolean;
}

export interface MobileState {
  /** In the PC's order. */
  sessions: Map<string, PhoneSession>;
  threads: Map<string, ThreadState>;
  /** The last lines of each session's terminal. */
  previews: Map<string, string[]>;
  /** Null until the first snapshot of this run: they are not kept on the phone. */
  capabilities: CapabilitiesByTool | null;
  /** What the PC offers for confirming on the device; null until a snapshot, and from a PC that says nothing (lot 5). */
  device: { confirm: boolean } | null;
  daemon: { version: string; name: string } | null;
  /** True from a snapshot until the channel is lost: what is shown is the PC's state now, not the last known one. */
  fresh: boolean;
  /** When the PC last said something about its sessions. */
  syncedAt: string | null;
  ops: Record<string, Op>;
}

/** The request a challenge is asked for, as `session.decide` names it. */
export type PhoneExpect = Extract<PhoneClientMessage, { type: 'session.decide' }>['expect'];
export type ConfirmChallenge = Extract<PhoneServerMessage, { type: 'confirm.challenge' }>;
export type ConfirmRequest = { purpose: 'register' } | { purpose: 'decide'; id: string; expect: PhoneExpect };

/** How long `prepareConfirm` waits for the PC's challenge. */
export const PREPARE_MS = 10_000;
/** How long « Se déconnecter » waits for the PC to confirm that it removed this phone. */
export const FORGET_MS = 5_000;

export type Answer = Extract<PhoneClientMessage, { type: 'session.answer' }>['answers'][number];

/** The request a challenge was prepared for: what the confirmed operation carries as its `expect`, never rebuilt from the current state. */
export interface ConfirmedExpect { key: string; kind: PhonePending['kind']; text: string }

export type Decision = Extract<PhoneClientMessage, { type: 'session.decide' }>['decision'];

export interface MobileStore {
  getState(): MobileState;
  subscribe(fn: () => void): () => void;
  /** Answers the session's request. The op's id, or null when nothing was sent (no request, not ready, already answered). */
  decide(id: string, decision: Decision, opts?: { note?: string; assertion?: Assertion; expect?: ConfirmedExpect }): string | null;
  /** An answer to the session's request when there is one, else an instruction. The op's id, or null when nothing was sent. */
  reply(id: string, text: string, opts?: { assertion?: Assertion; expect?: ConfirmedExpect }): string | null;
  /**
   * Asks the PC for a challenge; resolves on the next `confirm.challenge` of that purpose. Rejects (Error message
   * `error`, `timeout` after `PREPARE_MS`, `not_ready`, `superseded`, `lost`). One is pending at a time: a new call supersedes the old one.
   */
  prepareConfirm(req: ConfirmRequest): Promise<ConfirmChallenge>;
  /** Answers the questions of OMP's dialog `requestId` together, or declines it (`cancel`). The op's id, or null when nothing was sent. */
  answer(id: string, requestId: string, answers: Answer[], opts: { expect: PhoneExpect; cancel?: boolean }): string | null;
  /** Registers the passkey with the PC. The op's id, or null when nothing was sent. */
  registerCredential(c: Credential): string | null;
  interrupt(id: string): string | null;
  /** Marks the session read up to `at` (now by default); the latest mark is sent again after every ready. */
  read(id: string, at?: string): void;
  /** Asks the session's thread; its items then come as the PC pushes them, while the session is watched. */
  openThread(id: string): void;
  /** The session whose thread or terminal the phone shows, or null. */
  watch(id: string | null): void;
  /** Asks the session's request with its whole body. */
  loadPending(id: string): void;
  /**
   * Tells the PC to remove this phone (`device.forget`, not kept as an operation: the state it would belong to is
   * about to be erased) and resolves true on its `applied`. False at once when the link is not ready, and after
   * `FORGET_MS` without an answer, or when the link drops first.
   */
  forgetDevice(): Promise<boolean>;
  /** Stops listening to the link and every timer. */
  close(): void;
}

/** The full body of a request stays when a shortened copy of the same request comes later. */
function keepBody(prev: PhonePending | undefined, next: PhoneSession): PhoneSession {
  const p = next.pending;
  if (!p?.cut || !prev?.body || prev.key === '' || prev.key !== p.key) return next;
  return (prev.body.length > (p.body?.length ?? 0)) ? { ...next, pending: prev } : next;
}

export function createStore(link: PhoneLink, storage?: Storage): MobileStore {
  const last = loadLastState(storage);
  let state: MobileState = {
    sessions: new Map((last?.sessions ?? []).map(s => [s.id, s])),
    threads: new Map(),
    previews: new Map(Object.entries(last?.previews ?? {})),
    capabilities: null,
    device: null,
    daemon: last?.daemon ?? null,
    fresh: false,
    syncedAt: last?.syncedAt ?? null,
    ops: loadOps(storage)
  };
  let reads = loadReads(storage);
  /** The PC's boot id of this run, from its snapshot; null until one, and when the PC sends none. Never cached. */
  let boot: string | null = null;
  /** The last thread opened: asked again after every ready. */
  let lastThread: string | null = null;
  /**
   * The `session.thread` requests not answered yet, oldest first. The PC answers in order, and its `unknown_session`
   * error names no session: it is about the oldest one.
   */
  let threadAsks: string[] = [];
  /** A preview changed since the cache was last written. */
  let previewsDirty = false;
  let closed = false;
  /** The `prepareConfirm` waiting for its challenge. */
  let preparing: { purpose: ConfirmChallenge['purpose']; resolve: (c: ConfirmChallenge) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  const settle = (outcome: ConfirmChallenge | Error) => {
    const p = preparing;
    if (!p) return;
    preparing = null;
    clearTimeout(p.timer);
    if (outcome instanceof Error) p.reject(outcome); else p.resolve(outcome);
  };
  /** The `forgetDevice` waiting for its result. */
  type Forgetting = { op: string; resolve: (applied: boolean) => void; timer: ReturnType<typeof setTimeout>; promise: Promise<boolean> };
  let forgetting: Forgetting | null = null;
  const settleForget = (applied: boolean) => {
    const f = forgetting;
    if (!f) return;
    forgetting = null;
    clearTimeout(f.timer);
    f.resolve(applied);
  };
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const listeners = new Set<() => void>();

  const ready = () => link.state() === 'ready';
  const send = (m: PhoneClientMessage) => { void link.send(m).catch(() => undefined); };

  const notify = () => { for (const fn of [...listeners]) fn(); };
  const set = (patch: Partial<MobileState>) => { state = { ...state, ...patch }; notify(); };
  const persist = () => {
    previewsDirty = false;
    saveLastState({
      sessions: [...state.sessions.values()], previews: Object.fromEntries(state.previews), daemon: state.daemon, syncedAt: state.syncedAt
    }, storage);
  };
  const setOps = (ops: Record<string, Op>) => {
    const kept = pruneOps(ops);
    saveOps(kept, storage);
    set({ ops: kept });
  };
  const patchOp = (id: string, f: (o: Op) => Op) => {
    const o = state.ops[id];
    if (o) setOps({ ...state.ops, [id]: f(o) });
  };

  const stopTimer = (id: string) => { clearTimeout(timers.get(id)); timers.delete(id); };
  const arm = (id: string) => {
    stopTimer(id);
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      if (state.ops[id]?.phase === 'sending') patchOp(id, o => ({ ...o, phase: 'uncertain' }));
    }, UNCERTAIN_MS));
  };

  const askThread = (id: string) => { threadAsks.push(id); send({ type: 'session.thread', id }); };
  const setThread = (id: string, t: ThreadState) => set({ threads: new Map(state.threads).set(id, t) });
  const gone = (threads: Map<string, ThreadState>, id: string) => {
    const t = threads.get(id);
    if (t) threads.set(id, { ...t, status: 'gone' });
  };

  /** Sends again the uncertain operations `pick` keeps and `resendable` allows, oldest first, each as itself. */
  function resend(pick: (o: Op) => boolean) {
    const now = Date.now();
    const live = Object.values(state.ops).filter(o => pick(o) && resendable(o, boot, now)).sort((a, b) => a.at.localeCompare(b.at));
    if (!live.length) return;
    const ops = { ...state.ops };
    for (const o of live) ops[o.op] = { ...o, phase: 'sending' };
    setOps(ops);
    for (const o of live) { send(o.message); arm(o.op); }
  }

  function onReady() {
    // Every operation whose outcome is unknown goes again with its own op: the PC applies it once, and answers it again.
    // An instruction or interrupt too old to be sent again stays uncertain (see RESEND_MAX_MS). Only the answers to a
    // request go now; the others wait for the snapshot, which tells whether the PC restarted (`resendUnnamed`).
    resend(o => expectKey(o.message) !== undefined);
    for (const [id, at] of Object.entries(reads)) send({ type: 'session.read', id, at });
    if (lastThread && state.threads.get(lastThread)?.status !== 'gone') askThread(lastThread);
  }

  function onLost() {
    settleForget(false);
    // Requests sent on the lost channel get no answer.
    threadAsks = [];
    settle(new Error('lost'));
    for (const id of [...timers.keys()]) stopTimer(id);
    const ops = Object.values(state.ops).filter(o => o.phase === 'sending');
    if (ops.length) setOps({ ...state.ops, ...Object.fromEntries(ops.map(o => [o.op, { ...o, phase: 'uncertain' as const }])) });
    if (state.fresh) set({ fresh: false });
  }

  function onMessage(m: PhoneServerMessage) {
    const now = new Date().toISOString();
    switch (m.type) {
      case 'snapshot': {
        const sessions = new Map(m.sessions.map(s => [s.id, keepBody(state.sessions.get(s.id)?.pending, s)]));
        const previews = new Map([...state.previews].filter(([id]) => sessions.has(id)));
        const threads = new Map(state.threads);
        for (const id of threads.keys()) if (!sessions.has(id)) gone(threads, id);
        reads = Object.fromEntries(Object.entries(reads).filter(([id]) => sessions.has(id)));
        saveReads(reads, storage);
        boot = m.daemon.boot ?? null;
        set({ sessions, previews, threads, capabilities: m.capabilities, device: m.device ?? null, daemon: m.daemon, fresh: true, syncedAt: now });
        persist();
        // The instructions and interrupts left uncertain (those in flight on this link are `sending`) go again if this PC may not have applied them.
        if (ready()) resend(o => o.phase === 'uncertain' && expectKey(o.message) === undefined);
        return;
      }
      case 'session.updated': {
        const sessions = new Map(state.sessions).set(m.session.id, keepBody(state.sessions.get(m.session.id)?.pending, m.session));
        set({ sessions, syncedAt: now });
        persist();
        return;
      }
      case 'session.removed': {
        const sessions = new Map(state.sessions);
        sessions.delete(m.id);
        const previews = new Map(state.previews);
        previews.delete(m.id);
        const threads = new Map(state.threads);
        gone(threads, m.id);
        if (m.id in reads) { const { [m.id]: _drop, ...rest } = reads; reads = rest; saveReads(reads, storage); }
        set({ sessions, previews, threads, syncedAt: now });
        persist();
        return;
      }
      case 'session.pending': {
        const s = state.sessions.get(m.id);
        if (!s) return;
        set({ sessions: new Map(state.sessions).set(m.id, { ...s, pending: m.pending }) });
        persist();
        return;
      }
      case 'session.preview':
        // A watched terminal sends these often: the cache takes them with its next write, or at close.
        set({ previews: new Map(state.previews).set(m.id, m.lines) });
        previewsDirty = true;
        return;
      case 'session.thread': {
        const at = threadAsks.indexOf(m.id);
        if (at >= 0) threadAsks.splice(at, 1);
        setThread(m.id, { status: 'ready', items: m.items, cut: m.cut, more: m.more });
        return;
      }
      case 'session.thread.item': {
        const t = state.threads.get(m.id);
        if (!t || t.status === 'gone') return;
        const at = t.items.findIndex(i => i.id === m.item.id);
        const items = at < 0 ? [...t.items, m.item] : t.items.map((i, n) => n === at ? m.item : i);
        const cut = t.cut.filter(id => id !== m.item.id).concat(m.cut ? [m.item.id] : []);
        setThread(m.id, { ...t, items, cut });
        return;
      }
      case 'operation.result': {
        if (forgetting?.op === m.op) {
          if (m.status !== 'received') settleForget(m.status === 'applied');
          return;
        }
        const o = state.ops[m.op];
        if (!o || !isLive(o.phase)) return;
        if (m.status === 'received') {
          // The PC has it and always sends its outcome after. Should that never come while the link holds, the op
          // stays `sending` until the link drops (then uncertain); an instruction or interrupt stops blocking the
          // next one once older than RESEND_MAX_MS (isNew), an answer once its request is gone.
          stopTimer(m.op);
          patchOp(m.op, x => ({ ...x, phase: 'sending', received: true, ...(boot ? { boot } : {}) }));
          return;
        }
        stopTimer(m.op);
        const { reason: _old, ...rest } = o;
        patchOp(m.op, () => ({ ...rest, received: true, ...(boot ? { boot } : {}), phase: m.status as Op['phase'], ...(m.status !== 'applied' && m.reason ? { reason: m.reason } : {}) }));
        // The request changed under this answer: ask for the one there now, with its body.
        if (m.status === 'rejected' && m.reason === 'stale' && ready() && 'id' in o.message) send({ type: 'session.pending', id: o.message.id });
        return;
      }
      case 'confirm.challenge':
        if (preparing?.purpose === m.purpose) settle(m);
        return;
      case 'error':
        settle(new Error('error'));
        if (m.code === 'unknown_session' && m.request === 'session.thread') {
          const id = threadAsks.shift();
          if (id !== undefined) setThread(id, { items: [], cut: [], more: false, ...state.threads.get(id), status: 'gone' });
        }
        return;
    }
  }

  function write(build: (op: string) => OpMessage): string | null {
    if (closed || !ready()) return null;
    const parsed = PhoneClientMessageSchema.safeParse(build(newOperationId()));
    // A message the PC would refuse as invalid gets an error, not an operation result: it is never sent.
    if (!parsed.success || !('op' in parsed.data)) return null;
    const message = parsed.data as OpMessage;
    if (!isNew(state.ops, message, boot)) return null;
    setOps({ ...state.ops, [message.op]: { op: message.op, message, phase: 'sending', at: new Date().toISOString() } });
    send(message);
    arm(message.op);
    return message.op;
  }

  const expectOf = (p: PhonePending) => ({ key: p.key, kind: p.kind, text: p.text });

  /** The link has no PC any more (forgotten, or pairing a new one): nothing of the old PC is kept or sent again. */
  function forget() {
    const held = state.sessions.size || state.threads.size || state.previews.size || state.daemon || state.capabilities
      || state.device || state.syncedAt || Object.keys(state.ops).length || Object.keys(reads).length || lastThread !== null;
    if (!held) return;
    for (const id of [...timers.keys()]) stopTimer(id);
    reads = {};
    boot = null;
    lastThread = null;
    threadAsks = [];
    settle(new Error('lost'));
    previewsDirty = false;
    clearLastState(storage);
    clearOps(storage);
    set({ sessions: new Map(), threads: new Map(), previews: new Map(), capabilities: null, device: null, daemon: null, fresh: false, syncedAt: null, ops: {} });
  }

  let wasReady = ready();
  const offState = link.subscribe(() => {
    const at = link.state();
    if (at === 'unpaired' || at === 'pairing') forget();
    const now = ready();
    if (now && !wasReady) { wasReady = true; onReady(); }
    else if (!now && wasReady) { wasReady = false; onLost(); }
  });
  const offMessage = link.onMessage(onMessage);
  // Operations left uncertain by the last page are sent again as soon as they can be.
  if (wasReady) onReady();

  return {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },

    decide(id, decision, opts = {}) {
      // An explicit expect is the request the user confirmed: used as is, the PC says whether it is still the one pending.
      const p = state.sessions.get(id)?.pending;
      const expect = opts.expect ?? (p?.key ? expectOf(p) : null);
      if (!expect) return null;
      return write(op => ({ type: 'session.decide', op, id, decision, ...(opts.note !== undefined ? { note: opts.note } : {}), expect, ...(opts.assertion ? { assertion: opts.assertion } : {}) }));
    },

    reply(id, text, opts = {}) {
      const s = state.sessions.get(id);
      if (!s) return null;
      // A request without a key cannot be named: the PC would refuse the reply either way.
      if (!opts.expect && s.pending && !s.pending.key) return null;
      const expect = opts.expect ?? (s.pending ? expectOf(s.pending) : null);
      return write(op => ({ type: 'session.reply', op, id, text, expect, ...(opts.assertion ? { assertion: opts.assertion } : {}) }));
    },

    answer(id, requestId, answers, opts) {
      if (!state.sessions.has(id)) return null;
      return write(op => ({ type: 'session.answer', op, id, requestId, answers, ...(opts.cancel ? { cancel: true as const } : {}), expect: opts.expect }));
    },

    prepareConfirm(req) {
      return new Promise<ConfirmChallenge>((resolve, reject) => {
        if (closed || !ready()) { reject(new Error('not_ready')); return; }
        const m = PhoneClientMessageSchema.safeParse({ type: 'confirm.prepare', ...req });
        if (!m.success) { reject(new Error('invalid')); return; }
        settle(new Error('superseded'));
        preparing = { purpose: req.purpose, resolve, reject, timer: setTimeout(() => settle(new Error('timeout')), PREPARE_MS) };
        send(m.data);
      });
    },

    registerCredential(c) {
      return write(op => ({ type: 'credential.register', op, credential: c }));
    },

    forgetDevice() {
      if (closed || !ready()) return Promise.resolve(false);
      // A second call while one waits shares it: one device.forget, one answer.
      if (forgetting) return forgetting.promise;
      let entry!: Forgetting;
      const promise = new Promise<boolean>(resolve => {
        const op = newOperationId();
        entry = { op, resolve, timer: setTimeout(() => settleForget(false), FORGET_MS), promise: null as unknown as Promise<boolean> };
        send({ type: 'device.forget', op });
      });
      entry.promise = promise;
      forgetting = entry;
      return promise;
    },

    interrupt(id) {
      if (!state.sessions.has(id)) return null;
      return write(op => ({ type: 'session.interrupt', op, id }));
    },

    read(id, at = new Date().toISOString()) {
      if (closed) return;
      const m = PhoneClientMessageSchema.safeParse({ type: 'session.read', id, at });
      if (!m.success) return;
      const prev = reads[id];
      if (prev && Date.parse(prev) >= Date.parse(at)) return;
      reads = { ...reads, [id]: at };
      saveReads(reads, storage);
      const s = state.sessions.get(id);
      if (s?.unread) {
        set({ sessions: new Map(state.sessions).set(id, { ...s, unread: false }) });
        persist();
      }
      if (ready()) send(m.data);
    },

    openThread(id) {
      if (closed) return;
      lastThread = id;
      const t = state.threads.get(id);
      setThread(id, { items: t?.items ?? [], cut: t?.cut ?? [], more: t?.more ?? false, status: 'loading' });
      if (ready()) askThread(id);
    },

    watch(id) { if (!closed) send({ type: 'session.watch', id }); },

    loadPending(id) { if (!closed && ready()) send({ type: 'session.pending', id }); },

    close() {
      if (closed) return;
      closed = true;
      settleForget(false);
      settle(new Error('lost'));
      if (previewsDirty) persist();
      offState();
      offMessage();
      for (const id of [...timers.keys()]) stopTimer(id);
      listeners.clear();
    }
  };
}

/** The store's state in a component, re-rendered on every change. */
export function useMobile(store: MobileStore): MobileState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
