#!/usr/bin/env node
// Probe of a throwaway OpenRig daemon: pure building blocks, then the driver (`main`) that runs a fixed list of steps
// against a temp daemon and writes a raw JSON report. It concludes nothing; a later step reads the report.
// It never targets ~/.openrig or port 7433: assertSafeTarget refuses both.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const RIG = 'ledge-probe';

const fail = (msg) => { throw new Error(`openrig-probe: refused: ${msg}`); };
const isUnder = (path, dir) => {
  const rel = relative(resolve(dir), resolve(path));
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
};
// Resolves symlinks through the nearest existing ancestor and re-appends the missing tail; follows dangling links.
const real = (p, depth = 0) => {
  const r = resolve(p);
  if (depth > 20) return r;
  try { return realpathSync(r); } catch { /* missing or dangling */ }
  try { return real(resolve(dirname(r), readlinkSync(r)), depth + 1); } catch { /* not a link */ }
  const up = dirname(r);
  return up === r ? r : resolve(real(up, depth + 1), basename(r));
};

/** Environment of a probe command: no inherited OpenRig, Ledge or tmux identity, only the throwaway ones. */
export function probeEnv(base, o) {
  const env = {};
  for (const [k, v] of Object.entries(base)) {
    if (k.startsWith('OPENRIG_') || k.startsWith('RIGGED_') || k === 'LEDGE_SESSION' || k === 'TMUX' || k === 'TMUX_PANE' || k === 'TMUX_TMPDIR') continue;
    env[k] = v;
  }
  env.OPENRIG_HOME = o.home;
  env.OPENRIG_URL = `http://127.0.0.1:${o.port}`;
  env.OPENRIG_PORT = String(o.port);
  env.OPENRIG_SHARED_DOCS_ROOT = `${o.home}/shared-docs`;
  env.TMUX_TMPDIR = `${o.home}/tmux`;
  if (o.seat) env.OPENRIG_SESSION_NAME = o.seat;
  return env;
}

/** Refuses the user's own daemon (port 7433 or OPENRIG_PORT) and any home that is not a temp `openrig-qa-*` directory. */
export function assertSafeTarget(o) {
  const port = Number(o.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`port ${o.port} is not a valid port`);
  if (port === 7433 || (o.userPort !== undefined && port === Number(o.userPort))) fail(`port ${port} belongs to the user's daemon`);
  const home = real(o.home);
  const rig = real(resolve(o.realHome ?? homedir(), '.openrig'));
  if (home === rig || isUnder(home, rig)) fail(`home ${o.home} is the user's ~/.openrig`);
  const roots = [tmpdir(), '/tmp'].map(real);
  if (!roots.some((r) => isUnder(home, r)) || !basename(home).startsWith('openrig-qa-')) {
    fail(`home ${o.home} is not a temp openrig-qa-* directory`);
  }
}

/** Refuses a path that is not inside the throwaway home. */
export function assertUnder(path, home) {
  if (!isUnder(path, home)) fail(`wrote outside ${home}: ${path}`);
}

/** The `ledge-probe` rig (0.6.14 requires a pod label): two terminal seats in pod `probe` (sessions probe-seat@ledge-probe, probe-peer@ledge-probe). */
export function probeRigSpec() {
  const member = (id) => [
    `      - id: ${id}`,
    '        agent_ref: "builtin:terminal"',
    '        runtime: terminal',
    '        profile: none',
    '        cwd: "."',
  ].join('\n');
  return [
    'version: "0.2"',
    `name: ${RIG}`,
    'pods:',
    '  - id: probe',
    '    label: Probe',
    '    members:',
    member('seat'),
    member('peer'),
    'edges: []',
    '',
  ].join('\n');
}

/** Content of the `--human-questions-file`. */
export function questionsJson() {
  return JSON.stringify([
    { id: 'branch', question: 'Which branch should the probe use?', options: [
      { id: 'main', label: 'main', recommended: true }, { id: 'develop', label: 'develop' }, { id: 'new', label: 'a new branch' }] },
    { id: 'slow', question: 'Run the slow checks too?', options: [
      { id: 'yes', label: 'yes' }, { id: 'no', label: 'no', recommended: true }] },
  ], null, 2);
}

/** Parses SSE frames out of a buffer; returns the complete events and the unfinished tail. */
export function parseSse(buffer) {
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = parts.pop() ?? '';
  const events = [];
  for (const frame of parts) {
    let id = NaN;
    const data = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('id:')) id = Number(line.slice(3).trim());
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) continue;
    let parsed;
    try { parsed = JSON.parse(data.join('\n')); } catch { continue; }
    events.push({ id, type: parsed && typeof parsed === 'object' && typeof parsed.type === 'string' ? parsed.type : '', data: parsed });
  }
  return { events, rest };
}

