// The pull and merge requests of the paired PC, as the MR/PR tab shows them and acts on them (docs/mobile-forge-contract.md, mockup
// docs/mockups/ledge-mobile-refonte/m5-mr-pr.html). Beside the store rather than in it, like the Rigs tab: the list is followed from the
// app's opening while the PC offers it (the tab's badge and « À toi » need it), a request's detail is read on demand, and every action
// writes on the forge under the user's name, so each goes through the device's check (Q54).
import { useSyncExternalStore } from 'react';
import {
  PhoneClientMessageSchema, PhoneForgeStateSchema,
  type Assertion, type ForgeAction, type PhoneClientMessage, type PhoneForgeError, type PhoneForgeState, type PhoneServerMessage, type PrDetail
} from '@ledge/protocol';
import type { PhoneLink } from '../link/link';
import { getAssertion } from '../link/webauthn';
import { newOperationId, RESEND_MAX_MS, UNCERTAIN_MS } from './operations';
import { localStore } from './storage';
import type { ConfirmRequest, MobileStore } from './store';

type Msg<T extends PhoneServerMessage['type']> = Extract<PhoneServerMessage, { type: T }>;

/** A request's detail as last read. `cut`: the PC lightened it to fit the phone; `error`: why the last read failed (`data`, if any, is older). */
export interface DetailRead { data?: PrDetail; cut?: boolean; error?: PhoneForgeError; loading: boolean; at?: string }

/**
 * An action this phone asked for, from the tap to its end, as on the Rigs tab: `checking` (the passkey), `sending`, `received`, then
 * `done` (`forge.done` came: `done.ok` or its `error`), `rejected` (refused before it ran: `reason`), `cancelled`, `expired`, `unsent`
 * (nothing left) or `uncertain` (it left, but the PC did not say it has it: it may have run; a late answer still ends it).
 */
export type ForgeRunPhase = 'checking' | 'sending' | 'received' | 'done' | 'rejected' | 'cancelled' | 'expired' | 'unsent' | 'uncertain';

export interface ForgeRun {
  /** The operation's id; empty while the passkey is asked. « Réessayer » after a lost answer sends it again as is. */
  op: string;
  /** This run's own id on the phone, stable from the tap. */
  id: string;
  prId: string;
  action: ForgeAction;
  phase: ForgeRunPhase;
  /** A refusal's code (`confirm_required`, `assertion_expired`, `stale`, `busy`…). */
  reason?: string;
  done?: Msg<'forge.done'>;
  startedAt: number;
  endedAt?: number;
  /** When it first left, and the PC's boot then: its passkey signs that process's challenge, which no other one takes. */
  sentAt?: number;
  boot?: string | null;
  /** It left more than once: a refusal of a later send says nothing of the first one, which may have run. */
  again?: true;
  /** An uncertain run the PC can no longer settle (it restarted, or the run is too old to be sent again): nothing is sent again. */
  lost?: true;
}

export interface ForgeState {
  /** The requests as the PC last said them; the last known ones, from this device's storage, before the first answer. */
  state: PhoneForgeState | null;
  /** When `state` was received (ISO): « relevé 14:12 », and the time of an offline list. */
  at: string | null;
  /** `forge.state` was asked on this link and not answered yet. */
  loading: boolean;
  details: Record<string, DetailRead>;
  /** This page's actions, oldest first. */
  runs: ForgeRun[];
  /** The texts not posted yet, by `draftKey`: they stay in their field until they leave or are erased. */
  drafts: Record<string, string>;
}

