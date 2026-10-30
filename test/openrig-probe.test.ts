import { describe, it, expect } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error plain ESM script without types
import { probeEnv, assertSafeTarget, assertUnder, probeRigSpec, questionsJson, parseSse, teardownPlan, markers } from '../scripts/openrig-probe.mjs';

describe('probeEnv', () => {
  it('drops every inherited OpenRig, Ledge and tmux identity and sets the throwaway ones', () => {
    const env = probeEnv({ PATH: '/bin', OPENRIG_SESSION_NAME: 'x@y', OPENRIG_NODE_ID: 'n', OPENRIG_URL: 'http://127.0.0.1:7433',
      OPENRIG_PORT: '7433', RIGGED_HOME: '/h', LEDGE_SESSION: 's', TMUX: '/tmp/t,1,0', TMUX_PANE: '%1' }, { home: '/tmp/openrig-qa-ledge-a', port: 7512 });
    expect(env).toEqual({ PATH: '/bin', OPENRIG_HOME: '/tmp/openrig-qa-ledge-a', OPENRIG_URL: 'http://127.0.0.1:7512', OPENRIG_PORT: '7512',
      OPENRIG_SHARED_DOCS_ROOT: '/tmp/openrig-qa-ledge-a/shared-docs', TMUX_TMPDIR: '/tmp/openrig-qa-ledge-a/tmux' });
  });
  it('adds the seat identity only when asked', () => {
    expect(probeEnv({}, { home: '/tmp/openrig-qa-ledge-a', port: 7512, seat: 'probe-seat@ledge-probe' }).OPENRIG_SESSION_NAME).toBe('probe-seat@ledge-probe');
  });
});
describe('assertSafeTarget', () => {
  const ok = { home: join(tmpdir(), 'openrig-qa-ledge-a'), port: 7512, realHome: '/home/u' };
  it('accepts a temp openrig-qa home on another port', () => expect(() => assertSafeTarget(ok)).not.toThrow());
  it('refuses port 7433', () => expect(() => assertSafeTarget({ ...ok, port: 7433 })).toThrow(/^openrig-probe: refused: port 7433/));
  it("refuses the user's own OPENRIG_PORT", () => expect(() => assertSafeTarget({ ...ok, userPort: '7512' })).toThrow(/refused: port 7512/));
  it('refuses ~/.openrig and anything outside the temp dir', () => {
    expect(() => assertSafeTarget({ ...ok, home: '/home/u/.openrig' })).toThrow(/refused: home/);
    expect(() => assertSafeTarget({ ...ok, home: '/home/u/openrig-qa-x' })).toThrow(/refused: home/);
  });
});
describe('assertUnder', () => {
  it('refuses a path outside the home', () => expect(() => assertUnder('/home/u/.openrig/gateway/humans/ledge.yaml', '/tmp/openrig-qa-ledge-a')).toThrow(/refused: wrote outside/));
});
describe('probeRigSpec', () => {
  it('is a 0.2 spec with two terminal seats in pod probe', () => {
    const y = probeRigSpec();
    expect(y).toMatch(/^version: "0\.2"\nname: ledge-probe\n/);
    expect(y.match(/runtime: terminal/g)).toHaveLength(2);
    expect(y).toContain('agent_ref: "builtin:terminal"'); expect(y).toContain('profile: none');
    expect(y).toMatch(/- id: seat\b/); expect(y).toMatch(/- id: peer\b/);
  });
});
describe('questionsJson', () => {
  it('holds 2 questions of 2 to 4 options, one recommended each', () => {
    const q = JSON.parse(questionsJson());
    expect(q).toHaveLength(2);
    for (const x of q) { expect(x.options.length).toBeGreaterThanOrEqual(2); expect(x.options.filter((o: { recommended?: boolean }) => o.recommended)).toHaveLength(1); }
  });
});
describe('parseSse', () => {
  it('reads id and data frames, keeps the type from data, and returns the unfinished tail', () => {
    const r = parseSse('id: 4\ndata: {"seq":4,"type":"queue.created"}\n\nid: 5\ndata: {"seq":5,"ty');
    expect(r.events).toEqual([{ id: 4, type: 'queue.created', data: { seq: 4, type: 'queue.created' } }]);
    expect(r.rest).toBe('id: 5\ndata: {"seq":5,"ty');
  });
  it('ignores comment and keep-alive lines', () => expect(parseSse(':\n\n').events).toEqual([]));
});
describe('teardownPlan', () => {
  it('downs the rig, stops the daemon, kills the isolated tmux server, then removes the home, in that order', () => {
    expect(teardownPlan({ home: '/tmp/openrig-qa-ledge-a', port: 7512 }).map(s => [s.cmd, ...s.args].join(' '))).toEqual([
      'rig down ledge-probe', 'rig daemon stop', 'tmux kill-server', 'rm -rf /tmp/openrig-qa-ledge-a']);
  });
});
describe('markers', () => {
  it('are distinct and carry the run id', () => {
    const m = markers('r1'); expect(new Set(Object.values(m)).size).toBe(4); for (const v of Object.values(m)) expect(v).toContain('r1');
  });
});