/** Teardown steps, in order; throws on a non-probe home. `env` says what each step runs with: probeEnv, only TMUX_TMPDIR, or nothing special. */
export function teardownPlan(o) {
  assertSafeTarget({ home: o.home, port: o.port, realHome: o.realHome ?? homedir() });
  return [
    { cmd: 'rig', args: ['down', RIG], env: 'probe' },
    { cmd: 'rig', args: ['daemon', 'stop'], env: 'probe' },
    { cmd: 'tmux', args: ['kill-server'], env: 'tmux' },
    { cmd: 'rm', args: ['-rf', o.home], env: 'none' },
  ];
}

/** Distinct strings the probe plants in OpenRig and looks for again, all carrying the run id. */
export function markers(run) {
  return {
    annotation: `ledge-probe-annotation-${run}`,
    reason: `ledge-probe-reason-${run}`,
    decision: `ledge-probe-decision-${run}`,
    ping: `ledge-probe-ping-${run}`,
  };
}


// ---------------------------------------------------------------------------------------------------------------------
// Driver

export const VERSION = '0.6.14';
const SEAT = `probe-seat@${RIG}`;
const PEER = `probe-peer@${RIG}`;
const LEDGE = 'ledge@external';
const HUMAN_SEAT = 'human-ledge@host';

/** The steps, in order: id and what the step does. */
export const STEPS = [
  ['preflight', 'rig --version = 0.6.14, free port, mkdtemp, .openrig-fixture, assertSafeTarget, mtimes of ~/.openrig/daemon.json and ~/.openrig/gateway/humans/ (read only)'],
  ['start', 'rig daemon start --port <p> --no-kernel, then wait for GET /healthz (30 s)'],
  ['sse.open', 'GET /api/events?replay=0 as a stream, kept open to the end; each event stamped on arrival'],
  ['rig.up', 'git init <home>/ws, list files, rig up <home>/spec/rig.yaml --cwd <home>/ws --yes --json, list again'],
  ['rig.plan', 'git init <home>/ws2, rig up starter --plan --cwd <home>/ws2 --json, list ws2 before/after'],
  ['read.mirror', 'GET /api/ps, /api/rigs, /api/rigs/summary, /api/rigs/<id>/graph, /api/kernel/status (0.6.14 has no /api/kernel), /api/attention'],
  ['esc.before-register', `as ${SEAT}: rig queue create --destination ${LEDGE} --human-intent decision ... --json (before any human is registered)`],
  ['human.add', 'rig gateway human add ledge ... --binding slack:ledge-decoy:file:<home>/decoy-slack.env:primary --delivery-class D --actor ledge-probe (file absent); human.add.file retries with the file created empty; then human show'],
  ['human.second', 'rig gateway human add other ... (the single-human boundary)'],
  ['esc.create', 'the escalation of esc.before-register, after registration'],
  ['esc.create.source', `the same create outside a seat, with --source ${PEER}`],
  ['esc.read', 'at t+0 and t+10 s: queue/list, queue/<id>, transitions, human-updates, undelivered, attention'],
  ['esc.block', `as seat: create work <w> for ${SEAT}, claim it, block it --on <esc>`],
  ['answer.approve', 'POST /api/mission-control/action approve with actorSession, annotation, reason; then reads and the seat pane'],
  ['answer.twice', 'the same approve again'],
  ['answer.reply-row', `rig queue create --source ${LEDGE} --destination ${SEAT} --summary "Réponse de Ledge : ..." outside a seat`],
  ['answer.header', `a new escalation, approved with header X-OpenRig-Session: ${LEDGE} instead of actorSession`],
  ['deny', 'a new escalation with work blocked on it, denied with a reason'],
  ['planb.park', `as seat: work <w2> blocked --on ${HUMAN_SEAT}; then a create to ${HUMAN_SEAT} --tier human-gate`],
  ['planb.resolve', 'POST /api/mission-control/action resolve <w2> with a decision'],
  ['send.seat', `as ${PEER}: rig send ${SEAT} "<ping>", then the outbox of ${PEER}`],
  ['send.ledge', `outside a seat: rig send ${SEAT} "<ping>-ledge"`],
  ['sse.resume', 'close the stream, reopen with Last-Event-ID: <last id> for 3 s'],
  ['events.catalog', '(computed) distinct data.type with the first step it arrived in and an example'],
  ['guard', 'mtimes of ~/.openrig/daemon.json and ~/.openrig/gateway/humans/ against preflight'],
  ['teardown', 'teardownPlan, then check: the port is closed and <home> is gone (unless --keep)'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
class Refused extends Error {}

/** Parses the whole text as JSON, else the last line (or last `{...}` block) that parses. */
function tryJson(text) {
  const t = (text ?? '').trim();
  if (!t) return undefined;
  try { return JSON.parse(t); } catch { /* fall through */ }
  const lines = t.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines.slice(i).join('\n')); } catch { /* keep looking */ }
  }
  return undefined;
}

