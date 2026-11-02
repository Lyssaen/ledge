import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { OpenRigAction, OpenRigDone, OpenRigLaunched, OpenRigReseated, OpenRigRoleFileContent, OpenRigState, RigLaunch, RigSpec, RoleDetail, RoleSummary } from '@ledge/protocol';
import type { DaemonClient } from './client';

/** How often a screen that shows a machine's OpenRig asks it again. */
export const OPENRIG_POLL_MS = 5_000;

export interface OpenRigView {
  /** The machine's OpenRig as last read; null until its first answer. */
  state: OpenRigState | null;
  /** The machine could not answer: `offline`, or `outdated` (its Ledge daemon does not know OpenRig). */
  error?: 'offline' | 'outdated';
  /** The action running on that machine from this front, if any. */
  pending: OpenRigAction | null;
  /** The last action's end, until the next one starts. */
  last: OpenRigDone | null;
  /** Runs an action on the machine; resolves with its end (`ok` false and `error` `busy` when one already runs). */
  act(action: OpenRigAction): Promise<OpenRigDone>;
  /** Asks again now. */
  refresh(): void;
}

let next = 0;

/** A machine whose OpenRig is absent, whose daemon is stopped, or that could not answer is read this often: each read runs `rig status`. */
export const OPENRIG_IDLE_POLL_MS = 60_000;
/** A read this recent is not repeated for a new reader or a window focus. */
const FRESH_MS = 2_000;

type Seen = { state: OpenRigState | null; error?: 'offline' | 'outdated' };
const UNSEEN: Seen = { state: null };
interface Entry { seen: Seen; asked: string | null; askedAt: number; answeredAt: number; readers: Map<number, { pollMs: number; notify: () => void }>; every: number; timer: ReturnType<typeof setTimeout> | null }
interface Store { entries: Map<string, Entry>; off: (() => void) | null; offFocus: (() => void) | null }
const stores = new WeakMap<DaemonClient, Store>();
let reader = 0;

const storeOf = (client: DaemonClient): Store => {
  let s = stores.get(client);
  if (!s) { s = { entries: new Map(), off: null, offFocus: null }; stores.set(client, s); }
  return s;
};
const idle = (e: Entry): boolean => e.seen.error !== undefined || (e.seen.state !== null && (!e.seen.state.installed || e.seen.state.daemon.state !== 'running'));
const everyOf = (e: Entry): number => {
  const fastest = Math.min(...[...e.readers.values()].map(r => r.pollMs));
  return idle(e) ? Math.max(OPENRIG_IDLE_POLL_MS, fastest) : fastest;
};

function ask(client: DaemonClient, machine: string, e: Entry): void {
  const requestId = `openrig-${++next}`;
  e.asked = requestId; e.askedAt = Date.now();
  client.send({ type: 'openrig.status', requestId, machineId: machine });
  plan(client, machine, e);
}
function plan(client: DaemonClient, machine: string, e: Entry): void {
  if (e.timer) clearTimeout(e.timer);
  e.timer = null;
  if (e.readers.size === 0) return;
  e.every = everyOf(e);
  e.timer = setTimeout(() => ask(client, machine, e), e.every);
}

/**
 * One read of a machine's OpenRig for every screen of this client that shows it (the OpenRig page, the sidebar, the TUI): a single
 * `openrig.status` loop per machine, at the fastest pace a reader asks for, slowed to `OPENRIG_IDLE_POLL_MS` while OpenRig is absent
 * or stopped there; read again on a window focus. A state an action broadcasts, from this front or another, is taken at once.
 */
