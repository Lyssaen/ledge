import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { startPoller } from '../src/daemon/poller.js';
import { until } from './helpers.js';
import { ensureLedgeDir } from '../src/paths.js';
import { connect } from '../src/client.js';
import { createSession } from '../src/cli/launch.js';
import { pickTmux } from '../src/panes/pick.js';
import { realTmux } from '../src/tmux.js';

// The scenarios of e2e.test.ts, on the ConPTY panes instead of tmux: what the daemon sees of a fake Claude Code.
const agent = fileURLToPath(new URL('./fake-agent.mjs', import.meta.url));
const node = process.execPath;
const cwd = tmpdir();
const tmux = pickTmux(process.platform, { LEDGE_PANES: 'conpty' });
let srv: Awaited<ReturnType<typeof startServer>>; let poller: ReturnType<typeof startPoller>; let store: Store;

beforeAll(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); await ensureLedgeDir();
  store = new Store(); srv = await startServer({ store, tmux, port: 0 });
  poller = startPoller({ store, tmux, intervalMs: 150, deadCheckMs: 300, broadcastPreview: srv.preview });
});
afterAll(async () => { poller.stop(); await srv.close(); for (const s of await tmux.listSessions()) await tmux.killSession(s); });

describe('pickTmux', () => {
  it('takes the panes on Windows or when asked, tmux elsewhere', () => {
    expect(pickTmux('win32', {}).attachArgs).toBeTypeOf('function');
    expect(() => pickTmux('win32', {}).attachArgs('x')).toThrow(/ConPTY/);
    expect(() => pickTmux('linux', { LEDGE_PANES: 'conpty' }).attachArgs('x')).toThrow(/ConPTY/);
    expect(pickTmux('linux', {}).attachArgs('x')).toEqual(realTmux('ledge').attachArgs('x'));
  });
});

describe('end to end on ConPTY panes with a fake Claude Code', () => {
  it('tracks a permission, approves it, sees the agent continue and exit', async () => {
    const client = await connect({ port: srv.port }); await client.next('snapshot');
    const s = await createSession({ tool: 'claude', args: [], command: [node, agent, 'permission', 'npm test', 'work', '1500', 'exit', '0'], cwd, tmux, client });
    await until(() => store.get(s.id)?.state === 'waiting_permission', 8000);
    expect(store.get(s.id)!.pending).toMatchObject({ text: 'npm test', options: ['Yes', "Yes, and don't ask again for this command", 'No'] });
    client.send({ type: 'session.decide', id: s.id, decision: 'accept' });
    await until(async () => (await tmux.capture(s.tmuxSession!, 10))?.includes('✓ accepted 1') ?? false);
    await until(() => store.get(s.id)?.state === 'exited', 8000);
    expect(store.get(s.id)!.exitCode).toBe(0);
    await client.close();
  });

  it('denies a permission with Escape', async () => {
    const client = await connect({ port: srv.port }); await client.next('snapshot');
    const s = await createSession({ tool: 'claude', args: [], command: [node, agent, 'permission', 'rm -rf x', 'work', '1500', 'exit', '0'], cwd, tmux, client });
    await until(() => store.get(s.id)?.state === 'waiting_permission', 8000);
    client.send({ type: 'session.decide', id: s.id, decision: 'deny' });
    await until(async () => (await tmux.capture(s.tmuxSession!, 10))?.includes('✗ denied') ?? false);
    await until(() => store.get(s.id)?.state === 'exited', 8000);
    await client.close();
  });

  it('answers a question by option number', async () => {
    const client = await connect({ port: srv.port }); await client.next('snapshot');
    const s = await createSession({ tool: 'claude', args: [], command: [node, agent, 'question', 'work', '1500', 'exit', '0'], cwd, tmux, client });
    await until(() => store.get(s.id)?.state === 'waiting_input', 8000);
    expect(store.get(s.id)!.pending).toMatchObject({ kind: 'question', text: 'Which migration strategy?', options: ['Backfill', 'Shadow table', 'Type something.'] });
    client.send({ type: 'session.reply', id: s.id, text: '2' });
    await until(async () => (await tmux.capture(s.tmuxSession!, 10))?.includes('You chose: 2') ?? false);
    await until(() => store.get(s.id)?.state === 'exited', 8000);
    await client.close();
  });

  it('ends with the code the agent exited with, no shell wrapper', async () => {
    const client = await connect({ port: srv.port }); await client.next('snapshot');
    const s = await createSession({ tool: 'claude', args: [], command: [node, agent, 'exit', '3'], cwd, tmux, client });
    await until(() => store.get(s.id)?.state === 'exited', 8000);
    expect(store.get(s.id)!.exitCode).toBe(3);
    await client.close();
  });
});
