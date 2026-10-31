import { isDeepStrictEqual } from 'node:util';
import type { Ask, Escalation, Exchange, OpenRigStatus, Projects, Rig, RigLaunchInfo, RigRepo, ServerMessage, SessionRig, Tool } from '@ledge/protocol';
import { log } from '../../log.js';
import { EVENTS, INSTALL_COMMAND, EVENTS_UNOBSERVED, HUMAN_ADDRESS, HUMAN_GATE_TIER, HUMAN_ID, OPERATOR_HUMAN_SESSIONS, REGISTRATION, openrigBase } from './facts.js';
import { createOpenRigHttp, OpenRigUnreachable, type Fetch, type OpenRigHttp } from './http.js';
import { openEventStream, type EventStream, type OpenRigEvent } from './sse.js';
import { createCursorWriter, readOpenRigFile } from './cursor.js';
import { createRigCli, realRigExec, type RigCli, type RigExec } from './cli.js';
import { probeOpenRig } from './presence.js';
import { paths } from '../../paths.js';
import { createMirror } from './mirror.js';
import { parseSessionName } from './seats.js';
import { createEscalationBook, createFirstSeen, rowToEscalation } from './escalations.js';
import { askToEscalation } from './asks.js';
import { createExchangeLog, exchangeFromEvent, exchangeFromOutbox } from './exchanges.js';
import { readHumanQueue, readRigs, versionCache } from './bridge-read.js';
import type { NodeEntry, QueueRow } from './wire.js';
import type { MirrorSnapshot } from './mirror.js';

export type BridgeMessage = Extract<ServerMessage, { type: 'openrig.status' | 'rig.snapshot' | 'rig.updated' | 'rig.removed' | 'rig.exchange' | 'escalation.updated' | 'escalation.removed' }>;
export interface BridgeDeps {
  machine?: string;                             // 'local'
  env: () => Promise<NodeJS.ProcessEnv>; fetch?: Fetch; exec?: RigExec;
  projects: () => Projects; home: string; file?: string;
  asks?: { all(): Ask[]; onChange(fn: () => void): () => void };
  sessionName: (sessionId: string) => string | undefined;
  /** False for a session that is gone or exited: its seat is free again for pairByCwd. Default: every paired session is alive. */
  alive?: (sessionId: string) => boolean;
  probeMs?: number;                             // 5000
  retryMs?: number;                             // 600000 (start, registration)
  outboxMs?: number;                            // 5000, while OUTBOX_EVENT is null
  resyncMs?: number;                            // 60000: safety re-read of `ps` + `nodes` (facts D10)
  openMs?: number;                              // 5000: deadline for /api/events to answer its headers
  now?: () => string;
  notice?: (text: string) => void;
}
/** Fields to change on an escalation; a key set to `undefined` is removed (a rollback drops `answer`). */
export type EscalationPatch = { [K in keyof Escalation]?: Escalation[K] | undefined };
/** An answered (or in-flight) escalation stays visible this long after its last patch, whatever OpenRig re-reads say. */
export const PATCH_TTL_MS = 24 * 3600_000;

