import { ChatTurnSchema, type ChatTurn, type ClientMessage, type RoutingContext, type ServerMessage, type Session } from '@ledge/protocol';
import { createDaemonClient, type DaemonClient, type DaemonStatus } from './client';
import { loadMachines, machineUrl, parseMachines, probeMachine, qualify, splitId, terminalCommand, type MachineConfig, type MachineState } from './machines';

type Snapshot = Extract<ServerMessage, { type: 'snapshot' }>;
type Peer = { config: MachineConfig; client: DaemonClient; status: DaemonStatus; fresh: boolean; snapshot: Snapshot | null; previews: Map<string, string[]>; off: (() => void)[]; error?: string; restarting?: boolean };
type Machine = { id: string; label: string; ssh?: string }; // lot 2 types it in @ledge/protocol
const isMachinesMessage = (m: unknown): m is { type: 'machines'; machines: Machine[] } => !!m && typeof m === 'object' && (m as { type?: string }).type === 'machines' && Array.isArray((m as { machines?: unknown }).machines);
const wire = (list: MachineConfig[]): Machine[] => list.map(({ id, label, ssh }) => ({ id, label, ...(ssh ? { ssh } : {}) }));
type Binding = { machine: string; raw: string };
type PendingRoute = { qid: string; text: string; tool?: 'claude' | 'codex' | 'cursor'; coordinator: string };

export interface FleetOptions {
  /** Storage key prefix: `ledge` (island) or `desktop` (spec §7). */
  prefix?: string;
  /** Keep the last snapshot of a fallen remote peer published, sessions flagged `offline` (spec §6). Off: today's behaviour. */
  keepStale?: boolean;
  /** Trust the local daemon's `machines` list once it sends one (spec §5.3). Off: localStorage only. */
  machinesFromDaemon?: boolean;
}

