// In-process fake OpenRig 0.6.14 (HTTP + SSE) for tests; shapes copied from daemon/dist/routes/*.js.
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RigExec } from '../../src/daemon/openrig/cli.js';

export interface FakeNode { logicalId: string; podId?: string | null; canonicalSessionName: string; runtime?: string; sessionStatus?: string; startupStatus?: string; cwd?: string; activityState?: { activity: 'working' | 'idle-at-prompt' | 'unknown' } | null; [k: string]: unknown }
/** PsEntry fields + the nodes behind `/api/rigs/:rigId/nodes`. */
export interface FakeRig { rigId: string; name: string; status: 'running' | 'partial' | 'stopped'; nodes: FakeNode[]; [k: string]: unknown }
export interface FakeQueueRow { qitemId: string; sourceSession: string; destinationSession: string; state: string; tier?: string | null; summary?: string; body?: string; humanIntent?: string | null; humanQuestions?: unknown[] | null; evidenceRef?: string | null; replyTo?: string | null; createdAt?: string; [k: string]: unknown }
export interface FakeOutboxRow { outboxId: string; senderSession: string; destinationSession: string; body: string; deliveryState: string; [k: string]: unknown }

export interface FakeSpec { id: string; name: string; sourceType: 'builtin' | 'user_file'; yaml: string; sourcePath?: string; /** the detail route answers 404 */ missing?: boolean }

export interface FakeOpenRig {
  url: string; port: number;
  version: string | null;                          // null: /healthz without semver (unstamped build)
  rigs: FakeRig[];
  specs: FakeSpec[];                               // /api/specs/library (rig kind), empty by default
  queue: FakeQueueRow[]; outbox: Map<string, FakeOutboxRow[]>; humans: string[];
  kernel: { state: 'ready' | 'booting' | 'absent' };
  emit(event: { type: string } & Record<string, unknown>): number;   // appends to the journal, returns seq
  stop(): Promise<void>;                           // closes the port and destroys open SSE streams (journal kept)
  restart(): Promise<void>;                        // reopens on the same port, same journal
  /** POST requests also keep their parsed JSON `body` and their `headers` (names lower-cased). */
  requests: { method: string; path: string; search?: string; lastEventId?: string; body?: unknown; headers?: Record<string, string> }[];
  /** Snapshots listed by `GET /api/rigs/:id/snapshots`, per rig id. */
  snapshots: Map<string, { id: string; createdAt: string }[]>;
  /** Scripts the answer of one route (`method`, raw path as sent, e.g. a `%40` seat ref): any status and JSON body, once set for good. */
  reply(method: string, path: string, status: number, json: unknown): void;
  /** The next n `/api/events` requests are accepted but never answered (no headers), until stop(). */
  hangEvents: number;
  /** A human row (to `ledge@external` unless given): added with `queue.created`, or replaced with `queue.updated` when its id is known. */
  pushEscalation(row: Partial<FakeQueueRow> & { qitemId: string }): number;
  /** A seat-to-seat queue row: `queue.created` from `from` to `to` (no row kept). */
  pushExchange(x: { qitemId: string; from: string; to: string; summary?: string }): number;
}

