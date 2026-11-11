// OpenRig on the paired PC, as the Rigs tab shows it and acts on it (docs/mobile-openrig-contract.md, mockup
// docs/mockups/ledge-mobile-refonte/m4-rigs.html). Beside the store rather than in it: the reads, the two subscriptions and the
// actions of `rigs.*` live and end with the link, and only the last OpenRig state is kept for an offline start.
import { useSyncExternalStore } from 'react';
import {
  PhoneClientMessageSchema, PhoneOpenRigStateSchema, rigActNeedsCheck, seatPlan,
  type Assertion, type Goal, type OpenRigAction, type PhoneClientMessage, type PhoneOpenRigState, type PhoneRigError, type PhoneServerMessage, type RigGraph, type RigSnapshot
} from '@ledge/protocol';
import type { PhoneLink } from '../link/link';
import { getAssertion } from '../link/webauthn';
import { newOperationId, UNCERTAIN_MS } from './operations';
import { localStore } from './storage';
import type { ConfirmRequest, MobileStore } from './store';

type Msg<T extends PhoneServerMessage['type']> = Extract<PhoneServerMessage, { type: T }>;

/** A read of the PC: its data once answered, or why it could not be. `loading`: asked, not answered yet. `at`: when it came (ISO). */
export interface Read<T> { data?: T; error?: PhoneRigError; loading: boolean; at?: string }

export type QueueData = Pick<Msg<'rigs.queue'>, 'rows' | 'closed' | 'truncated'>;
export type PermissionsData = Pick<Msg<'rigs.permissions'>, 'policy' | 'seats'>;

/**
 * An action this phone asked for, from the tap to its end. `checking`: the passkey is asked; `sending`: sent, the PC has not said it has
 * it; `received`: the PC runs it (an action lasts as long as `rig`). Then `done` (the PC's `rigs.done` / `rigs.reseated` / goal answer
 * came: `ok` or not), `rejected` (refused before it ran: `reason`), `cancelled` (Face ID cancelled, nothing sent), `expired` (the
 * check took too long, nothing sent), `unsent` (it could not leave) or `uncertain` (it left, but the PC did not say it has it within
 * `UNCERTAIN_MS`, or the link dropped first: it may have run). An uncertain run still takes the PC's late answer, and goes again with its
 * own op on the next link (the PC replays an op it has seen, never runs it twice).
 */
export type RunPhase = 'checking' | 'sending' | 'received' | 'done' | 'rejected' | 'cancelled' | 'expired' | 'unsent' | 'uncertain';

export type RunSubject =
  | { kind: 'act'; action: OpenRigAction }
  | { kind: 'seats'; rig: string; seats: Record<string, number>; delegation?: 'pairs' | 'all' }
  | { kind: 'goal'; goalId: string; text: string }
  | { kind: 'reply'; goalId: string; replyId: string; text: string };

export interface Run {
  /** The operation's id; a new one for each tap (the PC replays one it has seen). Empty while the passkey is asked. */
  op: string;
  /** This run's own id on the phone, stable from the tap, op or not. */
  id: string;
  subject: RunSubject;
  phase: RunPhase;
  /** A refusal's code (`confirm_required`, `assertion_expired`, `busy`…). */
  reason?: string;
  done?: Msg<'rigs.done'>;
  reseated?: Msg<'rigs.reseated'>;
  sent?: Msg<'rigs.goal.sent'> | Msg<'rigs.goal.replied'>;
  /** When it was tapped and when it ended (ms). */
  startedAt: number;
  endedAt?: number;
}

export interface RigsState {
  /** OpenRig as the PC last said it; the last known one, from this device's storage, before the first answer. */
  state: PhoneOpenRigState | null;
  /** Why the last `rigs.state` could not be read (the state above, if any, is older). */
  error: PhoneRigError | null;
  /** When `state` was received (ISO). */
  at: string | null;
  /** `rigs.state` was asked on this link and not answered yet. */
  loading: boolean;
  graphs: Record<string, Read<RigGraph>>;
  queues: Record<string, Read<QueueData>>;
  permissions: Record<string, Read<PermissionsData>>;
  snapshots: Record<string, Read<RigSnapshot[]>>;
  routing: Read<Msg<'rigs.routing'>['entries']> | null;
  goals: Read<{ goals: Goal[]; partial: boolean }> | null;
  /** This page's actions, oldest first. */
  runs: Run[];
}