/** First `qitemId` (or `id` looking like one) found depth-first. */
function findQitemId(v) {
  if (!v || typeof v !== 'object') return undefined;
  if (typeof v.qitemId === 'string') return v.qitemId;
  for (const x of Object.values(v)) { const r = findQitemId(x); if (r) return r; }
  return undefined;
}

function exec(cmd, args, env, { timeout = 60_000, onSpawn } = {}) {
  return new Promise((done) => {
    let out = '', err = '', settled = false;
    const finish = (r) => { if (!settled) { settled = true; clearTimeout(t); done(r); } };
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    onSpawn?.(child);
    const t = setTimeout(() => { err += `\n[probe: killed after ${timeout} ms]`; child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish({ exit: -1, stdout: out, stderr: err + String(e) }));
    // A launcher may leave a detached child holding the pipes: resolve shortly after exit even if they stay open.
    child.on('exit', (code, sig) => setTimeout(() => finish({ exit: code ?? -1, stdout: out, stderr: err + (sig ? `\n[signal ${sig}]` : '') }), 1500));
    child.on('close', (code, sig) => finish({ exit: code ?? -1, stdout: out, stderr: err + (sig ? `\n[signal ${sig}]` : '') }));
  });
}

const tmuxEnv = (home, port) => Object.fromEntries(Object.entries(probeEnv(process.env, { home, port })).filter(([k]) => !k.startsWith('OPENRIG_')));
const sanitized = () => Object.fromEntries(Object.entries(probeEnv(process.env, { home: '/nonexistent', port: 1 }))
  .filter(([k]) => !k.startsWith('OPENRIG_') && k !== 'TMUX_TMPDIR'));

function freePort() {
  return new Promise((ok, ko) => {
    const srv = createServer();
    srv.once('error', ko);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => ok(port)); });
  });
}
function portOpen(port) {
  return new Promise((ok) => {
    const s = createConnection({ host: '127.0.0.1', port });
    const end = (v) => { s.destroy(); ok(v); };
    s.once('connect', () => end(true));
    s.once('error', () => end(false));
    s.setTimeout(1000, () => end(false));
  });
}

function mtime(p) { try { return statSync(p).mtime.toISOString(); } catch { return null; } }
function userMtimes() {
  const rig = join(homedir(), '.openrig');
  return { 'daemon.json': mtime(join(rig, 'daemon.json')), 'gateway/humans/': mtime(join(rig, 'gateway', 'humans')) };
}

/** Every file under root (with ignored ones, without .git/objects), as `size:mtimeMs`. */
function listFiles(root) {
  const out = {};
  const walk = (dir) => {
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = join(dir, e.name);
      const rel = relative(root, p);
      if (rel === join('.git', 'objects')) continue;
      if (e.isDirectory()) walk(p);
      else { const st = lstatSync(p); out[rel] = `${st.size}:${st.mtimeMs}`; }
    }
  };
  walk(root);
  return out;
}
function diffFiles(a, b) {
  return {
    added: Object.keys(b).filter((k) => !(k in a)),
    removed: Object.keys(a).filter((k) => !(k in b)),
    changed: Object.keys(b).filter((k) => k in a && a[k] !== b[k]),
  };
}