export async function createFakeOpenRig(opts: { port?: number; version?: string | null } = {}): Promise<FakeOpenRig> {
  const journal: ({ type: string; seq: number; rigId?: unknown } & Record<string, unknown>)[] = [];
  const streams = new Set<{ res: ServerResponse; rigId: string | null }>(); const hung = new Set<ServerResponse>();
  let server: Server | null = null; const scripted = new Map<string, { status: number; body: unknown }>();
  const f: FakeOpenRig = {
    url: '', port: opts.port ?? 0, version: opts.version === undefined ? '0.6.14' : opts.version,
    rigs: [], specs: [], queue: [], outbox: new Map(), humans: [], kernel: { state: 'ready' }, requests: [], hangEvents: 0, snapshots: new Map(),
    reply(method, path, status, body) { scripted.set(`${method} ${path}`, { status, body }); },
    emit(event) {
      const e = { ...event, seq: journal.length + 1 }; journal.push(e);
      for (const s of streams) if (!s.rigId || (e as { rigId?: unknown }).rigId === s.rigId) write(s.res, e);
      return e.seq;
    },
    async stop() {
      const s = server; server = null; if (!s) return;
      for (const st of streams) st.res.destroy(); streams.clear(); for (const r of hung) r.destroy(); hung.clear();
      await new Promise<void>(r => { s.close(() => r()); s.closeAllConnections(); });
    },
    async restart() { await f.stop(); await listen(); },
    pushEscalation(o) {
      const row: FakeQueueRow = { sourceSession: 'dev-build@starter', destinationSession: 'ledge@external', state: 'pending', summary: `question ${o.qitemId}`, createdAt: '2026-10-30 10:00:00', ...o };
      const i = f.queue.findIndex(r => r.qitemId === row.qitemId);
      if (i >= 0) f.queue[i] = row; else f.queue.push(row);
      return f.emit({ type: i >= 0 ? 'queue.updated' : 'queue.created', qitemId: row.qitemId, sourceSession: row.sourceSession, destinationSession: row.destinationSession });
    },
    pushExchange(x) {
      return f.emit({ type: 'queue.created', qitemId: x.qitemId, sourceSession: x.from, destinationSession: x.to, summary: x.summary ?? `do ${x.qitemId}` });
    },
  };
  const write = (res: ServerResponse, e: { seq: number }) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(e)}\nid: ${e.seq}\n\n`); };
  const json = (res: ServerResponse, body: unknown, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const ps = (r: FakeRig) => { const { nodes, ...rest } = r; return { rigName: r.name, nodeCount: nodes.length, runningCount: nodes.filter(n => n.sessionStatus === 'running').length, activeCount: nodes.filter(n => n.activityState?.activity === 'working').length, ...rest }; };

  const entry = (s: FakeSpec) => ({ id: s.id, kind: 'rig', name: s.name, version: '0.2', sourceType: s.sourceType, sourcePath: s.sourcePath ?? `/specs/${s.name}/rig.yaml` });

  /** POST /api/mission-control/action: `approve` closes a pending row (done); a terminal one answers 409 qitem_already_terminal (facts D7). */
  function action(body: unknown, res: ServerResponse) {
    const b = (body ?? {}) as { verb?: unknown; qitemId?: unknown };
    const row = f.queue.find(r => r.qitemId === b.qitemId);
    if (!row) return json(res, { error: 'qitem_not_found' }, 404);
    if (row.state === 'done') return json(res, { error: 'qitem_already_terminal', message: `qitem ${row.qitemId} is already terminal (state=done)`, state: 'done' }, 409);
    if (b.verb !== 'approve' && b.verb !== 'resolve') return json(res, { error: 'unsupported_verb' }, 400);
    row.state = b.verb === 'approve' ? 'done' : 'in-progress';
    json(res, { ok: true, qitemId: row.qitemId, state: row.state });
  }

  function handle(req: IncomingMessage, res: ServerResponse) {
    const u = new URL(req.url ?? '/', 'http://x'); const path = u.pathname; const q = u.searchParams;
    const lastEventId = req.headers['last-event-id'] as string | undefined;
    const rec = { method: req.method ?? 'GET', path, ...(u.search ? { search: u.search } : {}), ...(lastEventId !== undefined ? { lastEventId } : {}) };
    f.requests.push(rec);
    if (req.method === 'POST') {
      let raw = ''; req.on('data', d => { raw += d; });
      req.on('end', () => {
        let body: unknown = raw; try { body = JSON.parse(raw); } catch { /* kept as text */ }
        const headers: Record<string, string> = {}; for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k.toLowerCase()] = v;
        Object.assign(rec, { body, headers });
        const sc = scripted.get(`POST ${path}`); if (sc) return json(res, sc.body, sc.status);
        if (path === '/api/mission-control/action') return action(body, res);
        // Lifecycle (OpenRig 0.6.14 routes): answers ok; the effect reaches Ledge through the tests' own `emit`.
        if (path === '/api/down' || /^\/api\/rigs\/[^/]+\/(up|restore\/[^/]+)$/.test(path) || /^\/api\/seat\/(restart|stop|handover)\/[^/]+$/.test(path)) return json(res, { ok: true });
        json(res, { error: 'not_found' }, 404);
      });
      return;
    }
    if (req.method !== 'GET') return json(res, { error: 'not_found' }, 404);
    const scripted_ = scripted.get(`GET ${path}`); if (scripted_) return json(res, scripted_.body, scripted_.status);
    const snap = /^\/api\/rigs\/([^/]+)\/snapshots$/.exec(path);
    if (snap) return json(res, f.snapshots.get(decodeURIComponent(snap[1]!)) ?? []);
    if (path === '/healthz') return json(res, { status: 'ok', pid: process.pid, ...(f.version !== null ? { semver: f.version } : {}) });
    if (path === '/api/ps') return json(res, f.rigs.map(ps));
    const m = /^\/api\/rigs\/([^/]+)\/nodes$/.exec(path);
    if (m) { const rig = f.rigs.find(r => r.rigId === decodeURIComponent(m[1]!)); return rig ? json(res, rig.nodes.map(n => ({ rigId: rig.rigId, rigName: rig.name, ...n }))) : json(res, { error: 'rig_not_found' }, 404); }
    if (path === '/api/specs/library') return json(res, f.specs.filter(() => !q.get('kind') || q.get('kind') === 'rig').map(s => entry(s)));
    const sm = /^\/api\/specs\/library\/([^/]+)$/.exec(path);
    if (sm) { const s = f.specs.find(x => x.id === decodeURIComponent(sm[1]!)); return s && !s.missing ? json(res, { entry: entry(s), yaml: s.yaml }) : json(res, { error: 'not found' }, 404); }
    if (path === '/api/kernel/status') return json(res, { state: f.kernel.state, kernel_state: f.kernel.state, agents: [] });
    if (path === '/api/queue/list') {
      const d = q.get('destinationSession'), s = q.get('state'), src = q.get('sourceSession');
      return json(res, f.queue.filter(r => (!d || r.destinationSession === d) && (!s || s.split(',').includes(r.state)) && (!src || r.sourceSession === src)));
    }
    if (path === '/api/queue/outbox/list') { const s = q.get('senderSession'); return json(res, s ? (f.outbox.get(s) ?? []) : [...f.outbox.values()].flat()); }
    if (path === '/api/events' && f.hangEvents > 0) { f.hangEvents--; hung.add(res); res.on('close', () => hung.delete(res)); return; }
    if (path === '/api/events') return sse(req, res, q, lastEventId);
    json(res, { error: 'not_found' }, 404);
  }

  // Same semantics as events.js: Last-Event-ID wins, else ?replay=n = newest n (0 = from now on), else the whole log.
  function sse(_req: IncomingMessage, res: ServerResponse, q: URLSearchParams, lastEventId: string | undefined) {
    const rigId = q.get('rigId'); const replay = q.get('replay');
    const replayCount = replay !== null && /^\d+$/.test(replay) ? Number(replay) : null;
    const rows = journal.filter(e => !rigId || e.rigId === rigId);
    const past = lastEventId !== undefined ? rows.filter(e => e.seq > (parseInt(lastEventId, 10) || 0))
      : replayCount === null ? rows : rows.slice(Math.max(0, rows.length - replayCount));
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.flushHeaders();
    for (const e of past) write(res, e);
    const st = { res, rigId }; streams.add(st); res.on('close', () => streams.delete(st));
  }

  const listen = () => new Promise<void>((resolve, reject) => {
    const s = createServer(handle); s.once('error', reject);
    s.listen(f.port, '127.0.0.1', () => { server = s; f.port = (s.address() as AddressInfo).port; f.url = `http://127.0.0.1:${f.port}`; resolve(); });
  });
  await listen();
  return f;
}