describe('fix round 1', () => {
  it('strips every RIGGED_ key', () => {
    expect(probeEnv({ RIGGED_FOO: '1', RIGGED_HOME: '/h', PATH: '/bin' }, { home: '/tmp/openrig-qa-a', port: 7512 }).RIGGED_FOO).toBeUndefined();
  });
  const ok = { home: join(tmpdir(), 'openrig-qa-ledge-a'), port: 7512, realHome: '/home/u' };
  it('coerces the port and refuses invalid ones', () => {
    expect(() => assertSafeTarget({ ...ok, port: '7433' as unknown as number })).toThrow(/refused: port 7433/);
    for (const port of [0, 70000, 75.5, NaN]) expect(() => assertSafeTarget({ ...ok, port })).toThrow(/refused: port/);
  });
  it('refuses a symlink into ~/.openrig and a symlink out of tmp', () => {
    const d = mkdtempSync(join(tmpdir(), 'openrig-qa-fix-'));
    try {
      mkdirSync(join(d, 'real', '.openrig'), { recursive: true });
      symlinkSync(join(d, 'real', '.openrig'), join(d, 'openrig-qa-link'));
      expect(() => assertSafeTarget({ home: join(d, 'openrig-qa-link'), port: 7512, realHome: join(d, 'real') })).toThrow(/refused: home/);
      expect(() => assertSafeTarget({ home: join(d, 'real', '.openrig', 'x'), port: 7512, realHome: join(d, 'real') })).toThrow(/refused: home/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it('assertUnder accepts a child and a name starting with two dots', () => {
    expect(() => assertUnder('/tmp/openrig-qa-a/..x/f', '/tmp/openrig-qa-a')).not.toThrow();
    expect(() => assertUnder('/tmp/openrig-qa-a/../b', '/tmp/openrig-qa-a')).toThrow(/refused: wrote outside/);
  });
  it('teardownPlan refuses a non-probe home and tags env kinds', () => {
    expect(() => teardownPlan({ home: '/home/u/.openrig', port: 7512 })).toThrow(/refused/);
    expect(teardownPlan({ home: '/tmp/openrig-qa-ledge-a', port: 7512 }).map((s: { env: string }) => s.env)).toEqual(['probe', 'probe', 'tmux', 'none']);
  });
  it('parseSse accepts CRLF', () => {
    expect(parseSse('id: 1\r\ndata: {"type":"a"}\r\n\r\n').events).toEqual([{ id: 1, type: 'a', data: { type: 'a' } }]);
  });
});

describe('fix round 2', () => {
  it('resolves through the nearest existing ancestor (symlinked parent, dangling link)', () => {
    const d = mkdtempSync(join(tmpdir(), 'openrig-qa-fix2-'));
    try {
      mkdirSync(join(d, 'real', '.openrig'), { recursive: true });
      symlinkSync(join(d, 'real', '.openrig'), join(d, 'link'));
      symlinkSync(join(d, 'real', '.openrig', 'gone'), join(d, 'openrig-qa-dangling'));
      const realHome = join(d, 'real');
      expect(() => assertSafeTarget({ home: join(d, 'link', 'openrig-qa-new'), port: 7512, realHome })).toThrow(/refused: home/);
      expect(() => assertSafeTarget({ home: join(d, 'openrig-qa-dangling'), port: 7512, realHome })).toThrow(/refused: home/);
      expect(() => assertSafeTarget({ home: join(d, 'openrig-qa-ok', 'x'), port: 7512, realHome })).toThrow(/refused: home/);
      expect(() => assertSafeTarget({ home: join(d, 'openrig-qa-ok'), port: 7512, realHome })).not.toThrow();
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it('defaults realHome to the real home directory', () => {
    expect(() => assertSafeTarget({ home: join(homedir(), '.openrig'), port: 7512 } as never)).toThrow(/refused: home/);
  });
});