function subscribe(client: DaemonClient, machine: string, pollMs: number, notify: () => void): () => void {
  const store = storeOf(client);
  if (!store.off) {
    store.off = client.onMessage(m => {
      if (m.type !== 'openrig.state') return;
      const machineId = m.machineId ?? 'local';
      const e = store.entries.get(machineId);
      if (!e) return;
      // An answer to an older ask is not taken over a newer one; a broadcast always is.
      if (m.requestId !== undefined && m.requestId !== e.asked) return;
      e.seen = { state: m.state ?? (m.error ? null : e.seen.state), ...(m.error ? { error: m.error } : {}) };
      e.answeredAt = Date.now();
      if (everyOf(e) !== e.every) plan(client, machineId, e);
      e.readers.forEach(r => r.notify());
    });
  }
  if (!store.offFocus && typeof window !== 'undefined') {
    const onFocus = () => { for (const [id, e] of store.entries) if (Date.now() - Math.max(e.answeredAt, e.askedAt) > FRESH_MS) ask(client, id, e); };
    window.addEventListener('focus', onFocus);
    store.offFocus = () => window.removeEventListener('focus', onFocus);
  }
  let e = store.entries.get(machine);
  const fresh = !e;
  if (!e) { e = { seen: UNSEEN, asked: null, askedAt: 0, answeredAt: 0, readers: new Map(), every: pollMs, timer: null }; store.entries.set(machine, e); }
  const id = ++reader;
  e.readers.set(id, { pollMs, notify });
  // A new reader takes the read under way or a recent one; it asks only when what is known is older than its own pace.
  const last = Math.max(e.answeredAt, e.askedAt);
  if (fresh || Date.now() - last >= Math.min(pollMs, everyOf(e))) ask(client, machine, e);
  else if (everyOf(e) !== e.every) plan(client, machine, e);
  return () => {
    const entry = store.entries.get(machine);
    if (!entry) return;
    entry.readers.delete(id);
    if (entry.readers.size > 0) { if (everyOf(entry) !== entry.every) plan(client, machine, entry); return; }
    if (entry.timer) clearTimeout(entry.timer);
    store.entries.delete(machine);
    if (store.entries.size === 0) { store.off?.(); store.off = null; store.offFocus?.(); store.offFocus = null; }
  };
}
const seenOf = (client: DaemonClient, machine: string): Seen => stores.get(client)?.entries.get(machine)?.seen ?? UNSEEN;
/** Reads the machine's OpenRig again now (after an action, a refresh button). */
function reread(client: DaemonClient, machine: string): void {
  const e = stores.get(client)?.entries.get(machine);
  if (e) ask(client, machine, e);
}

/**
 * A machine's OpenRig, read every `pollMs` while the screen is shown (`machine` null: nothing is asked), through the read every
 * screen of the client shares, and the actions run on it. An action's end reads the machine again.
 */
export function useOpenRig(client: DaemonClient, machine: string | null, pollMs = OPENRIG_POLL_MS): OpenRigView {
  const sub = useCallback((notify: () => void) => (machine === null ? () => {} : subscribe(client, machine, pollMs, notify)), [client, machine, pollMs]);
  const seen = useSyncExternalStore(sub, () => (machine === null ? UNSEEN : seenOf(client, machine)));
  const [pending, setPending] = useState<OpenRigAction | null>(null);
  const [last, setLast] = useState<OpenRigDone | null>(null);
  const waiting = useRef(new Map<string, (d: OpenRigDone) => void>());

  useEffect(() => {
    setPending(null); setLast(null);
    if (machine === null) return;
    const off = client.onMessage(m => {
      if (m.type !== 'openrig.done') return;
      const resolve = waiting.current.get(m.requestId);
      if (!resolve) return;
      waiting.current.delete(m.requestId);
      resolve(m);
    });
    return () => { off(); for (const [, r] of waiting.current) r({ type: 'openrig.done', requestId: '', ok: false, commands: [], error: 'cancelled' }); waiting.current.clear(); };
  }, [client, machine]);

  const act = useCallback((action: OpenRigAction): Promise<OpenRigDone> => {
    if (machine === null) return Promise.resolve({ type: 'openrig.done', requestId: '', ok: false, commands: [], error: 'offline' });
    const requestId = `openrig-act-${++next}`;
    setPending(action); setLast(null);
    return new Promise<OpenRigDone>(resolve => {
      waiting.current.set(requestId, d => { setPending(p => (p === action ? null : p)); setLast(d); if (d.error !== 'cancelled') reread(client, machine); resolve(d); });
      client.send({ type: 'openrig.act', requestId, action, machineId: machine });
    });
  }, [client, machine]);

  const refresh = useCallback(() => { if (machine !== null) reread(client, machine); }, [client, machine]);
  return { state: seen.state, ...(seen.error ? { error: seen.error } : {}), pending, last, act, refresh };
}

