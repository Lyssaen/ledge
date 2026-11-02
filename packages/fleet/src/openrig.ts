import { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * A machine's OpenRig, read every `OPENRIG_POLL_MS` while the screen is shown (`machine` null: nothing is asked), and the
 * actions run on it. A state an action broadcasts, from this front or another, is taken at once.
 */
export function useOpenRig(client: DaemonClient, machine: string | null, pollMs = OPENRIG_POLL_MS): OpenRigView {
  const [view, setView] = useState<{ machine: string | null; state: OpenRigState | null; error?: 'offline' | 'outdated' }>({ machine, state: null });
  const [pending, setPending] = useState<OpenRigAction | null>(null);
  const [last, setLast] = useState<OpenRigDone | null>(null);
  const waiting = useRef(new Map<string, (d: OpenRigDone) => void>());
  const asked = useRef<string | null>(null);

  const ask = useCallback(() => {
    if (machine === null) return;
    const requestId = `openrig-${++next}`;
    asked.current = requestId;
    client.send({ type: 'openrig.status', requestId, machineId: machine });
  }, [client, machine]);

  useEffect(() => {
    setView({ machine, state: null }); setPending(null); setLast(null);
    if (machine === null) return;
    const off = client.onMessage(m => {
      if (m.type === 'openrig.state') {
        if ((m.machineId ?? 'local') !== machine) return;
        // An answer to an older ask of this screen is not taken over a newer one; a broadcast always is.
        if (m.requestId !== undefined && m.requestId !== asked.current) return;
        setView(v => ({ machine, state: m.state ?? (m.error ? null : v.state), ...(m.error ? { error: m.error } : {}) }));
      } else if (m.type === 'openrig.done') {
        const resolve = waiting.current.get(m.requestId);
        if (!resolve) return;
        waiting.current.delete(m.requestId);
        resolve(m);
      }
    });
    ask();
    const timer = setInterval(ask, pollMs);
    return () => { off(); clearInterval(timer); for (const [, r] of waiting.current) r({ type: 'openrig.done', requestId: '', ok: false, commands: [], error: 'cancelled' }); waiting.current.clear(); };
  }, [client, machine, ask, pollMs]);

  const act = useCallback((action: OpenRigAction): Promise<OpenRigDone> => {
    if (machine === null) return Promise.resolve({ type: 'openrig.done', requestId: '', ok: false, commands: [], error: 'offline' });
    const requestId = `openrig-act-${++next}`;
    setPending(action); setLast(null);
    return new Promise<OpenRigDone>(resolve => {
      waiting.current.set(requestId, d => { setPending(p => (p === action ? null : p)); setLast(d); resolve(d); });
      client.send({ type: 'openrig.act', requestId, action, machineId: machine });
    });
  }, [client, machine]);

  const shown = view.machine === machine ? view : { state: null };
  return { state: shown.state, ...('error' in shown && shown.error ? { error: shown.error } : {}), pending, last, act, refresh: ask };
}

/**
 * Several machines' OpenRig, as last read (the sidebar: is OpenRig installed somewhere, does a daemon run, the kernel's
 * state). Each machine is asked every `pollMs`; a state an action broadcasts is taken at once. A machine that could not
 * answer, or not yet, is absent.
 */
export function useOpenRigStates(client: DaemonClient, machines: readonly string[], pollMs = OPENRIG_POLL_MS): ReadonlyMap<string, OpenRigState> {
  const [states, setStates] = useState<ReadonlyMap<string, OpenRigState>>(() => new Map());
  const key = [...machines].sort().join('\u0000');
  useEffect(() => {
    const ids = key ? key.split('\u0000') : [];
    setStates(was => new Map([...was].filter(([m]) => ids.includes(m))));
    if (ids.length === 0) return;
    const asked = new Map<string, string>();
    const off = client.onMessage(m => {
      if (m.type !== 'openrig.state') return;
      const machine = m.machineId ?? 'local';
      if (!ids.includes(machine)) return;
      // Our own asks, and broadcasts; another screen's answer is its own.
      if (m.requestId !== undefined && m.requestId !== asked.get(machine)) return;
      setStates(was => {
        const n = new Map(was);
        if (m.state) n.set(machine, m.state); else if (m.error) n.delete(machine);
        return n;
      });
    });
    const ask = () => { for (const machine of ids) { const requestId = `openrig-${++next}`; asked.set(machine, requestId); client.send({ type: 'openrig.status', requestId, machineId: machine }); } };
    ask();
    const timer = setInterval(ask, pollMs);
    return () => { off(); clearInterval(timer); };
  }, [client, key, pollMs]);
  return states;
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