class Probe {
  constructor({ run, home, port, version }) {
    Object.assign(this, { run, home, port, version });
    this.base = `http://127.0.0.1:${port}`;
    this.steps = [];
    this.events = [];
    this.current = 'preflight';
    this.raw = { live: '', resume: '' };
    this.guard = null;
    this.aborting = false;
    this.child = null;
  }
  /** After a signal: no new command or request; the in-flight command is asked to stop. */
  abort() { this.aborting = true; try { this.child?.kill('SIGTERM'); } catch { /* gone */ } }
  check() { if (this.aborting) throw new Refused('openrig-probe: aborting on a signal'); }
  push(step) { this.steps.push(step); return step; }
  data(id, data, note) { this.current = id; return this.push({ id, at: now(), data, ...(note ? { note } : {}) }); }
  async cmd(id, args, { seat, note, cmd = 'rig', timeout, extraEnv } = {}) {
    this.check();
    this.current = id;
    const at = now();
    const env = { ...(cmd === 'tmux' ? tmuxEnv(this.home, this.port) : probeEnv(process.env, { home: this.home, port: this.port, seat })), ...extraEnv };
    const r = await exec(cmd, args, env, { timeout, onSpawn: (c) => { this.child = c; } });
    this.child = null;
    this.push({ id, at, cmd: [cmd, ...args], ...(seat ? { env: { seat } } : {}), exit: r.exit, stdout: r.stdout, stderr: r.stderr, ...(note ? { note } : {}) });
    return { ...r, json: tryJson(r.stdout) };
  }
  async http(id, method, path, { body, headers, note } = {}) {
    this.check();
    this.current = id;
    const at = now();
    const http = { method, path, ...(body !== undefined ? { body } : {}), status: 0 };
    let notes = note ? [note] : [];
    if (headers) notes.push(`request headers: ${JSON.stringify(headers)}`);
    try {
      const res = await fetch(this.base + path, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(headers ?? {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      http.status = res.status;
      const text = await res.text();
      const json = tryJson(text);
      if (json !== undefined) http.json = json; else notes.push(`non-JSON body: ${text.slice(0, 2000)}`);
    } catch (e) {
      notes.push(`request failed: ${e?.cause?.code ?? e?.message ?? e}`);
    }
    this.push({ id, at, http, ...(notes.length ? { note: notes.join(' | ') } : {}) });
    return http;
  }
  /** Opens an SSE stream; events are stamped on arrival and attributed to the current step. */
  async sse(label, path, headers = {}) {
    const ctl = new AbortController();
    const res = await fetch(this.base + path, { headers: { accept: 'text/event-stream', ...headers }, signal: ctl.signal });
    const info = { status: res.status, contentType: res.headers.get('content-type') };
    const pump = (async () => {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value, { stream: true });
          if (this.raw[label].length < 20_000) this.raw[label] += chunk;
          const { events, rest } = parseSse(buf + chunk);
          buf = rest;
          const at = now();
          for (const ev of events) this.events.push({ at, step: this.current, stream: label, ...ev });
        }
      } catch { /* aborted */ }
    })();
    return { info, close: async () => { ctl.abort(); await pump; } };
  }
  report() {
    return { run: this.run, version: this.version, home: this.home, port: this.port, steps: this.steps, events: this.events, guard: this.guard };
  }
}