export interface ForgeStore {
  getState(): ForgeState;
  subscribe(fn: () => void): () => void;
  /** Follows the requests (`forge.state`): asked once per link while the PC offers it. */
  follow(): void;
  /** Reads a request's detail; `log`: a job's id, for its last lines. */
  readDetail(prId: string, log?: string): void;
  /** An action on a request, after the device's check over that very action (Q54). */
  act(prId: string, action: ForgeAction): Promise<ForgeRun>;
  /** Sends an uncertain run again under its own op, without a second check (the PC replays an op it has seen). */
  resend(id: string): void;
  setDraft(key: string, text: string): void;
  /** Forgets a finished run (its receipt closed). */
  dismiss(id: string): void;
  close(): void;
}

export const FORGE_STATE_KEY = 'ledge.mobile.forge';
/** A `forge.state` the PC never answers stops loading after this. */
export const READ_MS = 35_000;
/** A detail the PC never answers is taken as `failed` after this: the PC itself gives `gh` or `glab` 60 s. */
export const DETAIL_MS = 65_000;

/** Where a text not posted yet is kept: a request's own comment, or a reply in one of its threads. */
export const draftKey = (prId: string, threadId?: string): string => (threadId ? `${prId}\n${threadId}` : prId);

const isFinal = (p: ForgeRunPhase) => p !== 'checking' && p !== 'sending' && p !== 'received';
/** A run the PC may still answer: under way, or uncertain and not lost. */
const open = (r: ForgeRun | undefined): boolean => !!r && (!isFinal(r.phase) || (r.phase === 'uncertain' && !r.lost));
/** The refusals a send again may get for itself, whatever became of the first send: another process's check, or an op it does not take. */
const RESENT_REFUSALS = new Set(['assertion_invalid', 'assertion_expired', 'confirm_required', 'conflict']);

