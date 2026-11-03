import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conptyPanes } from '../src/panes/conpty.js';

const node = process.execPath;
const panes = conptyPanes({ cols: 80, rows: 24 });
const until = async (pred: () => Promise<boolean> | boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await pred()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('timeout');
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
let n = 0;
const name = () => `ledge-t${process.pid}-${n++}`;
afterEach(async () => { for (const s of await panes.listSessions()) await panes.killSession(s); });

// node-pty ships prebuilds for Windows and macOS only: on Linux it loads once built (node-gyp), which a plain install
// does not do. The panes are Windows' (tmux runs agents elsewhere): without a loadable node-pty these tests skip.
const pty = await import('node-pty').then(() => true, () => false);

type SpawnFn = NonNullable<NonNullable<Parameters<typeof conptyPanes>[0]>['spawn']>;
/** A pty that records its writes and exits when told: `exit(code)`. */
function fakePty(pid = 999_999) {
  const writes: Array<{ at: number; data: string }> = []; const kills: string[] = [];
  let onExit: (e: { exitCode: number }) => void = () => {}; let onData: (d: string) => void = () => {};
  const spawn = (() => ({ pid, onData: (f: typeof onData) => { onData = f; }, onExit: (f: typeof onExit) => { onExit = f; }, write: (data: string) => { writes.push({ at: Date.now(), data }); }, kill: (sig?: string) => { kills.push(sig ?? ''); } })) as unknown as SpawnFn;
  return { spawn, writes, kills, exit: (exitCode: number) => onExit({ exitCode }), out: (d: string) => onData(d) };
}

describe('conptyPanes, with a fake pty', () => {
  it('writes of two sendText calls do not interleave', async () => {
    const f = fakePty(); const p = conptyPanes({ spawn: f.spawn });
    await p.newSession({ name: 'q', cwd: tmpdir(), env: {}, command: [node] });
    await Promise.all([p.sendText('q', 'a'.repeat(600)), p.sendKeys('q', ['Escape']), p.sendText('q', 'b'.repeat(600))]);
    expect(f.writes.map(w => w.data).join('')).toBe('a'.repeat(600) + '\x1b' + 'b'.repeat(600));
  });
  it('a kill that times out falls back to pty.kill, says so, and forgets the pane', async () => {
    const f = fakePty(); const log = vi.fn(); const p = conptyPanes({ spawn: f.spawn, killWaitMs: 200, log });
    await p.newSession({ name: 'k', cwd: tmpdir(), env: {}, command: [node] });
    await p.killSession('k');
    expect(f.kills.length).toBeGreaterThan(0);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/k.*did not end/));
    expect(await p.hasSession('k')).toBe(false);
  });
  it('an attach racing the exit is refused, never left waiting for an end that came already', async () => {
    const f = fakePty(); const p = conptyPanes({ spawn: f.spawn });
    await p.newSession({ name: 'a', cwd: tmpdir(), env: {}, command: [node] });
    const ends: Array<number | null> = [];
    const pending = p.attachTo('a', { data: () => {}, end: c => ends.push(c) });
    f.exit(6);
    const a = await pending;
    expect(a === null || ends.length === 1).toBe(true);
  });
  it('a capture racing the exit answers, and nothing complains of a disposed terminal', async () => {
    const f = fakePty(); const p = conptyPanes({ spawn: f.spawn });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {}); const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const writes = vi.spyOn(process.stderr, 'write');
    await p.newSession({ name: 'c', cwd: tmpdir(), env: {}, command: [node] });
    f.out('hello\r\n');
    const pending = p.capture('c', 10);
    f.exit(0);
    await expect(pending).resolves.not.toBeUndefined();
    await new Promise(r => setTimeout(r, 50));
    const said = [...errors.mock.calls, ...warns.mock.calls, ...writes.mock.calls].map(c => String(c[0])).join('\n');
    errors.mockRestore(); warns.mockRestore(); writes.mockRestore();
    expect(said).not.toMatch(/dispos/i);
  });

  it('writes a long text in slices of 256 characters, 20 ms apart (claude.exe keeps only the end of one big write)', async () => {
    const writes: Array<{ at: number; data: string }> = [];
    const fake = (() => ({ pid: 1, onData: () => {}, onExit: () => {}, write: (data: string) => { writes.push({ at: Date.now(), data }); }, kill: () => {} })) as unknown as Parameters<typeof conptyPanes>[0] extends infer O ? O extends { spawn?: infer F } ? F : never : never;
    const p = conptyPanes({ spawn: fake });
    await p.newSession({ name: 'w', cwd: tmpdir(), env: {}, command: [node] });
    const text = 'é'.repeat(600);
    await p.sendText('w', text);
    expect(writes.map(w => w.data.length)).toEqual([256, 256, 88]);
    expect(writes.map(w => w.data).join('')).toBe(text);
    for (let i = 1; i < writes.length; i++) expect(writes[i]!.at - writes[i - 1]!.at).toBeGreaterThanOrEqual(15);
    await p.sendText('w', 'short');
    expect(writes.at(-1)!.data).toBe('short');
  });
});