export interface Bridge {
  start(): Promise<void>; stop(): Promise<void>;
  /** The HTTP client of the current OpenRig, null before the first probe. */
  http(): OpenRigHttp | null;
  /** The `rig` CLI (lot 4: `queueCreate`). */
  cli(): RigCli;
  status(): OpenRigStatus; rigs(): Rig[]; escalations(): Escalation[]; exchanges(rigId: string): Exchange[];
  /** One escalation as clients see it (patches included). */
  escalation(id: string): Escalation | undefined;
  /** Lays `p` over the escalation and broadcasts `escalation.updated`; undefined (nothing sent) for an unknown id. The patched
   *  escalation outlives re-reads, and the closing of its row, for PATCH_TTL_MS. A patch that brings it back to its row as read
   *  drops the overlay (rollback); one back to `pending`/`grace` without answer whose row is gone removes it. */
  patchEscalation(id: string, p: EscalationPatch): Escalation | undefined;
  /** The reply row noted for an escalation (openrig.json `replyRows`). */
  replyRow(id: string): string | undefined;
  setReplyRow(id: string, row: string): void;
  /** Messages to replay after each `snapshot`: openrig.status, rig.snapshot, then one escalation.updated per escalation. */
  replay(): BridgeMessage[];
  /** OpenRig's human queue was read at least once: an id missing from escalations() is not open there (before, it may only be unread). */
  humanRead(): boolean;
  onMessage(fn: (m: BridgeMessage) => void): () => void;
  /** Start cases 2 and 3 (lot 5): starts OpenRig when stopped, waits for `running` (60 s), returns the final status. */
  ensureRunning(reason: 'launch' | 'action'): Promise<OpenRigStatus>;
  /** Ledge-only fields of a rig (`launch`, `repos`), kept per rig id and laid over every rig the mirror rebuilds; emits `rig.updated`.
   *  `launch: null` clears it. Returns the annotated rig, null for an unknown rig. */
  annotate(rigId: string, extra: { launch?: RigLaunchInfo | null; repos?: RigRepo[] }): Rig | null;
  /** Emits `rig.updated` for every rig, rebuilt from the current projects (a filed rig changes project without OpenRig saying so). */
  refresh(): void;
  pair(sessionId: string, sessionName: string): SessionRig | null;
  pairByCwd(sessionId: string, cwd: string, tool: Tool): SessionRig | null;
  unpairedRefs(): string[];
}

const QUEUE_EVENTS = new Set<string>([EVENTS.queueCreated, EVENTS.queueUpdated, EVENTS.queueClaimed, EVENTS_UNOBSERVED.queueHandedOff]);
const HUMAN_REREAD_MS = 200; const ENSURE_MS = 60_000;
/** OpenRig runtime to Ledge Tool: `claude-code` is Claude Code; other runtimes (codex, …) carry the tool's own name. */
const toolOf = (runtime: string) => (runtime === 'claude-code' ? 'claude' : runtime);
const every = (ms: number, fn: () => unknown) => { const t = setInterval(() => void fn(), ms); t.unref(); return t; };

/** Runs `fn` one at a time; a call while it runs makes it run once more after. Errors are logged. */
function serial(fn: () => Promise<void>): () => Promise<void> {
  let busy: Promise<void> | null = null; let again = false;
  return () => {
    if (busy) { again = true; return busy; }
    busy = (async () => { try { do { again = false; await fn(); } while (again); } catch (e) { log(`openrig: ${(e as Error).message}`); } finally { busy = null; } })();
    return busy;
  };
}