function loadKept(storage?: Storage): { state: PhoneForgeState; at: string } | null {
  try {
    const raw = localStore(storage)?.getItem(FORGE_STATE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { state?: unknown; at?: unknown };
    const state = PhoneForgeStateSchema.safeParse(v.state);
    return state.success && typeof v.at === 'string' ? { state: state.data, at: v.at } : null;
  } catch { return null; }
}

export function createForge(link: PhoneLink, store: MobileStore, storage?: Storage): ForgeStore {
  const kept = loadKept(storage);
  let state: ForgeState = { state: kept?.state ?? null, at: kept?.at ?? null, loading: false, details: {}, runs: [], drafts: {} };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ForgeState>) => { state = { ...state, ...patch }; for (const fn of [...listeners]) fn(); };
  let closed = false;
  let want = false;
  let asked = false;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** The messages of the runs the PC may still answer, by op: sent again on a new link. */
  const inFlight = new Map<string, PhoneClientMessage>();
  const ends = new Map<string, (r: ForgeRun) => void>();
  /** Counts the links: a message that could not leave on one link may have gone with the resend of the next. */
  let linkGen = 0;
  /** The PC's boot of this link, from its snapshot (null when it sends none); `undefined` until the snapshot of a new link. */
  let boot: string | null | undefined = store.getState().daemon ? (store.getState().daemon?.boot ?? null) : undefined;
  /** The ops sent on this link before its snapshot named the PC's boot. */
  const early = new Set<string>();

  const ready = () => !closed && link.state() === 'ready';
  const offered = () => !!store.getState().daemon?.forge;
  const send = (m: PhoneClientMessage) => { void link.send(m).catch(() => undefined); };
  const arm = (key: string, ms: number, f: () => void) => {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); f(); }, ms));
  };
  const answered = (key: string) => { clearTimeout(timers.get(key)); timers.delete(key); };

  function ask() {
    if (asked || !want || !ready() || !offered()) return;
    asked = true;
    send({ type: 'forge.state' });
    set({ loading: true });
    arm('state', READ_MS, () => { asked = false; set({ loading: false }); });
  }

  const runOfOp = (op: string) => state.runs.find(r => r.op === op);
  function patchRun(id: string, f: (r: ForgeRun) => ForgeRun) {
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
  /**
   * Whether a run that left may go again under its op: the PC keeps its operations in memory, and the passkey signed the challenge of
   * the process it was first sent to. Under another boot, or once too old for the PC to still hold it, a send again would be refused or
   * run as new: the run stays uncertain for good.
   */
  const resendable = (r: ForgeRun): boolean =>
    r.sentAt !== undefined && Date.now() - r.sentAt < RESEND_MAX_MS && boot !== undefined && (r.boot ?? null) === boot;
  /** Gives up on a run the PC can no longer settle: uncertain, never sent again. */
  const lose = (r: ForgeRun) => {
    answered(`op:${r.op}`);
    inFlight.delete(r.op);
    patchRun(r.id, x => ({ ...x, phase: 'uncertain', lost: true, endedAt: x.endedAt ?? Date.now() }));
  };
  /** Sends again, under their own op, the runs of the last link the PC may still settle; the others are lost. `here`: sent on this link. */
  function resendAll(here: ReadonlySet<string>) {
    for (const [op, m] of [...inFlight]) {
      const r = runOfOp(op);
      if (!r) { inFlight.delete(op); continue; }
      if (here.has(op)) continue;
      if (!resendable(r)) { lose(r); continue; }
      patchRun(r.id, x => ({ ...x, again: true }));
      send(m);
      if (r.phase === 'sending') armAnswer(op);
    }
  }
  const end = (op: string, patch: Partial<ForgeRun>) => {
    answered(`op:${op}`);
    const r = runOfOp(op);
    if (r && open(r)) patchRun(r.id, x => ({ ...x, ...patch, endedAt: Date.now() }));
  };
  /** Sent and not received by the PC after `UNCERTAIN_MS`: the run stops waiting, uncertain. */
  const armAnswer = (op: string) => arm(`op:${op}`, UNCERTAIN_MS, () => {
    const r = runOfOp(op);
    if (r?.phase === 'sending') patchRun(r.id, x => ({ ...x, phase: 'uncertain', endedAt: Date.now() }));
  });

  function onMessage(m: PhoneServerMessage) {
    switch (m.type) {
      case 'snapshot': {
        // The snapshot says which process answers this link: what the last one may have run is sent again only to that same one.
        // A new boot on the same link (the PC restarted behind the relay) loses what the old process held, as a new link would.
        // A run that left on this link before its snapshot went to the process the snapshot names: it takes that boot, and is not
        // sent again (review fddba15e, dev-front's 898c81a3 for the Rigs tab).
        const was = boot;
        boot = m.daemon.boot ?? null;
        const here = new Set(early);
        early.clear();
        for (const op of here) { const r = runOfOp(op); if (r) patchRun(r.id, x => ({ ...x, boot })); }
        if (was === undefined || was !== boot) resendAll(here);
        ask();
        return;
      }
      case 'forge.state': {
        answered('state');
        const at = new Date().toISOString();
        const next: PhoneForgeState = { prs: m.prs, forges: m.forges, followed: m.followed };
        // A request whose head moved is read again if its detail is held (the merge must name the head the person sees).
        const moved = Object.keys(state.details).filter(id => {
          const was = state.details[id]?.data?.pr.headSha;
          const now = next.prs.find(p => p.id === id)?.headSha;
          return was && now && was !== now;
        });
        set({ state: next, at, loading: false });
        try { localStore(storage)?.setItem(FORGE_STATE_KEY, JSON.stringify({ state: next, at })); } catch { /* the live list still works */ }
        for (const id of moved) store_.readDetail(id);
        return;
      }
      case 'forge.detail': {
        answered(`detail:${m.prId}`);
        const was = state.details[m.prId];
        if (m.detail) {
          // A detail read without a log keeps the log read before, while its job is still there.
          const log = m.detail.log ?? (was?.data?.log && m.detail.jobs.some(j => j.id === was.data!.log!.jobId) ? was.data.log : undefined);
          set({ details: { ...state.details, [m.prId]: { data: { ...m.detail, ...(log ? { log } : {}) }, ...(m.cut ? { cut: true } : {}), loading: false, at: new Date().toISOString() } } });
        } else set({ details: { ...state.details, [m.prId]: { ...was, loading: false, error: m.error ?? 'failed' } } });
        return;
      }
      case 'operation.result': {
        const r = runOfOp(m.op);
        if (!r || !open(r)) return;
        if (m.status === 'received') {
          answered(`op:${m.op}`);
          if (r.phase === 'sending' || r.phase === 'uncertain') patchRun(r.id, x => { const { endedAt: _e, ...rest } = x; return { ...rest, phase: 'received' }; });
          return;
        }
        // A send again refused for itself says nothing of the first send, which may have run: uncertain for good.
        if (m.status === 'rejected' && r.again && RESENT_REFUSALS.has(m.reason ?? '')) { lose(r); return; }
        // A refusal before it ran (`stale`, `busy`, the check…): `forge.done` follows, but the run already says why.
        if (m.status === 'rejected') end(m.op, { phase: 'rejected', reason: m.reason ?? 'invalid' });
        return;
      }
      case 'forge.done': {
        const r = runOfOp(m.op);
        if (!r) return;
        // A refusal a send again may get for itself says nothing of the first send; any other end is the action's own, and settles
        // even a lost run (its receipt says its result will show if it comes).
        const forItself = !!m.rejected && RESENT_REFUSALS.has(m.rejected);
        if (forItself && (r.again || r.lost)) { if (!r.lost) lose(r); return; }
        const ending: Partial<ForgeRun> = m.rejected ? { phase: 'rejected', reason: m.rejected, done: m } : { phase: 'done', done: m, ...(m.error ? { reason: m.error } : {}) };
        if (r.lost) {
          inFlight.delete(r.op);
          patchRun(r.id, x => { const { lost: _l, ...rest } = x; return { ...rest, ...ending, endedAt: Date.now() }; });
        } else {
          const first = open(r);
          end(m.op, ending);
          // A refusal may already have ended the run: the detail still lands on it, for its words (`message`).
          if (!first) patchRun(r.id, x => ({ ...x, done: m }));
        }
        // A posted text leaves its field, unless the field was written again meanwhile: that newer text stays.
        if (m.ok && (r.action.kind === 'comment' || r.action.kind === 'reply')) {
          const key = draftKey(r.prId, r.action.kind === 'reply' ? r.action.threadId : undefined);
          if (state.drafts[key]?.trim() === r.action.body) { const { [key]: _gone, ...rest } = state.drafts; set({ drafts: rest }); }
        }
        // After an action, its request is read again; `stale` asks for the new head too.
        if (state.details[r.prId]) store_.readDetail(r.prId);
        return;
      }
      default:
    }
  }

  let wasReady = ready();
  const offState = link.subscribe(() => {
    const at = link.state();
    if (at === 'unpaired' || at === 'pairing') forget();
    const now = ready();
    if (now && !wasReady) {
      wasReady = true;
      linkGen++;
      asked = false;
      // What may still be in flight goes again once this link's snapshot names the PC's boot.
      boot = undefined;
      early.clear();
    } else if (!now && wasReady) {
      wasReady = false;
      asked = false;
      for (const [k, t] of timers) { clearTimeout(t); timers.delete(k); }
      // Reads under way end with the link; what the PC had not said it has may or may not have reached it.
      const details = Object.fromEntries(Object.entries(state.details).map(([k, d]) => [k, d.loading ? { ...d, loading: false } : d]));
      set({ loading: false, details });
      for (const r of state.runs) if (r.phase === 'sending' && r.op) patchRun(r.id, x => ({ ...x, phase: 'uncertain', endedAt: Date.now() }));
    }
  });
  const offMessage = link.onMessage(onMessage);

  /** The link has no PC any more: nothing of the old PC's requests is kept. */
  function forget() {
    if (!state.state && !state.runs.length && !Object.keys(state.details).length && !Object.keys(state.drafts).length) return;
    try { localStore(storage)?.removeItem(FORGE_STATE_KEY); } catch { /* nothing kept */ }
    inFlight.clear();
    set({ state: null, at: null, loading: false, details: {}, runs: [], drafts: {} });
  }

  type Signed = { assertion: Assertion } | { phase: 'cancelled' | 'expired' | 'unsent' | 'rejected'; reason?: string };
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

  /** Sends a run's message; one that could not leave, and did not go with a new link since, ends `unsent`. */
  async function dispatch(id: string, op: string, m: PhoneClientMessage) {
    armAnswer(op);
    const gen = linkGen;
    const left = await link.send(m).catch(() => false);
    const now = runOfOp(op)?.phase;
    if (!left && gen === linkGen && (now === 'sending' || now === 'uncertain')) {
      answered(`op:${op}`);
      patchRun(id, x => ({ ...x, phase: 'unsent', endedAt: Date.now() }));
    }
  }

  const store_: ForgeStore = {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    follow() { want = true; ask(); },
    readDetail(prId, log) {
      if (!ready() || !offered()) return;
      send({ type: 'forge.detail', prId, ...(log ? { log } : {}) });
      set({ details: { ...state.details, [prId]: { ...state.details[prId], loading: true } } });
      arm(`detail:${prId}`, DETAIL_MS, () => set({ details: { ...state.details, [prId]: { ...state.details[prId], loading: false, error: 'failed' } } }));
    },
    act(prId, action) {
      const id = crypto.randomUUID();
      const r: ForgeRun = { op: '', id, prId, action, phase: 'checking', startedAt: Date.now() };
      if (!ready() || !offered()) {
        const run = { ...r, phase: 'unsent' as const, endedAt: Date.now() };
        set({ runs: [...state.runs, run] });
        return Promise.resolve(run);
      }
      const done = new Promise<ForgeRun>(resolve => ends.set(id, resolve));
      set({ runs: [...state.runs, r] });
      void (async () => {
        const s = await sign({ purpose: 'forge', forge: { prId, action } });
        if (!('assertion' in s)) { patchRun(id, x => ({ ...x, phase: s.phase, ...(s.reason ? { reason: s.reason } : {}), endedAt: Date.now() })); return; }
        const op = newOperationId();
        const parsed = PhoneClientMessageSchema.safeParse({ type: 'forge.act', op, prId, action, assertion: s.assertion });
        if (!parsed.success || !ready()) { patchRun(id, x => ({ ...x, phase: 'unsent', endedAt: Date.now() })); return; }
        inFlight.set(op, parsed.data);
        if (boot === undefined) early.add(op);
        patchRun(id, x => ({ ...x, op, phase: 'sending', sentAt: Date.now(), boot: boot ?? null }));
        await dispatch(id, op, parsed.data);
      })();
      return done;
    },
    resend(id) {
      const r = state.runs.find(x => x.id === id);
      const m = r?.op ? inFlight.get(r.op) : undefined;
      if (!r || r.phase !== 'uncertain' || r.lost || !m || !ready()) return;
      if (!resendable(r)) { lose(r); return; }
      patchRun(id, x => { const { endedAt: _e, ...rest } = x; return { ...rest, phase: 'sending', again: true }; });
      void dispatch(id, r.op, m);
    },
    setDraft(key, text) {
      if (text) set({ drafts: { ...state.drafts, [key]: text } });
      else { const { [key]: _gone, ...rest } = state.drafts; set({ drafts: rest }); }
    },
    dismiss(id) {
      const r = state.runs.find(x => x.id === id);
      if (r && isFinal(r.phase) && r.op) inFlight.delete(r.op);
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

export function useForge(forge: ForgeStore): ForgeState {
  return useSyncExternalStore(forge.subscribe, forge.getState, forge.getState);
}