/** How the passkey turned out, as a run ends when it is not sent. */
type Signed = { assertion: Assertion } | { phase: 'cancelled' | 'expired' | 'unsent' | 'rejected'; reason?: string };

export interface RigsStore {
  getState(): RigsState;
  subscribe(fn: () => void): () => void;
  /** Follows OpenRig (`rigs.state`): asked once per link while the PC offers it. */
  follow(): void;
  /** Reads a rig's topology, queue and permissions (on opening its view, after an action, « Actualiser »). */
  openRig(rig: string): void;
  readSnapshots(rig: string): void;
  /** A rig's permissions alone: the kernel's « Rigs pilotés » shows each running rig's level. */
  readPermissions(rig: string): void;
  readRouting(): void;
  /** Follows the goals given to Max (`rigs.goals`). */
  followGoals(): void;
  /** Asks `rigs.state` again after an error (« Réessayer »). */
  retry(): void;
  /** An OpenRig action; the passkey is asked first when the contract wants it (`rigActNeedsCheck`). */
  act(action: OpenRigAction): Promise<Run>;
  /** A running rig's seats per role; `check`: with the passkey (a seat leaves, or the PC said one would). */
  reseat(rig: string, seats: Record<string, number>, o?: { delegation?: 'pairs' | 'all'; check?: boolean }): Promise<Run>;
  /** A new goal for Max, or the same `goalId` again (« Renvoyer »). */
  sendGoal(text: string, goalId?: string): Promise<Run>;
  replyGoal(goalId: string, text: string, replyId?: string): Promise<Run>;
  /** Forgets a finished run (its receipt closed). */
  dismiss(id: string): void;
  close(): void;
}

export const RIGS_STATE_KEY = 'ledge.mobile.rigs';
/** A read the PC never answers is taken as `unavailable` after this (the PC itself answers after 30 s). */
export const READ_MS = 35_000;

const idOf = (): string => crypto.randomUUID();
/** A goal's or a reply's id as the PC takes it (`[A-Za-z0-9-]{8,64}`). */
export const newGoalId = (): string => crypto.randomUUID();

const isFinal = (p: RunPhase) => p !== 'checking' && p !== 'sending' && p !== 'received';