export function createBridge(deps: BridgeDeps): Bridge {
  const machine = deps.machine ?? 'local'; const probeMs = deps.probeMs ?? 5000; const retryMs = deps.retryMs ?? 600_000;
  const outboxMs = deps.outboxMs ?? 5000; const resyncMs = deps.resyncMs ?? 60_000; const openMs = deps.openMs ?? 5000;
  const now = deps.now ?? (() => new Date().toISOString()); const notice = deps.notice ?? (() => {});
  const cli = createRigCli(deps.exec ?? realRigExec(deps.env)); const probeWith = versionCache(cli);
  const mirror = createMirror({ machine, projects: deps.projects, rigsRoot: paths().rigs });
  const rigBook = createEscalationBook(); const askBook = createEscalationBook(); const xlog = createExchangeLog();
  const listeners = new Set<(m: BridgeMessage) => void>();
  const firstSeen = createFirstSeen(now);
  const ctx = { machine, rigOf: (ref: string) => mirror.byRef(ref)?.rig.id, isKernelSeat: (ref: string) => mirror.byRef(ref)?.rig.kernel === true, seenAt: firstSeen.at };

  let status: OpenRigStatus = { machine, state: 'stopped' }; let human: 'registered' | 'missing' | 'failed' = 'missing';
  let active = false; let armed = false; let probed = false;
  let base = ''; let bearer: string | undefined; let http: OpenRigHttp | null = null;
  let writer: ReturnType<typeof createCursorWriter> | null = null; let cursor: number | null = null; let knownRigs: string[] = [];
  let gen = 0; let stream: EventStream | null = null; let live = false;
  let probing: Promise<void> | null = null; let starting: Promise<void> | null = null; let failedAt: number | null = null; let autoFailed = false;
  let registering = false; let humanOk = false; let regAt: number | null = null;
  let humanRead = false; // the human queue was read once (a failed read keeps the books as they were: empty after a restart)
  let probeTimer: NodeJS.Timeout | null = null; const connTimers: NodeJS.Timeout[] = []; let humanTimer: NodeJS.Timeout | null = null;
  let unsubAsks: (() => void) | null = null;
  const opening = new Set<() => void>(); // cancels of streams not open yet
  const nodesByRig = new Map<string, NodeEntry[]>(); // per-seat cwd for pairByCwd
  const outboxSeen = new Map<string, Set<string>>(); // seat ref -> outbox ids of its latest listing (never pruned by ref: a rig may come back)

  const annotations = new Map<string, { launch?: RigLaunchInfo; repos?: RigRepo[] }>(); // Ledge-only fields, laid over the mirror's rigs
  const annotated = (rig: Rig): Rig => {
    const a = annotations.get(rig.id); if (!a) return rig;
    return { ...rig, ...(a.repos ? { repos: a.repos } : {}), ...(a.launch ? { launch: a.launch } : {}) };
  };
  const rigsNow = () => mirror.rigs().map(annotated);
  const emit = (m: BridgeMessage) => { if (!active) return;
    if (m.type === 'rig.updated') m = { ...m, rig: annotated(m.rig) }; else if (m.type === 'rig.snapshot') m = { ...m, rigs: m.rigs.map(annotated) };
    for (const fn of listeners) { try { fn(m); } catch (e) { log(`openrig: listener threw: ${(e as Error).message}`); } } };
  function setStatus(state: OpenRigStatus['state'], extra: { version?: string; detail?: string; install?: string } = {}) {
    const next: OpenRigStatus = { machine, state, ...(extra.version ? { version: extra.version } : {}), ...(state === 'running' ? { human } : {}), ...(extra.detail ? { detail: extra.detail } : {}), ...(extra.install ? { install: extra.install } : {}) };
    if (isDeepStrictEqual(next, status)) return;
    status = next; emit({ type: 'openrig.status', status });
  }
  const setHuman = (h: typeof human) => { human = h; if (status.state === 'running') setStatus('running', { version: status.version }); };
  const removeRig = (rigId: string) => { annotations.delete(rigId); xlog.forgetRig(rigId); refetchers.delete(rigId); nodesByRig.delete(rigId); emit({ type: 'rig.removed', machine, rigId }); };
  const emitRigs = (r: { updated: Rig[]; removed: string[] }) => { for (const rig of r.updated) emit({ type: 'rig.updated', rig }); r.removed.forEach(removeRig); };
  // Patched escalations (answered, in flight, rolled to grace…), laid over the books: a re-read rebuilds rows as `pending` and
  // drops closed ones, which would erase « Répondu par toi ». Masked ids get no broadcast from the books.
  const overlay = new Map<string, { e: Escalation; at: number }>();
  const booked = (id: string) => rigBook.get(id) ?? askBook.get(id);
  const sweep = () => {
    const t = Date.parse(now());
    for (const [id, o] of [...overlay]) {
      if (t - o.at <= PATCH_TTL_MS) continue;
      overlay.delete(id); const b = booked(id);
      emit(b ? { type: 'escalation.updated', escalation: b } : { type: 'escalation.removed', id });
    }
  };
  const emitEsc = (r: { updated: Escalation[]; removed: string[] }) => {
    sweep();
    for (const escalation of r.updated) if (!overlay.has(escalation.id)) emit({ type: 'escalation.updated', escalation });
    for (const id of r.removed) if (!overlay.has(id)) emit({ type: 'escalation.removed', id });
  };
  const emitExchange = (x: Exchange | null) => { if (x && xlog.add(x)) emit({ type: 'rig.exchange', exchange: x }); };
  const saveRigs = () => { const names = mirror.rigs().map(r => r.name); if (!isDeepStrictEqual(names, knownRigs)) { knownRigs = names; writer?.set(machine, { rigs: names }); } };
  const keepNodes = (snap: MirrorSnapshot) => {
    for (const id of [...nodesByRig.keys()]) if (!snap.rigs.some(r => r.rigId === id)) nodesByRig.delete(id);
    for (const [id, list] of snap.nodes) nodesByRig.set(id, list);
  };
  const applyHuman = (rows: QueueRow[]) => { humanRead = true; emitEsc(rigBook.replace(rows.map(r => rowToEscalation(r, ctx)))); firstSeen.retain(new Set(rows.map(r => r.qitemId))); };
  const syncAsks = () => {
    if (!deps.asks) return;
    emitEsc(askBook.replace(deps.asks.all().filter(a => a.state === 'open').map(a => askToEscalation(a, { machine, nameOf: deps.sessionName }))));
  };

  // While connected: each reader checks `gen` after its awaits, so a reconnect drops stale results. A failed read (unreachable,
  // non-200, a body that is no list) throws and changes nothing: the mirror and the books keep what they had until the next read.
  const resync = serial(async () => {
    const h = http; const g = gen; if (!h || !live) return;
    const snap = await readRigs(h); if (g !== gen) return;
    keepNodes(snap); emitRigs(mirror.replace(snap)); saveRigs();
  });
  const rereadHuman = serial(async () => {
    const h = http; const g = gen; if (!h || !live) return;
    const rows = await readHumanQueue(h); if (g === gen) applyHuman(rows);
  });
  const pollOutbox = serial(async () => {
    const h = http; const g = gen; if (!h || !live) return;
    for (const ref of mirror.rigs().flatMap(r => r.seats.map(s => s.ref))) {
      let rows; try { rows = await h.outbox(ref); } catch (e) { if (e instanceof OpenRigUnreachable) return; continue; }
      if (g !== gen) return;
      // Only ids absent from the previous listing reach the log: a long listing never re-broadcasts past the log's dedupe window.
      // The first listing of a seat only fills the log (history for rig.exchanges): starting Ledge does not replay it as news.
      const seen = outboxSeen.get(ref); outboxSeen.set(ref, new Set(rows.map(r => r.outboxId)));
      for (const row of rows) {
        if (seen?.has(row.outboxId)) continue;
        const x = exchangeFromOutbox(row, { ...ctx, at: now() });
        if (seen) emitExchange(x); else if (x) xlog.add(x);
      }
    }
  });
  const refetchers = new Map<string, () => Promise<void>>();
  const refetch = (rigId: string) => {
    let run = refetchers.get(rigId);
    if (!run) refetchers.set(rigId, run = serial(async () => {
      const h = http; const g = gen; if (!h || !live) return;
      const before = mirror.rigs().find(r => r.id === rigId); if (!before) return void resync(); // unknown rig (rig.imported): re-read `ps`
      const nodes = await h.nodes(rigId).catch(() => null); if (!nodes || g !== gen) return; // 404: the resync settles removal
      nodesByRig.set(rigId, nodes); const rig = mirror.setNodes(rigId, nodes); if (rig && !isDeepStrictEqual(rig, before)) emit({ type: 'rig.updated', rig });
    }));
    void run();
  };
  const scheduleHuman = () => {
    if (humanTimer) return;
    humanTimer = setTimeout(() => { humanTimer = null; void rereadHuman(); }, HUMAN_REREAD_MS); humanTimer.unref();
  };
  /** A queue event that may concern a human row: addressed to the human/operator, human-gate tier, an escalation we hold, or no destination given. */
  const touchesHuman = (e: OpenRigEvent) => {
    const to = typeof e.destinationSession === 'string' ? e.destinationSession : undefined;
    return !to || to === HUMAN_ADDRESS || OPERATOR_HUMAN_SESSIONS.includes(to) || e.tier === HUMAN_GATE_TIER
      || (typeof e.qitemId === 'string' && rigBook.all().some(x => x.id === e.qitemId));
  };

  function apply(e: OpenRigEvent) {
    if (cursor !== null && e.seq <= cursor) return; // seq persists across OpenRig restarts (D12): the cursor never moves back
    cursor = e.seq; writer?.set(machine, { lastEventId: e.seq });
    const r = mirror.applyEvent(e); emitRigs(r); r.refetch.forEach(refetch);
    if (!QUEUE_EVENTS.has(e.type)) return;
    if (touchesHuman(e)) scheduleHuman(); else emitExchange(exchangeFromEvent(e, { ...ctx, at: now() }));
  }

  /** Resolves with the stream once it is open; null when it ended before, missed the `openMs` deadline (a hung open would
   *  otherwise hold the probe loop forever) or was cancelled by a disconnect. `refused`: OpenRig answered 4xx (cursor rejected). */
  function openStream(g: number, from: number | null, buffer: OpenRigEvent[]): Promise<{ stream: EventStream | null; refused: boolean }> {
    return new Promise(resolve => {
      let opened = false; let settled = false; let first = true;
      const settle = (v: EventStream | null, refused = false) => { if (settled) return; settled = true; clearTimeout(timer); opening.delete(cancel); if (!v) s.close(); resolve({ stream: v, refused }); };
      const cancel = () => settle(null);
      const s: EventStream = openEventStream({ base, fetch: deps.fetch, lastEventId: from,
        onEvent: e => {
          if (g !== gen) return;
          // Resuming after `from`, OpenRig only sends later seqs: an earlier one first means its journal was wiped. Follow the new journal.
          if (first && from !== null && e.seq <= from) { log(`openrig: event journal restarted (seq ${e.seq} after cursor ${from}), following it`); cursor = null; }
          first = false;
          if (live) apply(e); else buffer.push(e);
        },
        onOpen: () => { opened = true; settle(s); },
        onEnd: err => {
          if (!opened) { const st = (err as { status?: number } | undefined)?.status; return settle(null, st !== undefined && st >= 400 && st < 500); }
          if (g !== gen) return;
          log(`openrig: event stream ended${err ? `: ${err.message}` : ''}`); disconnect(); setStatus('stopped');
        } });
      const timer = setTimeout(() => { log(`openrig: /api/events did not open within ${openMs} ms`); cancel(); }, openMs); timer.unref();
      opening.add(cancel);
    });
  }

  /** SSE first (events buffered), then the full read, then the buffer, then live. */
  async function connect(version: string | undefined) {
    const g = ++gen; const buffer: OpenRigEvent[] = [];
    let { stream: s, refused } = await openStream(g, cursor, buffer);
    if (!s && refused && cursor !== null && g === gen) { // only an explicit refusal drops the cursor; a timeout, reset or 5xx keeps it
      log(`openrig: the event stream refused cursor ${cursor}, starting from now with a full re-read`);
      cursor = null; writer?.set(machine, { lastEventId: null }); ({ stream: s } = await openStream(g, null, buffer));
    }
    if (!s) return; // /healthz answers but /api/events does not: the next probe tries again from the same cursor
    if (g !== gen || !active) return s.close();
    stream = s; const h = http!;
    let snap, rows;
    try { snap = await readRigs(h); }
    catch (e) { if (g === gen) { log(`openrig: initial read failed: ${(e as Error).message}`); s.close(); stream = null; } return; }
    try { rows = await readHumanQueue(h); } catch (e) { rows = null; log(`openrig: human queue not read, kept as it was: ${(e as Error).message}`); }
    if (g !== gen || !active) return;
    keepNodes(snap); const { removed } = mirror.replace(snap); live = true; humanOk = false;
    if (!mirror.rigs().some(r => !r.kernel)) human = 'missing'; // no stale 'registered' from an earlier connection
    setStatus('running', { version });
    removed.forEach(removeRig);
    emit({ type: 'rig.snapshot', machine, rigs: mirror.rigs() }); saveRigs();
    if (rows) applyHuman(rows);
    for (const e of buffer.splice(0)) apply(e);
    connTimers.push(every(outboxMs, pollOutbox), every(resyncMs, () => Promise.all([resync(), rereadHuman()]))); // the human queue too: safety net
    void pollOutbox(); void register();
  }

  /** Drops the connection; the rigs stay, marked unreachable, until the next connect re-reads them. */
  function disconnect() {
    const was = live || stream !== null; gen++; for (const cancel of [...opening]) cancel(); stream?.close(); stream = null; live = false;
    for (const t of connTimers.splice(0)) clearInterval(t);
    if (humanTimer) { clearTimeout(humanTimer); humanTimer = null; }
    if (was) for (const rig of mirror.markUnreachable()) emit({ type: 'rig.updated', rig });
  }

  async function register() {
    if (REGISTRATION !== 'external' || registering || !live || humanOk) return;
    if (regAt !== null && Date.now() - regAt < retryMs) return;
    if (!mirror.rigs().some(r => !r.kernel)) return;
    registering = true; const g = gen;
    const stale = () => g !== gen || !live; // a disconnect or stop happened during an await: this run must not touch state
    try {
      const list = await cli.humans(); if (stale()) return;
      if (list?.includes(HUMAN_ID)) { humanOk = true; return setHuman('registered'); }
      regAt = Date.now();
      if (list === null) { log('openrig: `rig gateway human list` failed, Ledge is not registered'); return setHuman('failed'); }
      const other = list.find(id => id !== HUMAN_ID);
      const r = await cli.addHuman(other ? { replace: true } : undefined); if (stale()) return;
      if (!r.ok) { log(`openrig: registering Ledge as the human failed: ${r.detail ?? ''}`); return setHuman('failed'); }
      humanOk = true; setHuman('registered');
      if (other) notice(`J'ai remplacé l'humain ${other} par Ledge sur ${machine}`);
    } finally { registering = false; }
  }

  function startOpenRig(auto: boolean): Promise<void> {
    if (starting) return starting;
    setStatus('starting');
    starting = (async () => {
      try {
        const r = await cli.daemonStart(); if (!active) return;
        if (!r.ok) { failedAt = Date.now(); autoFailed = auto; log(`openrig: rig daemon start failed: ${r.detail ?? ''}`); return setStatus('error', { detail: r.detail ?? 'rig daemon start failed' }); }
        failedAt = null; notice(`J'ai démarré OpenRig sur ${machine}`);
      } finally { starting = null; }
      await tick();
    })();
    return starting;
  }

  async function probe() {
    const env = await deps.env(); const b = openrigBase(env); const token = env.OPENRIG_AUTH_BEARER_TOKEN || undefined;
    if (b !== base || !http) { if (http) { disconnect(); setStatus('stopped'); } base = b; bearer = token; http = createOpenRigHttp({ base, fetch: deps.fetch, token }); }
    else if (token !== bearer) { bearer = token; http = createOpenRigHttp({ base, fetch: deps.fetch, token }); } // same daemon, new token: the connection stays
    const p = await probeOpenRig(probeWith(http));
    if (!active) return;
    const first = armed; armed = false; probed = true;
    if (p.state === 'running') {
      failedAt = null; autoFailed = false;
      if (!live) await connect(p.version); else setStatus('running', { version: p.version });
      return void register();
    }
    if (live || stream) disconnect();
    if (p.state === 'unsupported') return setStatus('unsupported', { version: p.version, detail: p.detail });
    if (p.state === 'absent') { failedAt = null; return setStatus('absent', { install: INSTALL_COMMAND }); }
    if (starting) return; // keeps 'starting'
    if (failedAt !== null) {
      if (Date.now() - failedAt < retryMs) return; // keeps 'error'
      failedAt = null; if (autoFailed) { autoFailed = false; return void startOpenRig(true); }
    }
    if (first && knownRigs.length) return void startOpenRig(true); // case 1: Ledge starts with rigs known on this machine
    setStatus('stopped');
  }
  function tick(): Promise<void> {
    probing ??= probe().catch(e => log(`openrig: probe failed: ${(e as Error).message}`)).finally(() => { probing = null; });
    return probing;
  }

  function pair(sessionId: string, sessionName: string): SessionRig | null {
    const hit = mirror.byRef(sessionName); const p = parseSessionName(sessionName); if (!hit || !p) return null;
    if (hit.seat.sessionId !== sessionId) { const rig = mirror.pair(hit.rig.id, sessionName, sessionId); if (rig) emit({ type: 'rig.updated', rig }); }
    return { machine, rigId: hit.rig.id, rigName: hit.rig.name, seat: sessionName, pod: p.pod, member: p.member };
  }

  const escalations = () => {
    sweep();
    const list = [...rigBook.all(), ...askBook.all()]; const ids = new Set(list.map(e => e.id));
    return [...list.map(e => overlay.get(e.id)?.e ?? e), ...[...overlay.values()].filter(o => !ids.has(o.e.id)).map(o => o.e)];
  };
  const escalation = (id: string) => { sweep(); return overlay.get(id)?.e ?? booked(id); };
  const cursorFile = () => (writer ??= createCursorWriter({ file: deps.file, now }));

  return {
    async start() {
      if (active) return; active = true; armed = true;
      const m = readOpenRigFile(deps.file).machines[machine]; knownRigs = m?.rigs ?? []; cursor = m?.lastEventId ?? null;
      cursorFile();
      if (deps.asks) { unsubAsks = deps.asks.onChange(syncAsks); syncAsks(); }
      probeTimer = every(probeMs, tick); void tick();
    },
    async stop() {
      if (!active) return; active = false; disconnect();
      if (probeTimer) { clearInterval(probeTimer); probeTimer = null; }
      unsubAsks?.(); unsubAsks = null;
      await writer?.flush();
    },
    http: () => http, cli: () => cli,
    status: () => status, rigs: rigsNow, exchanges: rigId => xlog.list(rigId),
    escalations, escalation,
    patchEscalation(id, p) {
      const cur = escalation(id); if (!cur) return undefined;
      const next = { ...cur, ...p } as Escalation;
      for (const k of Object.keys(p) as (keyof Escalation)[]) if (p[k] === undefined) delete next[k];
      const b = booked(id);
      if (b && isDeepStrictEqual(b, next)) overlay.delete(id);
      else if (!b && (next.state === 'pending' || next.state === 'grace') && !next.answer) { overlay.delete(id); emit({ type: 'escalation.removed', id }); return next; }
      else overlay.set(id, { e: next, at: Date.parse(now()) });
      emit({ type: 'escalation.updated', escalation: next });
      return next;
    },
    humanRead: () => humanRead,
    replyRow: id => cursorFile().replyRow(id),
    setReplyRow: (id, row) => cursorFile().setReplyRow(id, row),
    replay() {
      return [{ type: 'openrig.status', status }, { type: 'rig.snapshot', machine, rigs: rigsNow() },
        ...escalations().map((escalation): BridgeMessage => ({ type: 'escalation.updated', escalation }))];
    },
    onMessage(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async ensureRunning() {
      if (!probed) await tick();
      if (status.state === 'stopped' || status.state === 'error') void startOpenRig(false);
      const end = Date.now() + ENSURE_MS;
      while (active && Date.now() < end && (status.state === 'starting' || status.state === 'stopped'))
        await new Promise(r => setTimeout(r, Math.min(probeMs, 100)).unref());
      return status;
    },
    annotate(rigId, extra) {
      const rig = mirror.rigs().find(r => r.id === rigId); if (!rig) return null;
      const next = { ...annotations.get(rigId) };
      if (extra.launch === null) delete next.launch; else if (extra.launch) next.launch = extra.launch;
      if (extra.repos) next.repos = extra.repos;
      if (next.launch || next.repos) annotations.set(rigId, next); else annotations.delete(rigId);
      const out = annotated(rig); emit({ type: 'rig.updated', rig });
      return out;
    },
    refresh() { for (const rig of rigsNow()) emit({ type: 'rig.updated', rig }); },
    pair,
    pairByCwd(sessionId, cwd, tool) {
      const cwdOf = (rigId: string, ref: string) => nodesByRig.get(rigId)?.find(n => (n.canonicalSessionName ?? n.logicalId) === ref)?.cwd;
      const seats = mirror.rigs().flatMap(r => r.seats.filter(s => cwdOf(r.id, s.ref) === cwd)).filter(s => toolOf(s.runtime) === tool);
      const mine = seats.find(s => s.sessionId === sessionId); if (mine) return pair(sessionId, mine.ref);
      const free = seats.filter(s => !s.sessionId || deps.alive?.(s.sessionId) === false); return free.length === 1 ? pair(sessionId, free[0]!.ref) : null;
    },
    unpairedRefs: () => mirror.rigs().flatMap(r => r.seats.filter(s => !s.sessionId || deps.alive?.(s.sessionId) === false).map(s => s.ref)),
  };
}
