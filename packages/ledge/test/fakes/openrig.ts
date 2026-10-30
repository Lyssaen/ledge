// In-process fake OpenRig 0.6.14 (HTTP + SSE) for tests; shapes copied from daemon/dist/routes/*.js.
import { createServer, type Server, type ServerResponse } from 'node:http';
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
  requests: { method: string; path: string; search?: string; lastEventId?: string }[];
  /** The next n `/api/events` requests are accepted but never answered (no headers), until stop(). */
  hangEvents: number;
}

export async function createFakeOpenRig(opts: { port?: number; version?: string | null } = {}): Promise<FakeOpenRig> {
  const journal: ({ type: string; seq: number; rigId?: unknown } & Record<string, unknown>)[] = [];
  const streams = new Set<{ res: ServerResponse; rigId: string | null }>(); const hung = new Set<ServerResponse>();
  let server: Server | null = null;
  const f: FakeOpenRig = {
    url: '', port: opts.port ?? 0, version: opts.version === undefined ? '0.6.14' : opts.version,
    rigs: [], specs: [], queue: [], outbox: new Map(), humans: [], kernel: { state: 'ready' }, requests: [], hangEvents: 0,
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
  };
  const write = (res: ServerResponse, e: { seq: number }) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(e)}\nid: ${e.seq}\n\n`); };
  const json = (res: ServerResponse, body: unknown, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const ps = (r: FakeRig) => { const { nodes, ...rest } = r; return { rigName: r.name, nodeCount: nodes.length, runningCount: nodes.filter(n => n.sessionStatus === 'running').length, activeCount: nodes.filter(n => n.activityState?.activity === 'working').length, ...rest }; };

  const entry = (s: FakeSpec) => ({ id: s.id, kind: 'rig', name: s.name, version: '0.2', sourceType: s.sourceType, sourcePath: s.sourcePath ?? `/specs/${s.name}/rig.yaml` });

  function handle(req: import('node:http').IncomingMessage, res: ServerResponse) {
    const u = new URL(req.url ?? '/', 'http://x'); const path = u.pathname; const q = u.searchParams;
    const lastEventId = req.headers['last-event-id'] as string | undefined;
    f.requests.push({ method: req.method ?? 'GET', path, ...(u.search ? { search: u.search } : {}), ...(lastEventId !== undefined ? { lastEventId } : {}) });
    if (req.method !== 'GET') return json(res, { error: 'not_found' }, 404);
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
  function sse(_req: import('node:http').IncomingMessage, res: ServerResponse, q: URLSearchParams, lastEventId: string | undefined) {
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

/**
 * Simulates the `rig` binary. `calls` records every argv.
 * `gateway human list --json` prints an array of objects with `id`: `[{ "id": "ledge" }]` (Task 6 parses it).
 */
export function fakeRigCli(rig: FakeOpenRig | null, opts: { startFails?: boolean; version?: string } = {}): RigExec & { calls: string[][] } {
  const calls: string[][] = [];
  const ok = (stdout = ''): { code: number; stdout: string; stderr: string } => ({ code: 0, stdout, stderr: '' });
  const fail = (code: number, stderr: string) => ({ code, stdout: '', stderr });
  const exec = (async (args: string[]) => {
    calls.push([...args]); const j = args.join(' ');
    if (args[0] === '--version') { const v = opts.version ?? rig?.version; return rig === null && opts.version === undefined ? fail(127, 'rig: command not found') : ok(`${v ?? '0.0.0'} (fake)\n`); }
    if (j === 'daemon start') {
      if (opts.startFails) return fail(1, 'daemon failed to start: port busy (fake)');
      if (!rig) return fail(127, 'rig: command not found');
      await rig.restart(); return ok('daemon started\n');
    }
    if (!rig) return fail(127, 'rig: command not found');
    if (j.startsWith('gateway human list')) return ok(JSON.stringify(rig.humans.map(id => ({ id }))));
    if (j.startsWith('gateway human add ')) {
      const id = args[3]!;
      if (rig.humans.length && !rig.humans.includes(id) && !args.includes('--replace'))
        return fail(1, `refused: a human is already configured (${rig.humans[0]}). OpenRig supports one configured human ... remove the existing one first (\`rig gateway human remove <entityId>\`)`);
      rig.humans.splice(0, rig.humans.length, id); return ok(`added ${id}\n`);
    }
    return fail(2, `unknown command: ${j}`);
  }) as RigExec & { calls: string[][] };
  exec.calls = calls; return exec;
}
