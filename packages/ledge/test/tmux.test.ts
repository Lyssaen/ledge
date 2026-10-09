import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { realTmux, run } from '../src/tmux.js';
import { ensureLedgeDir } from '../src/paths.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const socket = 'ledge-test-' + process.pid;
const tmux = realTmux(socket);
const name = 'ledge-t1';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

beforeAll(async () => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); await ensureLedgeDir(); });
afterAll(async () => {
  for (const s of await tmux.listSessions()) await tmux.killSession(s);
  await run(['-L', socket, 'kill-server']);
});

describe('tmux', () => {
  it('creates a session running a command with env and cwd', async () => {
    await tmux.newSession({ name, cwd: '/tmp', env: { LEDGE_SESSION: 't1' }, command: ['sh', '-c', 'echo "LS=$LEDGE_SESSION PWD=$(pwd)"; cat'] });
    await sleep(300);
    expect(await tmux.hasSession(name)).toBe(true);
    expect(await tmux.listSessions()).toContain(name);
    const out = await tmux.capture(name, 5);
    expect(out).toContain('LS=t1 PWD=/tmp');
  });
  it('sends text literally, then Enter separately', async () => {
    await tmux.sendText(name, '-n ; echo not-a-flag');
    await tmux.sendKeys(name, ['Enter']);
    await sleep(300);
    const out = await tmux.capture(name, 5);
    expect(out).toContain('-n ; echo not-a-flag');
  });
  it('capture returns only the last N lines', async () => {
    const n = 'ledge-t2';
    await tmux.newSession({ name: n, cwd: '/tmp', env: {}, command: ['sh', '-c', 'for i in $(seq 1 40); do echo line$i; done; cat'] });
    await sleep(400);
    const out = await tmux.capture(n, 5);
    expect(out.split('\n')).toEqual(['line36', 'line37', 'line38', 'line39', 'line40']);
    await tmux.killSession(n);
  });
  it('reports a missing session', async () => {
    expect(await tmux.hasSession('ledge-nope')).toBe(false);
  });
  it('kills a session', async () => {
    await tmux.killSession(name);
    await sleep(100);
    expect(await tmux.hasSession(name)).toBe(false);
  });
  it('builds attach args for the dedicated server', () => {
    expect(tmux.attachArgs('ledge-x')).toEqual(['-L', socket, '-f', expect.stringContaining('tmux.conf'), 'attach-session', '-t', 'ledge-x']);
  });
});