/** Runs the teardown plan for a home, with a last-resort SIGTERM to a daemon whose environ names this home. */
async function teardown(home, port, { keep = false } = {}) {
  const plan = teardownPlan({ home, port });
  let pid;
  try { pid = Number(JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')).pid); } catch { /* none */ }
  const results = [];
  for (const s of plan) {
    if (keep && s.cmd === 'rm') continue;
    const env = s.env === 'probe' ? probeEnv(process.env, { home, port }) : s.env === 'tmux' ? tmuxEnv(home, port) : sanitized();
    const r = await exec(s.cmd, s.args, env, { timeout: 30_000 });
    results.push({ cmd: [s.cmd, ...s.args], exit: r.exit, stdout: r.stdout, stderr: r.stderr });
    if (s.cmd === 'tmux' && port > 1 && await portOpen(port) && pid && ownsHome(pid, home)) {
      try { process.kill(pid, 'SIGTERM'); results.push({ cmd: ['kill', '-TERM', String(pid)], exit: 0, note: 'port still open after rig daemon stop' }); } catch { /* gone */ }
      for (let i = 0; i < 20 && await portOpen(port); i++) await sleep(250);
    }
  }
  const portClosed = port > 1 ? !(await portOpen(port)) : null;
  return { results, portClosed, homeGone: !existsSync(home) };
}
function ownsHome(pid, home) {
  try { return readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').includes(`OPENRIG_HOME=${home}`); } catch { return false; }
}

function printPlan() {
  const home = join(tmpdir(), 'openrig-qa-ledge-XXXXXX');
  const env = probeEnv({}, { home, port: '<free port, never 7433>' });
  console.log('openrig-probe: dry run. Pass --go to run these steps against a throwaway OpenRig daemon:\n');
  for (const [id, what] of STEPS) console.log(`  ${id.padEnd(20)} ${what}`);
  console.log('\nEnvironment of every probe command (seat steps add OPENRIG_SESSION_NAME):');
  for (const [k, v] of Object.entries(env)) console.log(`  ${k}=${v}`);
  console.log('\nUsage: node scripts/openrig-probe.mjs --go [--report <file.json>] [--keep]');
  console.log('       node scripts/openrig-probe.mjs --teardown <home>');
}

async function teardownCommand(home) {
  home = resolve(home);
  assertSafeTarget({ home, port: 1 });
  let port = 1;
  try { port = Number(readFileSync(join(home, '.probe-port'), 'utf8').trim()) || 1; } catch {
    try { port = Number(JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')).port) || 1; } catch { /* unknown */ }
  }
  const t = await teardown(home, port, { keep: false });
  console.log(JSON.stringify(t, null, 2));
  return t.homeGone && t.portClosed !== false ? 0 : 1;
}

/** Runs the probe. Returns the exit code. */
export async function main(argv) {
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  try {
    if (has('--teardown')) {
      const h = val('--teardown');
      if (!h) { console.error('openrig-probe: --teardown needs a home'); return 1; }
      return await teardownCommand(h);
    }
    if (!has('--go')) { printPlan(); return 2; }
    return await go({ report: val('--report'), keep: has('--keep') });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

async function go(opts) {
  // preflight: version first, before anything is created.
  // Safe under sanitized(): --version prints a constant and reads no OPENRIG_HOME; no OpenRig or tmux identity is passed.
  const v = spawnSync('rig', ['--version'], { encoding: 'utf8', env: sanitized() });
  const version = (v.stdout ?? '').trim();
  const first = version.split(/\s+/)[0];
  if (v.status !== 0 || first !== VERSION) throw new Refused(`openrig-probe: refused: rig ${first || '(none)'}, the probe is written for ${VERSION}`);
  let port;
  do port = await freePort(); while (port === 7433 || String(port) === process.env.OPENRIG_PORT);
  const home = mkdtempSync(join(tmpdir(), 'openrig-qa-ledge-'));
  try { assertSafeTarget({ home, port, userPort: process.env.OPENRIG_PORT }); } catch (e) { rmSync(home, { recursive: true, force: true }); throw e; }

  const run = basename(home).replace('openrig-qa-ledge-', '') + '-' + Date.now().toString(36);
  const m = markers(run);
  const p = new Probe({ run, home, port, version });
  const reportPath = resolve(opts.report ?? join(tmpdir(), `openrig-probe-report-${run}.json`));
  const writeReport = () => { writeFileSync(reportPath, JSON.stringify(p.report(), null, 2)); };
  // One teardown, run by the finally below. A signal only stops new steps and waits for it; repeated signals too.
  let finished;
  const done = new Promise((r) => { finished = r; });
  let signalled = null;
  const onSignal = (sig) => {
    if (!signalled) console.error(`openrig-probe: ${sig}, stopping and tearing down`);
    else console.error(`openrig-probe: ${sig} again, teardown already running`);
    signalled ??= sig;
    p.abort();
    done.then(() => process.exit(130));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const before = userMtimes();
  const ws = join(home, 'ws');
  const ws2 = join(home, 'ws2');
  const files = { q: join(home, 'questions.json'), b: join(home, 'body.md'), r: join(home, 'reply.md'), proof: join(ws, 'PROOF.md') };
  p.guard = { before, after: null, changed: null };
  const humansUnchanged = (id) => {
    const now_ = userMtimes()['gateway/humans/'];
    if (now_ !== before['gateway/humans/']) {
      p.data(id, { 'gateway/humans/': { before: before['gateway/humans/'], after: now_ } }, '~/.openrig/gateway/humans changed');
      throw new Refused(`openrig-probe: refused: ~/.openrig/gateway/humans changed during the probe (${before['gateway/humans/']} -> ${now_})`);
    }
  };

  let live;
  let code = 0;
  try {
    writeFileSync(join(home, '.openrig-fixture'), `ledge openrig probe ${run}\n`);
    writeFileSync(join(home, '.probe-port'), `${port}\n`);
    for (const d of ['tmux', 'shared-docs', 'spec']) mkdirSync(join(home, d), { recursive: true });
    writeFileSync(join(home, 'spec', 'rig.yaml'), probeRigSpec());
    writeFileSync(files.q, questionsJson());
    writeFileSync(files.b, `# Probe decision ${run}\n\nThe probe asks Ledge to choose a branch. Nothing real depends on it.\n`);
    writeFileSync(files.r, `Réponse de Ledge : ${m.decision}\n`);
    p.push({ id: 'preflight', at: now(), cmd: ['rig', '--version'], exit: v.status, stdout: v.stdout, stderr: v.stderr,
      data: { home, port, userOpenrigPort: process.env.OPENRIG_PORT ?? null, mtimes: before, markers: m } });
    console.log(`openrig-probe: run ${run}, home ${home}, port ${port}`);

    // start
    // SHELL=/bin/sh reaches the daemon and the tmux server it starts, whose default-shell runs in the seat panes:
    // typed envelopes then land in sh, not in the user's login shell.
    const st = await p.cmd('start', ['daemon', 'start', '--port', String(port), '--no-kernel'], { timeout: 90_000, extraEnv: { SHELL: '/bin/sh' },
      note: 'env adds SHELL=/bin/sh for the seat panes' });
    let healthy = false;
    for (const deadline = Date.now() + 30_000; Date.now() < deadline;) {
      p.check();
      try { const r = await fetch(`${p.base}/healthz`, { signal: AbortSignal.timeout(2000) }); if (r.ok) { healthy = true; break; } } catch { /* not yet */ }
      await sleep(500);
    }
    await p.http('start', 'GET', '/healthz');
    if (!healthy) throw new Refused(`openrig-probe: daemon not healthy on ${port} after 30 s (start exit ${st.exit})`);

    // sse.open
    p.current = 'sse.open';
    const sseAt = now();
    live = await p.sse('live', '/api/events?replay=0');
    const sseStep = p.push({ id: 'sse.open', at: sseAt, http: { method: 'GET', path: '/api/events?replay=0', status: live.info.status }, note: `content-type: ${live.info.contentType}` });

    const step = async (id, fn) => {
      try { await fn(); } catch (e) {
        if (e instanceof Refused) throw e;
        p.push({ id, at: now(), note: `driver error: ${e?.stack ?? e}` });
      }
    };
    const pane = (id) => p.cmd(id, ['capture-pane', '-p', '-S', '-500', '-t', SEAT], { cmd: 'tmux',
      note: 'brief form plus -S -500 (scrollback), so markers that scrolled off are still seen' });
    const create = (id, args, o) => p.cmd(id, ['queue', 'create', ...args, '--json'], o);
    const escArgs = (summary) => ['--destination', LEDGE, '--human-intent', 'decision', '--summary', summary,
      '--evidence-ref', files.proof, '--human-questions-file', files.q, '--body-file', files.b];
    const qid = (r) => findQitemId(r.json);
    // Seat work rows need a body in 0.6.14 (the CLI refuses a create without --body/--body-file).
    const work = (id, summary) => create(id, ['--destination', SEAT, '--summary', summary, '--body', `${summary} (${run})`], { seat: SEAT });
    let rigId, esc, w, w2;

    await step('rig.up', async () => {
      await p.cmd('rig.up', ['init', ws], { cmd: 'git' });
      writeFileSync(files.proof, `# PROOF ${run}\n\nEvidence the probe points the human at.\n`);
      const a = listFiles(ws);
      p.data('rig.up', { files: a }, `ws listing before rig up (with ignored files, without .git/objects)`);
      await p.cmd('rig.up', ['up', join(home, 'spec', 'rig.yaml'), '--cwd', ws, '--yes', '--json'], { timeout: 120_000 });
      for (const deadline = Date.now() + 30_000; Date.now() < deadline; await sleep(1000)) {
        try { const t = await (await fetch(`${p.base}/api/ps`)).text(); if (t.includes(SEAT) && t.includes(PEER)) break; } catch { /* retry */ }
      }
      await sleep(2000);
      const b = listFiles(ws);
      p.data('rig.up', { files: b, diff: diffFiles(a, b) }, 'ws listing after rig up, and the diff');
    });

    await step('rig.plan', async () => {
      await p.cmd('rig.plan', ['init', ws2], { cmd: 'git' });
      const a = listFiles(ws2);
      await p.cmd('rig.plan', ['up', 'starter', '--plan', '--cwd', ws2, '--json'], { timeout: 120_000 });
      const b = listFiles(ws2);
      p.data('rig.plan', { before: a, after: b, diff: diffFiles(a, b) }, 'ws2 listing before/after the plan');
    });

    await step('read.mirror', async () => {
      await p.http('read.mirror', 'GET', '/api/ps');
      const rigs = await p.http('read.mirror', 'GET', '/api/rigs');
      const list = Array.isArray(rigs.json) ? rigs.json : rigs.json?.rigs ?? [];
      rigId = list.find((r) => r?.name === RIG)?.id;
      await p.http('read.mirror', 'GET', '/api/rigs/summary');
      await p.http('read.mirror', 'GET', `/api/rigs/${encodeURIComponent(rigId ?? RIG)}/graph`, rigId ? {} : { note: 'rig id not found in /api/rigs, used the name' });
      await p.http('read.mirror', 'GET', '/api/kernel/status', { note: 'brief says /api/kernel; 0.6.14 only serves /api/kernel/status' });
      await p.http('read.mirror', 'GET', '/api/attention');
    });

    await step('esc.before-register', () => create('esc.before-register', escArgs(`Probe decision before register ${run}`), { seat: SEAT }));

    await step('human.add', async () => {
      const add = (id, entity, name, binding) => p.cmd(id, ['gateway', 'human', 'add', entity, '--display-name', name,
        '--binding', binding, '--delivery-class', 'D', '--actor', 'ledge-probe']);
      const decoy = join(home, 'decoy-slack.env');
      let r = await add('human.add', 'ledge', 'Ledge', `slack:ledge-decoy:file:${decoy}:primary`);
      if (r.exit !== 0) {
        writeFileSync(decoy, '');
        r = await add('human.add.file', 'ledge', 'Ledge', `slack:ledge-decoy:file:${decoy}:primary`);
      }
      const path = r.json?.path;
      if (r.exit === 0 && typeof path !== 'string') {
        p.data('guard.path', { path: path ?? null, underHome: false }, 'human add succeeded without a parseable path');
        throw new Refused('openrig-probe: refused: human add succeeded but printed no path to check');
      }
      if (typeof path === 'string') {
        try { assertUnder(path, home); p.data('guard.path', { path, underHome: true }); } catch (e) {
          p.data('guard.path', { path, underHome: false }, e.message);
          throw new Refused(e.message);
        }
      }
      humansUnchanged('guard.path');
      await p.cmd('human.add', ['gateway', 'human', 'show', 'ledge', '--json']);
    });

    await step('human.second', () => p.cmd('human.second', ['gateway', 'human', 'add', 'other', '--display-name', 'Other',
      '--binding', `slack:x:file:${join(home, 'x.env')}:primary`, '--delivery-class', 'D', '--actor', 'ledge-probe']));

    await step('esc.create', async () => { esc = qid(await create('esc.create', escArgs(`Probe decision ${run}`), { seat: SEAT })); });
    await step('esc.create.source', () => create('esc.create.source', [...escArgs(`Probe decision from source ${run}`), '--source', PEER]));

    await step('esc.read', async () => {
      for (const t of ['t+0', 't+10s']) {
        if (t !== 't+0') await sleep(10_000);
        await p.http('esc.read', 'GET', `/api/queue/list?destinationSession=${encodeURIComponent(LEDGE)}`, { note: t });
        if (esc) {
          await p.http('esc.read', 'GET', `/api/queue/${esc}`, { note: t });
          await p.http('esc.read', 'GET', `/api/queue/${esc}/transitions`, { note: t });
        }
        await p.http('esc.read', 'GET', '/api/queue/human-updates', { note: t });
        await p.http('esc.read', 'GET', '/api/queue/undelivered', { note: t });
        await p.http('esc.read', 'GET', '/api/attention', { note: t });
      }
    });

    await step('esc.block', async () => {
      w = qid(await work('esc.block', 'work'));
      if (!w) return;
      await p.cmd('esc.block', ['queue', 'claim', w, '--json'], { seat: SEAT, note: 'brief form plus --json' });
      await p.cmd('esc.block', ['queue', 'block', w, '--on', esc ?? '(no esc)', '--json'], { seat: SEAT });
      await p.http('esc.block', 'GET', `/api/queue/${w}`);
    });

    await step('answer.approve', async () => {
      await p.http('answer.approve', 'POST', '/api/mission-control/action',
        { body: { verb: 'approve', qitemId: esc, actorSession: LEDGE, annotation: m.annotation, reason: m.reason } });
      await sleep(3000);
      if (esc) await p.http('answer.approve', 'GET', `/api/queue/${esc}`);
      if (esc) await p.http('answer.approve', 'GET', `/api/queue/${esc}/transitions`);
      if (w) await p.http('answer.approve', 'GET', `/api/queue/${w}`);
      if (w) await p.http('answer.approve', 'GET', `/api/queue/${w}/transitions`);
      await p.http('answer.approve', 'GET', `/api/queue/list?destinationSession=${encodeURIComponent(SEAT)}`);
      await p.http('answer.approve', 'GET', `/api/mission-control/audit?qitem_id=${esc}`);
      await pane('answer.approve');
    });

    await step('answer.twice', () => p.http('answer.twice', 'POST', '/api/mission-control/action',
      { body: { verb: 'approve', qitemId: esc, actorSession: LEDGE, annotation: m.annotation, reason: m.reason } }));

    await step('answer.reply-row', async () => {
      await create('answer.reply-row', ['--source', LEDGE, '--destination', SEAT, '--summary', `Réponse de Ledge : ${m.decision}`, '--body-file', files.r]);
      await sleep(2000);
      await pane('answer.reply-row');
    });

    await step('answer.header', async () => {
      const e2 = qid(await create('answer.header', escArgs(`Probe decision header ${run}`), { seat: SEAT }));
      await p.http('answer.header', 'POST', '/api/mission-control/action',
        { body: { verb: 'approve', qitemId: e2, annotation: `${m.annotation}-header`, reason: `${m.reason}-header` }, headers: { 'X-OpenRig-Session': LEDGE } });
      await p.http('answer.header', 'GET', `/api/mission-control/audit?qitem_id=${e2}`);
      if (e2) await p.http('answer.header', 'GET', `/api/queue/${e2}/transitions`);
    });

    await step('deny', async () => {
      const e3 = qid(await create('deny', escArgs(`Probe decision deny ${run}`), { seat: SEAT }));
      const w3 = qid(await work('deny', 'work blocked on the denied escalation'));
      if (w3) {
        await p.cmd('deny', ['queue', 'claim', w3, '--json'], { seat: SEAT });
        await p.cmd('deny', ['queue', 'block', w3, '--on', e3 ?? '(no esc)', '--json'], { seat: SEAT });
      }
      await p.http('deny', 'POST', '/api/mission-control/action', { body: { verb: 'deny', qitemId: e3, actorSession: LEDGE, reason: `${m.reason}-deny` } });
      await sleep(3000);
      if (e3) await p.http('deny', 'GET', `/api/queue/${e3}`);
      if (w3) await p.http('deny', 'GET', `/api/queue/${w3}`);
      if (w3) await p.http('deny', 'GET', `/api/queue/${w3}/transitions`);
    });

    await step('planb.park', async () => {
      w2 = qid(await work('planb.park', 'work parked on the human'));
      if (w2) {
        await p.cmd('planb.park', ['queue', 'claim', w2, '--json'], { seat: SEAT });
        await p.cmd('planb.park', ['queue', 'block', w2, '--on', HUMAN_SEAT, '--summary', `Probe plan B decision ${run}`, '--evidence-ref', files.proof, '--json'], { seat: SEAT });
      }
      await create('planb.park', ['--destination', HUMAN_SEAT, '--tier', 'human-gate', '--summary', `Probe plan B gate ${run}`,
        '--evidence-ref', files.proof, '--body-file', files.b], { seat: SEAT });
      await p.http('planb.park', 'GET', `/api/queue/list?destinationSession=${encodeURIComponent(HUMAN_SEAT)}`);
      if (w2) await p.http('planb.park', 'GET', `/api/queue/${w2}`);
      await p.http('planb.park', 'GET', '/api/attention');
    });

    await step('planb.resolve', async () => {
      await p.http('planb.resolve', 'POST', '/api/mission-control/action', { body: { verb: 'resolve', qitemId: w2, decision: m.decision, actorSession: LEDGE } });
      await sleep(3000);
      if (w2) await p.http('planb.resolve', 'GET', `/api/queue/${w2}`);
      if (w2) await p.http('planb.resolve', 'GET', `/api/queue/${w2}/transitions`);
      await pane('planb.resolve');
    });

    await step('send.seat', async () => {
      await p.cmd('send.seat', ['send', SEAT, m.ping], { seat: PEER });
      await sleep(2000);
      await p.http('send.seat', 'GET', `/api/queue/outbox/list?senderSession=${encodeURIComponent(PEER)}`);
      await pane('send.seat');
    });

    await step('send.ledge', async () => {
      await p.cmd('send.ledge', ['send', SEAT, `${m.ping}-ledge`]);
      await sleep(2000);
      await p.http('send.ledge', 'GET', `/api/queue/outbox/list?senderSession=${encodeURIComponent(LEDGE)}`, { note: 'guess: no sender identity was set; ledge@external is probed' });
      await pane('send.ledge');
    });

    await step('sse.resume', async () => {
      await live.close();
      live = null;
      const seen = new Set(p.events.filter((e) => e.stream === 'live').map((e) => e.id));
      const lastId = Math.max(0, ...[...seen].filter(Number.isFinite));
      p.current = 'sse.resume';
      const at = now();
      const r = await p.sse('resume', '/api/events', { 'Last-Event-ID': String(lastId) });
      await sleep(3000);
      await r.close();
      const got = p.events.filter((e) => e.stream === 'resume').map((e) => e.id);
      p.push({ id: 'sse.resume', at, http: { method: 'GET', path: '/api/events', status: r.info.status },
        data: { lastEventId: lastId, received: got, repeated: got.filter((id) => seen.has(id)) }, note: `request header Last-Event-ID: ${lastId}` });
    });
    sseStep.stdout = p.raw.live;
    sseStep.data = { eventLinePresent: /^event:/m.test(p.raw.live), idLinePresent: /^id:/m.test(p.raw.live), rawPrefixChars: p.raw.live.length };

    const catalog = new Map();
    for (const e of p.events) {
      const c = catalog.get(e.type);
      if (c) c.count++; else catalog.set(e.type, { type: e.type, firstStep: e.step, count: 1, example: e.data });
    }
    p.data('events.catalog', [...catalog.values()]);
  } catch (e) {
    code = 1;
    p.push({ id: p.current, at: now(), note: `aborted: ${e?.stack ?? e}` });
    console.error(e instanceof Error ? e.message : String(e));
  } finally {
    if (live) await live.close().catch(() => {});
    const after = userMtimes();
    p.guard = { before, after, changed: Object.keys(before).filter((k) => before[k] !== after[k]) };
    p.data('guard', p.guard, 'the real daemon may write on its own: noted, not concluded');
    writeReport();
    console.log(`openrig-probe: report ${reportPath}`);
    try {
      const at = now();
      const t = await teardown(home, port, { keep: opts.keep });
      const notes = [opts.keep && '--keep: home left in place', signalled && `after ${signalled}`].filter(Boolean);
      p.push({ id: 'teardown', at, data: t, ...(notes.length ? { note: notes.join(' | ') } : {}) });
      writeReport();
      console.log(`openrig-probe: teardown: port ${t.portClosed ? 'closed' : 'STILL OPEN'}, home ${t.homeGone ? 'removed' : 'still there'}`);
    } finally { finished(); }
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
  if (signalled) return 130;
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
}