describe.skipIf(!pty)('conptyPanes', () => {
  it('runs a command with env and cwd, and captures its output', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'panes-')));
    const s = name();
    await panes.newSession({ name: s, cwd, env: { ...process.env, X: 'from-env' } as Record<string, string>, command: [node, '-e', 'console.log(process.cwd()); console.log(process.env.X); setTimeout(() => {}, 5000)'] });
    await until(async () => /from-env/.test((await panes.capture(s, 50)) ?? ''));
    const text = (await panes.capture(s, 50))!;
    expect(text).toContain(cwd);
    expect(text).toContain('from-env');
    expect(await panes.width!(s)).toBe(80);
  });

  it('keeps a full-width rule and the line under it apart (ConPTY marks the row after a full one as wrapped)', async () => {
    const s = name();
    await panes.newSession({ name: s, cwd: tmpdir(), env: process.env as Record<string, string>, command: [node, '-e', "process.stdout.write('\u2500'.repeat(80) + '\\r\\n Create file\\r\\n'); setTimeout(() => {}, 5000)"] });
    await until(async () => /Create file/.test((await panes.capture(s, 50)) ?? ''));
    expect((await panes.capture(s, 50))!.split('\n')).toContain(' Create file');
  });

  it('drops the unset variables', async () => {
    const s = name();
    await panes.newSession({ name: s, cwd: tmpdir(), env: { ...process.env, A: '1', B: '2' } as Record<string, string>, unset: ['B'], command: [node, '-e', 'console.log(`A=${process.env.A} B=${process.env.B}`); setTimeout(() => {}, 5000)'] });
    await until(async () => /A=1/.test((await panes.capture(s, 50)) ?? ''));
    expect(await panes.capture(s, 50)).toContain('A=1 B=undefined');
  });

  it('types text and keys', async () => {
    const s = name();
    await panes.newSession({ name: s, cwd: tmpdir(), env: process.env as Record<string, string>, command: [node, '-e', "process.stdin.setRawMode(true); let b=''; process.stdin.on('data', d => { b += d; if (b.includes('\\r')) { console.log('\\ngot:' + b.trim()); b=''; } })"] });
    await new Promise(r => setTimeout(r, 500));
    await panes.sendText(s, 'hello');
    await panes.sendKeys(s, ['Enter']);
    await until(async () => /got:hello/.test((await panes.capture(s, 50)) ?? ''));
    await expect(panes.sendText(s, 'a\nb')).rejects.toThrow(/newlines/);
  });

  it('types a long text whole (one big ConPTY write keeps only its end)', async () => {
    const s = name();
    await panes.newSession({ name: s, cwd: tmpdir(), env: process.env as Record<string, string>, command: [node, '-e', "process.stdin.setRawMode(true); let n = 0; process.stdin.on('data', d => { const t = String(d); const i = t.indexOf('\\r'); if (i < 0) n += t.length; else { console.log('\\ncount=' + (n + i)); n = 0; } })"] });
    await new Promise(r => setTimeout(r, 500));
    await panes.sendText(s, 'x'.repeat(5000));
    await panes.sendKeys(s, ['Enter']);
    await until(async () => /count=\d+/.test((await panes.capture(s, 50)) ?? ''));
    expect(/count=(\d+)/.exec((await panes.capture(s, 50))!)![1]).toBe('5000');
  }, 20_000);


  it('reports exit', async () => {
    const s = name();
    await panes.newSession({ name: s, cwd: tmpdir(), env: process.env as Record<string, string>, command: [node, '-e', 'process.exit(3)'] });
    await until(async () => !(await panes.hasSession(s)));
    expect(await panes.listSessions()).not.toContain(s);
    expect(panes.exitCode(s)).toBe(3);
    expect(await panes.capture(s, 10)).toBeNull();
  });

  it('kills a tree', async () => {
    const s = name();
    await panes.newSession({ name: s, cwd: tmpdir(), env: process.env as Record<string, string>, command: [node, '-e', "const c = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' }); console.log('child=' + c.pid); setTimeout(() => {}, 60000)"] });
    await until(async () => /child=\d+/.test((await panes.capture(s, 50)) ?? ''));
    const child = Number(/child=(\d+)/.exec((await panes.capture(s, 50))!)![1]);
    expect(alive(child)).toBe(true);
    await panes.killSession(s);
    expect(await panes.hasSession(s)).toBe(false);
    await until(() => !alive(child));
  });

  it('runs a program named without its .exe, found on the PATH', async () => {
    const s = name();
    await panes.newSession({ name: s, cwd: tmpdir(), env: process.env as Record<string, string>, command: ['node', '-e', 'console.log("by-name"); setTimeout(() => {}, 5000)'] });
    await until(async () => /by-name/.test((await panes.capture(s, 50)) ?? ''));
  });

  it('refuses a second session with the same name', async () => {
    const s = name();
    const opts = { name: s, cwd: tmpdir(), env: process.env as Record<string, string>, command: [node, '-e', 'setTimeout(() => {}, 5000)'] };
    await panes.newSession(opts);
    await expect(panes.newSession(opts)).rejects.toThrow(/exists/);
  });
});