function loadKept(storage?: Storage): { state: PhoneOpenRigState; at: string } | null {
  try {
    const raw = localStore(storage)?.getItem(RIGS_STATE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { state?: unknown; at?: unknown };
    const state = PhoneOpenRigStateSchema.safeParse(v.state);
    return state.success && typeof v.at === 'string' ? { state: state.data, at: v.at } : null;
  } catch { return null; }
}

export function createRigs(link: PhoneLink, store: MobileStore, storage?: Storage): RigsStore {
  const kept = loadKept(storage);
  let state: RigsState = {
    state: kept?.state ?? null, error: null, at: kept?.at ?? null, loading: false,
    graphs: {}, queues: {}, permissions: {}, snapshots: {}, routing: null, goals: null, runs: []
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<RigsState>) => { state = { ...state, ...patch }; for (const fn of [...listeners]) fn(); };
  let closed = false;
  /** What the screens asked to follow; asked again on each new link. */
  let wantState = false;
  let wantGoals = false;
  let stateAsked = false;
  let goalsAsked = false;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** The messages of the runs not ended, by op: sent again on a new link (the PC replays an op it has seen). */
  const inFlight = new Map<string, PhoneClientMessage>();
  /** Each run's end, awaited by its `act` / `reseat` / goal call. */
  const ends = new Map<string, (r: Run) => void>();

  const ready = () => !closed && link.state() === 'ready';
  const offered = () => !!store.getState().daemon?.rigs;
  const send = (m: PhoneClientMessage) => { void link.send(m).catch(() => undefined); };

  /** A read, with its own timeout: unanswered, it turns `unavailable`. */
  function read(key: string, m: PhoneClientMessage, onTimeout: () => void): boolean {
    if (!ready() || !offered()) return false;
    send(m);
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); onTimeout(); }, READ_MS));
    return true;
  }
  const answered = (key: string) => { clearTimeout(timers.get(key)); timers.delete(key); };

  const loadingOf = <T>(r: Read<T> | undefined): Read<T> => ({ ...(r ?? {}), loading: true });
  const unavailable = <T>(r: Read<T> | undefined): Read<T> => ({ ...(r ?? {}), loading: false, error: 'unavailable' });

  function askState() {
    if (stateAsked) return;
    if (read('state', { type: 'rigs.state' }, () => { stateAsked = false; set({ loading: false, error: 'unavailable' }); })) {
      stateAsked = true;
      set({ loading: true });
    }
  }
  function askGoals() {
    if (goalsAsked) return;
    if (read('goals', { type: 'rigs.goals' }, () => { goalsAsked = false; set({ goals: unavailable(state.goals ?? undefined) }); })) {
      goalsAsked = true;
      set({ goals: loadingOf(state.goals ?? undefined) });
    }
  }
  const resume = () => {
    if (wantState) askState();
    if (wantGoals) askGoals();
  };

  function patchRun(id: string, f: (r: Run) => Run) {
    const at = state.runs.findIndex(r => r.id === id);
    if (at < 0) return;
    const next = f(state.runs[at]!);
    set({ runs: state.runs.map((r, i) => (i === at ? next : r)) });
    if (isFinal(next.phase)) {
      if (next.op && next.phase !== 'uncertain') inFlight.delete(next.op);
      const end = ends.get(id);
      ends.delete(id);
      end?.(next);
    }
  }
  const runOfOp = (op: string) => state.runs.find(r => r.op === op);
  /** A run the PC may still answer: under way, or uncertain (its answer may come late, or after the next link). */
  const open = (r: Run | undefined): r is Run => !!r && (!isFinal(r.phase) || r.phase === 'uncertain');
  const end = (op: string, patch: Partial<Run>) => {
    const r = runOfOp(op);
    answered(`op:${op}`);
    if (open(r)) patchRun(r.id, x => ({ ...x, ...patch, endedAt: Date.now() }));
  };
  /** Sent and not received by the PC after `UNCERTAIN_MS`: the run stops waiting, uncertain. */
  const armAnswer = (op: string) => {
    clearTimeout(timers.get(`op:${op}`));
    timers.set(`op:${op}`, setTimeout(() => {
      timers.delete(`op:${op}`);
      const r = runOfOp(op);
      if (r?.phase === 'sending') patchRun(r.id, x => ({ ...x, phase: 'uncertain', endedAt: Date.now() }));
    }, UNCERTAIN_MS));
  };

  /** After an action that touched a rig, its view is read again (the state itself is pushed). */
  const reread = (s: RunSubject) => {
    const rig = s.kind === 'seats' ? s.rig : s.kind === 'act' && 'rig' in s.action ? s.action.rig : null;
    if (rig && (state.graphs[rig] || state.queues[rig])) store_.openRig(rig);
    if (rig && state.snapshots[rig]) store_.readSnapshots(rig);
  };

  function onMessage(m: PhoneServerMessage) {
    switch (m.type) {
      case 'snapshot':
        resume();
        return;
      case 'rigs.state':
        answered('state');
        stateAsked = wantState;
        if (m.state) {
          const at = new Date().toISOString();
          set({ state: m.state, error: null, at, loading: false });
          try { localStore(storage)?.setItem(RIGS_STATE_KEY, JSON.stringify({ state: m.state, at })); } catch { /* the live state still works */ }
        } else set({ error: m.error ?? 'unavailable', loading: false });
        return;
      case 'rigs.graph':
        answered(`graph:${m.rig}`);
        set({ graphs: { ...state.graphs, [m.rig]: m.graph ? { data: m.graph, loading: false, at: new Date().toISOString() } : { ...state.graphs[m.rig], loading: false, error: m.error ?? 'unavailable' } } });
        return;
      case 'rigs.queue':
        answered(`queue:${m.rig}`);
        set({ queues: { ...state.queues, [m.rig]: m.error ? { ...state.queues[m.rig], loading: false, error: m.error } : { data: { rows: m.rows, closed: m.closed, truncated: m.truncated }, loading: false, at: new Date().toISOString() } } });
        return;
      case 'rigs.permissions':
        answered(`permissions:${m.rig}`);
        set({ permissions: { ...state.permissions, [m.rig]: m.error ? { ...state.permissions[m.rig], loading: false, error: m.error } : { data: { ...(m.policy !== undefined ? { policy: m.policy } : {}), seats: m.seats }, loading: false, at: new Date().toISOString() } } });
        return;
      case 'rigs.snapshots':
        answered(`snapshots:${m.rig}`);
        set({ snapshots: { ...state.snapshots, [m.rig]: m.error ? { ...state.snapshots[m.rig], loading: false, error: m.error } : { data: m.snapshots, loading: false, at: new Date().toISOString() } } });
        return;
      case 'rigs.routing':
        answered('routing');
        set({ routing: m.error ? { ...state.routing, loading: false, error: m.error } : { data: m.entries, loading: false, at: new Date().toISOString() } });
        return;
      case 'rigs.goals':
        answered('goals');
        // An answer that failed leaves the goals to ask again (« Réessayer »).
        goalsAsked = wantGoals && !m.error;
        set({ goals: m.error ? { ...state.goals, loading: false, error: m.error } : { data: { goals: m.goals, partial: !!m.partial }, loading: false, at: new Date().toISOString() } });
        return;
      case 'operation.result': {
        const r = runOfOp(m.op);
        if (!open(r)) return;
        if (m.status === 'received') {
          answered(`op:${m.op}`);
          // The PC has it and always sends its end; an uncertain run waits for it again.
          if (r.phase === 'sending' || r.phase === 'uncertain') patchRun(r.id, x => { const { endedAt: _e, ...rest } = x; return { ...rest, phase: 'received' }; });
          return;
        }
        // A refusal before it ran: its detail (`rigs.done`…) follows, but the run already says why.
        if (m.status === 'rejected') end(m.op, { phase: 'rejected', reason: m.reason ?? 'invalid' });
        // `applied` and `failed` wait for the detail, which carries the commands and OpenRig's words.
        return;
      }
      case 'rigs.done': {
        const r = runOfOp(m.op);
        if (r) { end(m.op, m.rejected ? { phase: 'rejected', reason: m.rejected, done: m } : { phase: 'done', done: m, ...(m.error ? { reason: m.error } : {}) }); reread(r.subject); }
        return;
      }
      case 'rigs.reseated': {
        const r = runOfOp(m.op);
        if (r) { end(m.op, m.rejected ? { phase: 'rejected', reason: m.rejected, reseated: m } : { phase: 'done', reseated: m, ...(m.error ? { reason: m.error } : {}) }); reread(r.subject); }
        return;
      }
      case 'rigs.goal.sent': case 'rigs.goal.replied':
        end(m.op, m.rejected ? { phase: 'rejected', reason: m.rejected, sent: m } : { phase: 'done', sent: m, ...(m.error ? { reason: m.error } : {}) });
        return;
      default:
    }
  }

  let wasReady = ready();
  /** Counts the links: a message that could not leave on one link may have gone with the resend of the next. */
  let linkGen = 0;
  const offState = link.subscribe(() => {
    const at = link.state();
    if (at === 'unpaired' || at === 'pairing') forget();
    const now = ready();
    if (now && !wasReady) {
      wasReady = true;
      linkGen++;
      // A new link: the subscriptions are asked again, and the runs whose end never came go again with their own op.
      stateAsked = false; goalsAsked = false;
      for (const [op, m] of inFlight) { send(m); if (runOfOp(op)?.phase === 'sending') armAnswer(op); }
    } else if (!now && wasReady) {
      wasReady = false;
      stateAsked = false; goalsAsked = false;
      for (const [k, t] of timers) { clearTimeout(t); timers.delete(k); }
      // What the PC had not said it has may or may not have reached it: those runs stop waiting, uncertain.
      set({ loading: false });
      for (const r of state.runs) if (r.phase === 'sending' && r.op) patchRun(r.id, x => ({ ...x, phase: 'uncertain', endedAt: Date.now() }));
    }
  });
  const offMessage = link.onMessage(onMessage);

  /** The link has no PC any more: nothing of the old PC's OpenRig is kept. */
  function forget() {
    if (!state.state && !state.runs.length && !Object.keys(state.graphs).length) return;
    try { localStore(storage)?.removeItem(RIGS_STATE_KEY); } catch { /* nothing kept */ }
    inFlight.clear();
    set({ state: null, error: null, at: null, loading: false, graphs: {}, queues: {}, permissions: {}, snapshots: {}, routing: null, goals: null, runs: [] });
  }

  /** The passkey over `prep`, or why the run ends here. */
  async function sign(prep: ConfirmRequest): Promise<Signed> {
    if (!store.getState().device?.confirm) return { phase: 'rejected', reason: 'confirm_required' };
    let challenge: Msg<'confirm.challenge'>;
    try { challenge = await store.prepareConfirm(prep); } catch (e) { return { phase: e instanceof Error && e.message === 'timeout' ? 'expired' : 'unsent' }; }
    if (!challenge.credentialId) return { phase: 'rejected', reason: 'confirm_required' };
    const at = Date.now();
    const signed = await getAssertion({ challenge: challenge.challenge, rpId: challenge.rpId, credentialId: challenge.credentialId }).catch(() => 'failed' as const);
    if (signed === 'cancelled') return { phase: 'cancelled' };
    if (signed === 'failed') return { phase: 'unsent' };
    if (Date.now() - at >= challenge.expiresInMs) return { phase: 'expired' };
    return { assertion: signed };
  }

  /** Starts a run: the passkey if `prep`, then the message `build` makes. Resolves with the run once it ended. */
  function run(subject: RunSubject, prep: ConfirmRequest | null, build: (op: string, assertion?: Assertion) => unknown): Promise<Run> {
    const id = idOf();
    const r: Run = { op: '', id, subject, phase: prep ? 'checking' : 'sending', startedAt: Date.now() };
    const done = new Promise<Run>(resolve => ends.set(id, resolve));
    if (!ready() || !offered()) {
      set({ runs: [...state.runs, { ...r, phase: 'unsent', endedAt: Date.now() }] });
      ends.delete(id);
      return Promise.resolve({ ...r, phase: 'unsent' });
    }
    set({ runs: [...state.runs, r] });
    void (async () => {
      let assertion: Assertion | undefined;
      if (prep) {
        const s = await sign(prep);
        if (!('assertion' in s)) { patchRun(id, x => ({ ...x, phase: s.phase, ...(s.reason ? { reason: s.reason } : {}), endedAt: Date.now() })); return; }
        assertion = s.assertion;
      }
      const op = newOperationId();
      const parsed = PhoneClientMessageSchema.safeParse(build(op, assertion));
      if (!parsed.success || !ready()) { patchRun(id, x => ({ ...x, phase: 'unsent', endedAt: Date.now() })); return; }
      inFlight.set(op, parsed.data);
      patchRun(id, x => ({ ...x, op, phase: 'sending' }));
      armAnswer(op);
      const gen = linkGen;
      const left = await link.send(parsed.data).catch(() => false);
      // Not sent, and not sent since by a new link: nothing reached the PC.
      const now = runOfOp(op)?.phase;
      if (!left && gen === linkGen && (now === 'sending' || now === 'uncertain')) {
        answered(`op:${op}`);
        patchRun(id, x => ({ ...x, phase: 'unsent', endedAt: Date.now() }));
      }
    })();
    return done;
  }

  const store_: RigsStore = {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    follow() { wantState = true; askState(); },
    retry() { stateAsked = false; askState(); },
    openRig(rig) {
      const g = `graph:${rig}`, q = `queue:${rig}`, p = `permissions:${rig}`;
      if (read(g, { type: 'rigs.graph', rig }, () => set({ graphs: { ...state.graphs, [rig]: unavailable(state.graphs[rig]) } }))) set({ graphs: { ...state.graphs, [rig]: loadingOf(state.graphs[rig]) } });
      if (read(q, { type: 'rigs.queue', rig }, () => set({ queues: { ...state.queues, [rig]: unavailable(state.queues[rig]) } }))) set({ queues: { ...state.queues, [rig]: loadingOf(state.queues[rig]) } });
      if (read(p, { type: 'rigs.permissions', rig }, () => set({ permissions: { ...state.permissions, [rig]: unavailable(state.permissions[rig]) } }))) set({ permissions: { ...state.permissions, [rig]: loadingOf(state.permissions[rig]) } });
    },
    readSnapshots(rig) {
      if (read(`snapshots:${rig}`, { type: 'rigs.snapshots', rig }, () => set({ snapshots: { ...state.snapshots, [rig]: unavailable(state.snapshots[rig]) } }))) set({ snapshots: { ...state.snapshots, [rig]: loadingOf(state.snapshots[rig]) } });
    },
    readPermissions(rig) {
      const p = `permissions:${rig}`;
      if (read(p, { type: 'rigs.permissions', rig }, () => set({ permissions: { ...state.permissions, [rig]: unavailable(state.permissions[rig]) } }))) set({ permissions: { ...state.permissions, [rig]: loadingOf(state.permissions[rig]) } });
    },
    readRouting() {
      if (read('routing', { type: 'rigs.routing' }, () => set({ routing: unavailable(state.routing ?? undefined) }))) set({ routing: loadingOf(state.routing ?? undefined) });
    },
    followGoals() { wantGoals = true; askGoals(); },
    act(action) {
      return run({ kind: 'act', action }, rigActNeedsCheck(action) ? { purpose: 'rigs', rigAct: action } : null,
        (op, assertion) => ({ type: 'rigs.act', op, action, ...(assertion ? { assertion } : {}) }));
    },
    reseat(rig, seats, o = {}) {
      const nodes = state.state?.rigs.find(r => r.name === rig)?.nodes ?? [];
      // A seat that leaves on the last state read: the passkey at once (the PC still checks the plan it really runs).
      const check = o.check || seatPlan(nodes, seats).remove.length > 0;
      return run({ kind: 'seats', rig, seats, ...(o.delegation ? { delegation: o.delegation } : {}) }, check ? { purpose: 'rigs', rigSeats: { rig, seats } } : null,
        (op, assertion) => ({ type: 'rigs.seats', op, rig, seats, ...(o.delegation ? { delegation: o.delegation } : {}), ...(assertion ? { assertion } : {}) }));
    },
    sendGoal(text, goalId = newGoalId()) {
      return run({ kind: 'goal', goalId, text }, null, op => ({ type: 'rigs.goal.send', op, goalId, text }));
    },
    replyGoal(goalId, text, replyId = newGoalId()) {
      return run({ kind: 'reply', goalId, replyId, text }, null, op => ({ type: 'rigs.goal.reply', op, goalId, replyId, text }));
    },
    dismiss(id) {
      // A closed receipt is no longer followed: an uncertain run's message is not sent again on the next link.
      const r = state.runs.find(x => x.id === id);
      if (r && isFinal(r.phase) && r.op) { inFlight.delete(r.op); answered(`op:${r.op}`); }
      set({ runs: state.runs.filter(x => x.id !== id || !isFinal(x.phase)) });
    },
    close() {
      closed = true;
      offState(); offMessage();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    }
  };
  return store_;
}

export function useRigs(rigs: RigsStore): RigsState {
  return useSyncExternalStore(rigs.subscribe, rigs.getState, rigs.getState);
}