/** `envs`: the env laid over the agent environment, one entry per call (undefined without). */
export type FakeRigCli = RigExec & { calls: string[][]; envs: (Record<string, string> | undefined)[] };
/**
 * Simulates the `rig` binary. `calls` records every argv, `envs` the env of each call (`send` prints a confirmation).
 * `gateway human list --json` prints an array of objects with `id`: `[{ "id": "ledge" }]` (Task 6 parses it).
 * `queue create … --json` appends a pending row to `rig.queue` (body read from `--body-file`) and prints it with its `qitemId`;
 * with `hold`, it waits for that promise first (the call is recorded at once).
 */
export function fakeRigCli(rig: FakeOpenRig | null, opts: { startFails?: boolean; version?: string; hold?: Promise<unknown>; calls?: { args: string[]; env?: Record<string, string> }[];
  /** `rig up <spec> --cwd <cwd> --yes --json`: what it prints; without it `up` is an unknown command. */ up?: (spec: string, cwd: string) => { code: number; stdout: string; stderr: string } } = {}): FakeRigCli {
  const calls: string[][] = []; const envs: (Record<string, string> | undefined)[] = [];
  const ok = (stdout = ''): { code: number; stdout: string; stderr: string } => ({ code: 0, stdout, stderr: '' });
  const fail = (code: number, stderr: string) => ({ code, stdout: '', stderr });
  const exec = (async (args: string[], o?: { env?: Record<string, string> }) => {
    calls.push([...args]); envs.push(o?.env); opts.calls?.push({ args: [...args], ...(o?.env ? { env: o.env } : {}) }); const j = args.join(' ');
    if (args[0] === '--version') { const v = opts.version ?? rig?.version; return rig === null && opts.version === undefined ? fail(127, 'rig: command not found') : ok(`${v ?? '0.0.0'} (fake)\n`); }
    if (j === 'daemon start') {
      if (opts.startFails) return fail(1, 'daemon failed to start: port busy (fake)');
      if (!rig) return fail(127, 'rig: command not found');
      await rig.restart(); return ok('daemon started\n');
    }
    if (args[0] === 'up' && opts.up) return opts.up(args[1]!, args[args.indexOf('--cwd') + 1]!);
    if (!rig) return fail(127, 'rig: command not found');
    if (j.startsWith('gateway human list')) return ok(JSON.stringify(rig.humans.map(id => ({ id }))));
    if (j.startsWith('gateway human add ')) {
      const id = args[3]!;
      if (rig.humans.length && !rig.humans.includes(id) && !args.includes('--replace'))
        return fail(1, `refused: a human is already configured (${rig.humans[0]}). OpenRig supports one configured human ... remove the existing one first (\`rig gateway human remove <entityId>\`)`);
      rig.humans.splice(0, rig.humans.length, id); return ok(`added ${id}\n`);
    }
    if (args[0] === 'send') return args.length === 3 ? ok(`sent to ${args[1]}\n`) : fail(2, 'send: usage: rig send <session> <text>');
    if (args[0] === 'queue' && args[1] === 'create') {
      if (opts.hold) await opts.hold;
      const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
      const source = flag('--source'), destination = flag('--destination');
      if (!source || !destination) return fail(2, 'queue create: --source and --destination are required');
      let body: string | undefined; const file = flag('--body-file');
      if (file) { try { body = readFileSync(file, 'utf8'); } catch { return fail(1, `queue create: cannot read ${file}`); } }
      const row: FakeQueueRow = { qitemId: `qitem-fake-${rig.queue.length + 1}`, sourceSession: source, destinationSession: destination, state: 'pending',
        summary: flag('--summary') ?? '', ...(body !== undefined ? { body } : {}), replyTo: flag('--reply-to') ?? null, createdAt: '2026-10-30 10:00:00' };
      rig.queue.push(row); return ok(JSON.stringify(row));
    }
    return fail(2, `unknown command: ${j}`);
  }) as FakeRigCli;
  exec.calls = calls; exec.envs = envs; return exec;
}