/** What a machine answered: its OpenRig, or why it could not (`offline`, `outdated`). */
export type OpenRigSeen = { state: OpenRigState | null; error?: 'offline' | 'outdated' };

/**
 * Several machines' OpenRig, as last read, through the same shared read (the sidebar: is OpenRig installed somewhere, does a
 * daemon run, the kernel's state). A machine that has not answered yet is absent; one that could not answer has its `error`.
 */
export function useOpenRigStates(client: DaemonClient, machines: readonly string[], pollMs = OPENRIG_POLL_MS): ReadonlyMap<string, OpenRigSeen> {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const key = [...machines].sort().join('\u0000');
  useEffect(() => {
    const ids = key ? key.split('\u0000') : [];
    const offs = ids.map(m => subscribe(client, m, pollMs, bump));
    bump();
    return () => offs.forEach(off => off());
  }, [client, key, pollMs]);
  const out = new Map<string, OpenRigSeen>();
  for (const m of machines) { const seen = seenOf(client, m); if (seen.state || seen.error) out.set(m, seen); }
  return out;
}

export interface RigSpecsView { status: 'idle' | 'loading' | 'ready'; specs: readonly RigSpec[]; error?: string; reload(): void }

/** The machine's rig specs, asked once per machine (and again on `reload`): `error` `daemon_stopped` while OpenRig is off. */
export function useRigSpecs(client: DaemonClient, machine: string | null): RigSpecsView {
  const [answer, setAnswer] = useState<{ machine: string; specs: readonly RigSpec[]; error?: string } | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (machine === null) return;
    const requestId = `openrig-specs-${++next}`;
    setAnswer(a => (a?.machine === machine ? a : null));
    const off = client.onMessage(m => {
      if (m.type !== 'openrig.specList' || m.requestId !== requestId) return;
      setAnswer({ machine, specs: m.specs, ...(m.error ? { error: m.error } : {}) });
    });
    client.send({ type: 'openrig.specs', requestId, machineId: machine });
    return off;
  }, [client, machine, round]);
  const reload = useCallback(() => setRound(r => r + 1), []);
  if (machine === null) return { status: 'idle', specs: [], reload };
  if (!answer || answer.machine !== machine) return { status: 'loading', specs: [], reload };
  return { status: 'ready', specs: answer.specs, ...(answer.error ? { error: answer.error } : {}), reload };
}

/** Checks (`plan`) or launches a rig on a machine; resolves with its end. */
export function launchRig(client: DaemonClient, machine: string, launch: RigLaunch): Promise<OpenRigLaunched> {
  const requestId = `openrig-launch-${++next}`;
  return new Promise(resolve => {
    const off = client.onMessage(m => {
      if (m.type !== 'openrig.launched' || m.requestId !== requestId) return;
      off(); resolve(m);
    });
    client.send({ type: 'openrig.launch', requestId, launch, machineId: machine });
  });
}

/** Brings a running rig's roles to `seats` (role -> count) on a machine; resolves with what changed. */
export function reseatRig(client: DaemonClient, machine: string, rig: string, seats: Record<string, number>, delegation?: 'pairs' | 'all'): Promise<OpenRigReseated> {
  const requestId = `openrig-seats-${++next}`;
  return new Promise(resolve => {
    const off = client.onMessage(m => {
      if (m.type !== 'openrig.reseated' || m.requestId !== requestId) return;
      off(); resolve(m);
    });
    client.send({ type: 'openrig.seats', requestId, machineId: machine, rig, seats, ...(delegation ? { delegation } : {}) });
  });
}

