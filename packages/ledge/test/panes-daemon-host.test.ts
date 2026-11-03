import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureLedgeDir, paths } from '../src/paths.js';
import { ensureDaemonToken } from '../src/auth.js';
import { startDaemon } from '../src/daemon/index.js';
import { connect } from '../src/client.js';
import { startPaneHost, type PaneHost } from '../src/panes/host.js';
import { panehostPath } from '../src/panes/protocol.js';
import { pickTmux } from '../src/panes/pick.js';
import { paneHostClient } from '../src/panes/client.js';
import { readDaemonToken } from '../src/auth.js';
import { until } from './helpers.js';

// The daemon on the pane host (Windows' setup, LEDGE_PANES=panehost here): agents outlive the daemon that started them.
const pty = await import('node-pty').then(() => true, () => false);
const agent = fileURLToPath(new URL('./fake-agent.mjs', import.meta.url));
const node = process.execPath;
let host: PaneHost | undefined;
const saved = { home: process.env.LEDGE_HOME, panes: process.env.LEDGE_PANES };

beforeAll(async () => {
  if (!pty) return;
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-dh-')); process.env.LEDGE_PANES = 'panehost';
  await ensureLedgeDir();
  // The host the daemon would start (ledge panehost), here in this process.
  host = await startPaneHost({ path: panehostPath(process.platform, process.env, paths().dir), token: await ensureDaemonToken() });
});
afterAll(async () => {
  await host?.close();
  process.env.LEDGE_HOME = saved.home; if (saved.panes === undefined) delete process.env.LEDGE_PANES; else process.env.LEDGE_PANES = saved.panes;
});

/** Launches the fake agent as a front would, and returns its id. */
async function launch(port: number, steps: string[]): Promise<string> {
  const { createSession } = await import('../src/cli/launch.js');
  const c = await connect({ port }); await c.next('snapshot');
  const s = await createSession({ tool: 'claude', args: [], command: [node, agent, ...steps], cwd: tmpdir(), tmux: pickTmux(process.platform, process.env), client: c });
  await c.close();
  return s.id;
}
async function state(port: number, id: string) {
  const c = await connect({ port }); const snap = await c.next('snapshot'); await c.close();
  return snap.sessions.find(s => s.id === id);
}

describe.skipIf(!pty)('the daemon on the pane host', () => {
  it('adopts the panes of a previous daemon', async () => {
    const a = await startDaemon({ port: 0 });
    const id = await launch(a.port, ['work', '60000']);
    // The fake agent alone stays 'starting' (no prompt): the session is known and its pane up is what matters here.
    await until(async () => (await state(a.port, id))?.state === 'starting', 8000);
    await new Promise(r => setTimeout(r, 500));
    // The pane is the host's, not a tmux server's.
    const direct = paneHostClient({ path: panehostPath(process.platform, process.env, paths().dir), token: readDaemonToken, start: () => {} });
    expect(await direct.listSessions()).toContain(`ledge-${id}`);
    direct.close();
    await a.stop();
    const b = await startDaemon({ port: 0 });
    try {
      await new Promise(r => setTimeout(r, 1500));
      expect((await state(b.port, id))?.state).not.toBe('exited');
      const c = await connect({ port: b.port }); await c.next('snapshot');
      c.send({ type: 'session.kill', id });
      await until(async () => (await state(b.port, id))?.state === 'exited', 8000);
      await c.close();
    } finally { await b.stop(); }
  }, 30_000);

  it('an agent that exits while no daemon runs is exited with its code once one starts', async () => {
    const a = await startDaemon({ port: 0 });
    const id = await launch(a.port, ['work', '1500', 'exit', '7']);
    await a.stop();
    await new Promise(r => setTimeout(r, 2500));
    const b = await startDaemon({ port: 0 });
    try {
      await until(async () => (await state(b.port, id))?.state === 'exited', 8000);
      expect((await state(b.port, id))?.exitCode).toBe(7);
    } finally { await b.stop(); }
  }, 30_000);
});