/** An app-owned connection per host. No command is broadcast; a missing owner fails closed. */
export function createFleetClient(config: MachineConfig[], makeClient = createDaemonClient, opts: FleetOptions = {}): DaemonClient {
  const prefix = opts.prefix ?? 'ledge';
  const HISTORY_KEY = `${prefix}.fleet.history`, MACHINES_KEY = `${prefix}.machines`;
  let configs = parseMachines(config), selected = configs[0]!.id, connected = false, configuring = false, state: MachineState[] = [];
  const peers = new Map<string, Peer>();
  const machineMessages = new Set<(machine: string, m: ServerMessage) => void>();
  const messages = new Set<(m: ServerMessage) => void>(), statuses = new Set<(s: DaemonStatus) => void>(), listeners = new Set<() => void>();
  const turns = new Map<string, ChatTurn>(), bindings = new Map<string, Binding>();
  const documents = new Map<string, string>();
  const operations = new Map<string, string>();
  let source: 'daemon' | 'local' = 'local';
  let routing: PendingRoute | null = null, resetAt = '', lastStatus: DaemonStatus = 'connecting';
  const emit = (m: ServerMessage) => messages.forEach(fn => fn(m));
  const day = () => new Date().toISOString().slice(0, 10);
  let historyDay = day();
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? 'null');
    if (saved?.day === day()) {
      for (const raw of (saved.turns ?? []).slice(-50)) {
        const t = ChatTurnSchema.parse(raw);
        if (!t.answeredAt && !t.error) t.error = 'Connection interrupted';
        turns.set(t.qid, t);
      }
      for (const [qid, b] of saved.bindings ?? []) if (turns.has(qid) && configs.some(c => c.id === b.machine) && typeof b.raw === 'string') bindings.set(qid, b);
      resetAt = typeof saved.resetAt === 'string' ? saved.resetAt : '';
    }
  } catch { /* No usable previous conversation. */ }
  function history() {
    const list = [...turns.values()].sort((a, b) => a.askedAt.localeCompare(b.askedAt)).slice(-50);
    const kept = new Set(list.map(t => t.qid));
    for (const id of turns.keys()) if (!kept.has(id)) { turns.delete(id); bindings.delete(id); }
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify({ day: historyDay, turns: list, bindings: [...bindings], resetAt })); } catch { /* Memory still works when storage is full. */ }
    emit({ type: 'chat.history', turns: list });
  }
  const available = (p: Peer | undefined): boolean => !!p && p.status === 'open' && p.fresh && !!p.snapshot;
  const status = (): DaemonStatus => [...peers.values()].some(available) ? 'open' : [...peers.values()].some(p => p.status === 'connecting') ? 'connecting' : 'unreachable';
  /** keepStale: a fallen remote peer keeps its last snapshot, flagged offline. The local peer is never frozen (spec §6). */
  const stale = (p: Peer | undefined): boolean => !!opts.keepStale && !!p && p.config.id !== 'local' && !available(p) && !!p.snapshot;
  const session = (p: Peer, s: Session): Session => ({ ...s, id: qualify(p.config.id, s.id), machineId: p.config.id, machineName: p.config.label, ...(stale(p) ? { offline: true } : {}) });
  const stateSessions = (p: Peer): Session[] => stale(p) ? p.snapshot!.sessions.map(s => ({ ...s, offline: true })) : p.snapshot?.sessions ?? [];
  /** The fleet's own inventory and status follow every change. Only `publish` tells the overlay the whole picture again:
   *  a (re)connection, a host joining or leaving, another host selected. A session's own update is relayed as itself
   *  (see `receive`): to the overlay a snapshot is a reconnection, which empties the threads and rebuilds the open view. */
  function refresh() {
    state = configs.map(c => { const p = peers.get(c.id)!; return { ...c, status: p.status, ready: available(p), recents: p.snapshot?.recents ?? [], sessions: stateSessions(p), launcher: p.snapshot?.launcher ?? null, version: p.snapshot?.daemon?.version, daemon: p.snapshot?.daemon, error: p.error }; });
    const next = status(); if (next !== lastStatus) { lastStatus = next; statuses.forEach(fn => fn(next)); }
    listeners.forEach(fn => fn());
  }
  function publish() {
    if (configuring) return;
    state = configs.map(c => { const p = peers.get(c.id)!; return { ...c, status: p.status, ready: available(p), recents: p.snapshot?.recents ?? [], sessions: stateSessions(p), launcher: p.snapshot?.launcher ?? null, version: p.snapshot?.daemon?.version, daemon: p.snapshot?.daemon, error: p.error }; });
    const primary = peers.get('local')?.snapshot;
    emit({ type: 'snapshot', sessions: [...peers.values()].filter(p => available(p) || stale(p)).flatMap(p => p.snapshot!.sessions.map(s => session(p, s))), recents: available(peers.get(selected)) ? peers.get(selected)!.snapshot!.recents : [], launcher: primary?.launcher, daemon: primary?.daemon });
    for (const p of peers.values()) if (available(p) || stale(p)) for (const [id, lines] of p.previews) emit({ type: 'session.preview', id: qualify(p.config.id, id), lines });
    const next = status(); if (next !== lastStatus) { lastStatus = next; statuses.forEach(fn => fn(next)); }
    listeners.forEach(fn => fn());
  }
  function fail(qid: string, message: string) {
    const t = turns.get(qid); if (t) turns.set(qid, { ...t, error: message });
    history(); emit({ type: 'chat.error', qid, message });
  }
  function globalQid(machine: string, raw: string): string {
    return [...bindings].find(([, b]) => b.machine === machine && b.raw === raw)?.[0] ?? qualify(machine, raw);
  }
  function mappedTurn(p: Peer, raw: ChatTurn): ChatTurn {
    const qid = globalQid(p.config.id, raw.qid), old = turns.get(qid);
    bindings.set(qid, { machine: p.config.id, raw: raw.qid });
    return { ...raw, qid, question: old?.question ?? raw.question, machineId: p.config.id, machineName: p.config.label,
      steps: raw.steps.map(s => ({ ...s, ...(s.id ? { id: qualify(p.config.id, s.id) } : {}) })),
      ...(raw.proposal ? { proposal: { ...raw.proposal, ...(raw.proposal.launchedId ? { launchedId: qualify(p.config.id, raw.proposal.launchedId) } : {}) } } : {}),
      ...(raw.relay ? { relay: { ...raw.relay, id: qualify(p.config.id, raw.relay.id) } } : {}) };
  }
  /** Applies a confirmed list to the peers: no storage write, nothing for the overlay until `publish`. */
  function apply(next: MachineConfig[]) {
    configuring = true;
    for (const [id, p] of peers) if (!next.some(c => c.id === id && c.url === p.config.url && c.ssh === p.config.ssh)) { p.client.close(); p.off.forEach(off => off()); peers.delete(id); }
    configs = next;
    for (const c of configs) { const p = peers.get(c.id); if (p) p.config = c; else add(c); }
    if (!peers.has(selected)) selected = 'local'; configuring = false; publish();
  }
  function receive(p: Peer, m: ServerMessage) {
    const machine = p.config.id;
    // The daemon's machine list is consumed here, never relayed; from anyone else (or with the option off) it is ignored.
    const wireMsg: unknown = m; // the protocol does not know `machines` until lot 2
    if (isMachinesMessage(wireMsg)) {
      if (machine !== 'local' || !opts.machinesFromDaemon) return;
      let next: MachineConfig[]; try { next = parseMachines(wireMsg.machines.map(x => x.id === 'local' ? { ...x, url: configs[0]!.url } : x)); } catch { return; }
      if (source === 'local') {
        source = 'daemon';
        // First front connected wins: only a daemon list reduced to `local` takes the richer local one, once.
        const mine = loadMachines(prefix);
        if (next.length === 1 && mine.length > 1) p.client.send({ type: 'machines.set', machines: wire(mine) } as never); // lot 2 types it
        try { localStorage.removeItem(MACHINES_KEY); } catch { /* ignore */ }
      }
      apply(next);
      return;
    }
    machineMessages.forEach(fn => fn(machine, m));
    // A daemon restarting for an update closes its SSH bridge: that error is the restart, not a failure to show.
    if (m.type === 'update.progress') p.restarting = m.step === 'restarting';
    if (m.type === 'update.failed') p.restarting = false;
    if (m.type === 'snapshot') {
      if (p.config.ssh && m.sshAlias !== p.config.ssh) { p.error = 'Update the local Ledge daemon: SSH transport is unavailable'; p.client.close(); publish(); return; }
      p.snapshot = m; p.fresh = true; p.error = undefined; p.restarting = false; p.previews.clear(); publish(); return;
    }
    // A session's traffic is relayed as it came, qualified; a peer without a snapshot yet has nothing to relay against.
    if (m.type === 'session.updated') { if (p.snapshot) p.snapshot = { ...p.snapshot, sessions: [...p.snapshot.sessions.filter(s => s.id !== m.session.id), m.session] }; if (available(p)) emit({ type: 'session.updated', session: session(p, m.session) }); refresh(); return; }
    if (m.type === 'session.removed') { if (p.snapshot) p.snapshot = { ...p.snapshot, sessions: p.snapshot.sessions.filter(s => s.id !== m.id) }; p.previews.delete(m.id); emit({ ...m, id: qualify(machine, m.id) }); refresh(); return; }
    if (m.type === 'recents') { if (p.snapshot) p.snapshot = { ...p.snapshot, recents: m.recents }; if (machine === selected && available(p)) emit(m); refresh(); return; }
    if (m.type === 'session.preview') { p.previews.set(m.id, m.lines); if (available(p)) emit({ ...m, id: qualify(machine, m.id) }); return; }
    if (m.type === 'session.thread' || m.type === 'session.thread.item') { if (available(p)) emit({ ...m, id: qualify(machine, m.id) }); return; }
    if (m.type === 'session.launched') { operations.delete(machine); emit({ ...m, id: qualify(machine, m.id) }); return; }
    if (m.type === 'folder.listing') { if (machine === selected) emit(m); return; }
    if (m.type === 'document.content' || m.type === 'document.error') { if (documents.get(m.requestId) === machine) { documents.delete(m.requestId); emit(m); } return; }
    if (m.type === 'chat.routed') {
      if (routing?.qid !== m.qid || routing.coordinator !== machine) return;
      const req = routing; routing = null;
      if (m.result.machineId === null) {
        const old = turns.get(m.qid)!;
        turns.set(m.qid, { ...old, answer: m.result.text, answeredAt: new Date().toISOString(), choices: m.result.choices?.map(id => ({ id, label: peers.get(id)?.config.label ?? id })) }); history();
      } else {
        const target = peers.get(m.result.machineId);
        bindings.set(req.qid, { machine: m.result.machineId, raw: req.qid });
        if (!available(target)) { fail(req.qid, `${target?.config.label ?? m.result.machineId} is offline`); return; }
        target!.client.send({ type: 'chat.ask', qid: req.qid, text: m.result.text, tool: req.tool });
      }
      return;
    }
    if (m.type === 'chat.history') {
      if (m.turns.some(t => t.qid === operations.get(machine) && t.relay && (t.relay.status || t.relay.error))) operations.delete(machine);
      for (const raw of m.turns) if (raw.askedAt >= resetAt && raw.askedAt.slice(0, 10) === historyDay) { const t = mappedTurn(p, raw); turns.set(t.qid, t); }
      history(); return;
    }
    if (m.type === 'chat.step' || m.type === 'chat.delta' || m.type === 'chat.done' || m.type === 'chat.error') {
      if (routing?.qid === m.qid && routing.coordinator === machine && m.type === 'chat.error') { routing = null; fail(m.qid, m.message); return; }
      const qid = globalQid(machine, m.qid), old = turns.get(qid); if (!old) return;
      if (m.type === 'chat.done') {
        const raw = { ...old, qid: m.qid, answer: m.text, answeredAt: m.at, proposal: m.proposal, relay: m.relay };
        const t = mappedTurn(p, { ...raw, steps: [] }); turns.set(qid, { ...t, steps: old.steps }); history();
      } else if (m.type === 'chat.error') fail(qid, m.message);
      else if (m.type === 'chat.step') { const step = { ...m.step, ...(m.step.id ? { id: qualify(machine, m.step.id) } : {}) }; turns.set(qid, { ...old, steps: [...old.steps, step] }); emit({ ...m, qid, step }); }
      else emit({ ...m, qid });
      return;
    }
    if (m.type === 'error') { if (p.restarting) return; if (!p.fresh) { p.error = m.message; publish(); return; } operations.delete(machine); emit({ ...m, ...(m.id ? { id: qualify(machine, m.id) } : {}), message: configs.length > 1 ? `${p.config.label}: ${m.message}` : m.message }); return; }
    if (machine === 'local') emit(m);
  }
  function add(c: MachineConfig) {
    const client = makeClient({ url: machineUrl(c, configs[0]!) });
    const p: Peer = { config: c, client, status: 'connecting', fresh: false, snapshot: null, previews: new Map(), off: [] }; peers.set(c.id, p);
    p.off.push(client.onMessage(m => receive(p, m)), client.onStatus(s => {
      p.status = s;
      if (s !== 'open') {
        p.fresh = false;
        if (operations.delete(c.id)) emit({ type: 'error', message: `${c.label} is offline` });
        for (const [requestId, owner] of documents) if (owner === c.id) { documents.delete(requestId); emit({ type: 'document.error', requestId, path: '', code: 'read_failed' }); }
        if (routing?.coordinator === c.id) { const qid = routing.qid; routing = null; fail(qid, `${c.label} is offline`); }
        for (const [qid, b] of bindings) { const t = turns.get(qid); if (b.machine === c.id && t && !t.answeredAt && !t.error) fail(qid, `${c.label} is offline`); }
      }
      publish();
    }));
    if (connected) client.connect();
  }
  for (const c of configs) add(c);
  function inventory(): RoutingContext {
    return { machines: state.map(m => ({ id: m.id, label: m.label, online: m.ready, local: m.id === 'local', sessions: m.sessions.slice(0, 500).map(s => ({ id: s.id, name: s.name, project: s.repo ?? s.project, cwd: s.cwd, topic: s.topic, state: s.state, readOnly: s.source === 'hook_only' })), folders: m.recents.slice(0, 100).map(r => ({ project: r.project, cwd: r.cwd })) })), history: [...turns.values()].slice(-30).map(t => ({ question: t.question.slice(0, 20000), answer: t.answer?.slice(0, 20000), machineId: t.machineId })) };
  }
  const api: DaemonClient = {
    connect() { connected = true; peers.forEach(p => p.client.connect()); publish(); history(); },
    close() { connected = false; peers.forEach(p => p.client.close()); }, status,
    onMessage(fn) { messages.add(fn); return () => { messages.delete(fn); }; },
    onStatus(fn) { statuses.add(fn); return () => { statuses.delete(fn); }; },
    send(msg) {
      if (msg.type === 'chat.reset') {
        if ([...turns.values()].some(t => !t.answeredAt && !t.error)) return;
        turns.clear(); bindings.clear(); resetAt = new Date().toISOString(); peers.forEach(p => { if (available(p)) p.client.send(msg); }); history(); return;
      }
      if (msg.type === 'chat.ask') {
        if (historyDay !== day()) { turns.clear(); bindings.clear(); historyDay = day(); }
        if (routing || [...turns.values()].some(t => !t.answeredAt && !t.error)) { emit({ type: 'chat.error', qid: msg.qid, message: 'one question at a time' }); return; }
        const context = inventory();
        turns.set(msg.qid, { qid: msg.qid, question: msg.text, askedAt: new Date().toISOString(), steps: [] }); history();
        if (configs.length === 1) {
          const p = peers.get('local'); if (!available(p)) return fail(msg.qid, 'Local is offline');
          bindings.set(msg.qid, { machine: 'local', raw: msg.qid }); p!.client.send(msg); return;
        }
        const coordinator = [...peers.values()].find(p => available(p) && p.snapshot?.daemon?.routing);
        if (!coordinator) return fail(msg.qid, 'Update a connected daemon to enable multi-machine chat');
        routing = { qid: msg.qid, text: msg.text, tool: msg.tool, coordinator: coordinator.config.id };
        coordinator.client.send({ type: 'chat.route', qid: msg.qid, text: msg.text, tool: msg.tool, context }); return;
      }
      if (msg.type === 'chat.cancel' && routing?.qid === msg.qid) { peers.get(routing.coordinator)?.client.send(msg); routing = null; fail(msg.qid, 'cancelled'); return; }
      let machine = selected; let outgoing: ClientMessage = msg;
      if ('id' in msg) { const origin = splitId(msg.id); if (!origin) { emit({ type: 'error', id: msg.id, message: 'Unknown machine' }); return; } machine = origin.machine; outgoing = { ...msg, id: origin.id }; }
      if ('qid' in msg && msg.qid) { const b = bindings.get(msg.qid); if (!b) { emit({ type: 'error', message: 'Unknown conversation destination' }); return; } machine = b.machine; outgoing = { ...outgoing, qid: b.raw } as ClientMessage; }
      if (msg.type === 'document.read') {
        if (configs.length > 1 && !msg.machineId && !msg.sessionId) { emit({ type: 'document.error', requestId: msg.requestId, path: msg.path, code: 'read_failed' }); return; }
        if (msg.machineId) machine = msg.machineId;
        const origin = msg.sessionId ? splitId(msg.sessionId) : null;
        if (origin) { machine = origin.machine; outgoing = { ...msg, sessionId: origin.id }; }
        documents.set(msg.requestId, machine);
      }
      if (msg.type === 'update.daemon') machine = 'local';
      if (msg.type === 'snapshot.request') { publish(); history(); return; }
      const target = peers.get(machine);
      if (!available(target)) {
        if (msg.type === 'document.read') { documents.delete(msg.requestId); emit({ type: 'document.error', requestId: msg.requestId, path: msg.path, code: 'read_failed' }); }
        else emit({ type: 'error', ...('id' in msg ? { id: msg.id } : {}), message: `${target?.config.label ?? machine} is offline` });
        return;
      }
      if (outgoing.type === 'session.launch' || outgoing.type === 'session.relay' || outgoing.type === 'session.relay.cancel') operations.set(machine, outgoing.qid ?? 'launch');
      target!.client.send(outgoing);
    },
    fleet: {
      primary: peers.get('local')!.client,
      subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }, machines: () => state, selected: () => selected,
      select(id) { if (!peers.has(id)) return; selected = id; publish(); },
      configure(raw) {
        const next = parseMachines(raw);
        // The permanent local client is also used by the app updater.
        if (next[0]!.url !== configs[0]!.url) throw new Error('The local daemon URL cannot change');
        // Daemon-sourced: ask the daemon and wait for its broadcast, which `receive` applies.
        if (source === 'daemon') { peers.get('local')!.client.send({ type: 'machines.set', machines: wire(next) } as never); return; } // lot 2 types it
        localStorage.setItem(MACHINES_KEY, JSON.stringify(next));
        apply(next);
      },
      machinesSource: () => source,
      probe: ssh => probeMachine(configs[0]!.url!, ssh),
      retry(id) { const p = peers.get(id); if (p && connected) p.client.connect(); },
      terminal(id) { const origin = splitId(id); const m = state.find(x => x.id === origin?.machine); return origin && m ? terminalCommand(m, origin.id) : null; },
      turnMachine(qid) { return state.find(m => m.id === bindings.get(qid)?.machine); },
      documentMachine(id) { return splitId(id)?.machine; },
      localSnapshot: () => peers.get('local')?.snapshot ?? null,
      sendTo(machine, msg) { const p = peers.get(machine); if (!available(p)) return false; p!.client.send(msg); return true; },
      onMachineMessage(fn) { machineMessages.add(fn); return () => { machineMessages.delete(fn); }; }
    }
  };
  publish();
  return api;
}