// ── Roles (docs/mockups/ledge-openrig-roles.html), read-only: one ask per machine (and per `reload`), no polling. ──

export interface RolesView { status: 'idle' | 'loading' | 'ready'; roles: readonly RoleSummary[]; openrigVersion?: string; error?: string; reload(): void }

/** The machine's roles: `error` `daemon_stopped` / `not_installed`, or the fleet's `offline` / `outdated` (its Ledge does not read roles). */
export function useOpenRigRoles(client: DaemonClient, machine: string | null): RolesView {
  const [answer, setAnswer] = useState<{ machine: string; roles: readonly RoleSummary[]; openrigVersion?: string; error?: string } | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (machine === null) return;
    const requestId = `openrig-roles-${++next}`;
    setAnswer(a => (a?.machine === machine ? a : null));
    const off = client.onMessage(m => {
      if (m.type !== 'openrig.roleList' || m.requestId !== requestId) return;
      setAnswer({ machine, roles: m.roles, ...(m.openrigVersion ? { openrigVersion: m.openrigVersion } : {}), ...(m.error ? { error: m.error } : {}) });
    });
    client.send({ type: 'openrig.roles', requestId, machineId: machine });
    return off;
  }, [client, machine, round]);
  const reload = useCallback(() => setRound(r => r + 1), []);
  if (machine === null) return { status: 'idle', roles: [], reload };
  if (!answer || answer.machine !== machine) return { status: 'loading', roles: [], reload };
  return { status: 'ready', roles: answer.roles, ...(answer.openrigVersion ? { openrigVersion: answer.openrigVersion } : {}), ...(answer.error ? { error: answer.error } : {}), reload };
}

export interface RoleView { status: 'idle' | 'loading' | 'ready'; role: RoleDetail | null; error?: string; reload(): void }

/** One role of the machine by library id (`id` null: nothing asked). A previous role stays shown while the next one loads only if it is the same id. */
export function useOpenRigRole(client: DaemonClient, machine: string | null, id: string | null): RoleView {
  const [answer, setAnswer] = useState<{ key: string; role: RoleDetail | null; error?: string } | null>(null);
  const [round, setRound] = useState(0);
  const key = machine !== null && id !== null ? `${machine}\u0000${id}` : null;
  useEffect(() => {
    if (machine === null || id === null) return;
    const requestId = `openrig-role-${++next}`;
    const k = `${machine}\u0000${id}`;
    setAnswer(a => (a?.key === k ? a : null));
    const off = client.onMessage(m => {
      if (m.type !== 'openrig.roleDetail' || m.requestId !== requestId) return;
      setAnswer({ key: k, role: m.role ?? null, ...(m.error ? { error: m.error } : {}) });
    });
    client.send({ type: 'openrig.role', requestId, machineId: machine, roleId: id });
    return off;
  }, [client, machine, id, round]);
  const reload = useCallback(() => setRound(r => r + 1), []);
  if (key === null) return { status: 'idle', role: null, reload };
  if (!answer || answer.key !== key) return { status: 'loading', role: null, reload };
  return { status: 'ready', role: answer.role, ...(answer.error ? { error: answer.error } : {}), reload };
}

/** A file of a role (one its detail lists); resolves with its content or why not (`not_allowed`, `missing`, `offline`…). */
export function readRoleFile(client: DaemonClient, machine: string, id: string, path: string): Promise<OpenRigRoleFileContent> {
  const requestId = `openrig-role-file-${++next}`;
  return new Promise(resolve => {
    const off = client.onMessage(m => {
      if (m.type !== 'openrig.roleFileContent' || m.requestId !== requestId) return;
      off(); resolve(m);
    });
    client.send({ type: 'openrig.roleFile', requestId, machineId: machine, roleId: id, path });
  });
}
