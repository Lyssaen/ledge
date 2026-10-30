#!/usr/bin/env node
// Probe of a throwaway OpenRig daemon. This file holds the pure building blocks; the driver comes later.
// It never targets ~/.openrig or port 7433: assertSafeTarget refuses both.
import { existsSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, relative, resolve, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const RIG = 'ledge-probe';

const fail = (msg) => { throw new Error(`openrig-probe: refused: ${msg}`); };
const isUnder = (path, dir) => {
  const rel = relative(resolve(dir), resolve(path));
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
};
const real = (p) => { const r = resolve(p); try { return existsSync(r) ? realpathSync(r) : r; } catch { return r; } };

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
  if (o.realHome && (home === real(resolve(o.realHome, '.openrig')) || isUnder(home, real(resolve(o.realHome, '.openrig'))))) fail(`home ${o.home} is the user's ~/.openrig`);
  const roots = [tmpdir(), '/tmp'].map(real);
  if (!roots.some((r) => isUnder(home, r)) || !basename(home).startsWith('openrig-qa-')) {
    fail(`home ${o.home} is not a temp openrig-qa-* directory`);
  }
}

/** Refuses a path that is not inside the throwaway home. */
export function assertUnder(path, home) {
  if (!isUnder(path, home)) fail(`wrote outside ${home}: ${path}`);
}

/** The `ledge-probe` rig: two terminal seats in pod `probe` (sessions probe-seat@ledge-probe, probe-peer@ledge-probe). */
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
    { question: 'Which branch should the probe use?', options: [
      { label: 'main', recommended: true }, { label: 'develop' }, { label: 'a new branch' }] },
    { question: 'Run the slow checks too?', options: [
      { label: 'yes' }, { label: 'no', recommended: true }] },
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error('openrig-probe: no driver yet');
  process.exit(1);
}
