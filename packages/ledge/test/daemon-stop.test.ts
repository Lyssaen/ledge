import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { startDaemon } from '../src/daemon/index.js';
import { connect } from '../src/client.js';
import { paths } from '../src/paths.js';
import { realTmux } from '../src/tmux.js';

// Windows has no SIGTERM to catch: the daemon stops when a client of its own asks.
describe('daemon.stop', () => {
  it('stops the daemon a client with the token asks, through its whole stop; a client without the token cannot ask', async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-stop-'));
    const d = await startDaemon({ port: 0, tmux: realTmux(`ledge-stop-${process.pid}`, { scope: async () => false }), exitOnStop: false });
    expect(existsSync(paths().pid)).toBe(true);
    const anon = await new Promise<number | string>(res => {
      const ws = new WebSocket(`ws://127.0.0.1:${d.port}`);
      ws.on('unexpected-response', (_q, r) => res(r.statusCode ?? 0)); ws.on('open', () => { ws.close(); res('open'); }); ws.on('error', () => res('error'));
    });
    expect(anon).toBe(401);
    const c = await connect({ port: d.port }); await c.next('snapshot');
    c.send({ type: 'daemon.stop' });
    const end = Date.now() + 3000;
    let up = true;
    while (up && Date.now() < end) { up = await connect({ port: d.port, timeoutMs: 300 }).then(x => { void x.close(); return true; }, () => false); if (up) await new Promise(r => setTimeout(r, 100)); }
    expect(up).toBe(false);
    // stop() saves the journals and removes the pid file last: its absence says the whole stop ran.
    await new Promise(r => setTimeout(r, 300));
    expect(existsSync(paths().pid)).toBe(false);
  });
});
