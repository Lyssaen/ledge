import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { createOmpHost } from '../src/daemon/omp/host.js';
import { connect } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { until } from './helpers.js';

const FAKE = [process.execPath, fileURLToPath(new URL('./fake-omp.mjs', import.meta.url))];
// A tmux that is never asked for anything: an OMP session has no pane.
const noTmux: Tmux = new Proxy({} as Tmux, { get: (_t, k) => { throw new Error(`OMP must not touch tmux (${String(k)})`); } });

let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let dir: string; let log: string;
const cmdTypes = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { argv?: string[]; cmd?: { type: string } }) : []);
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ledge-omp-srv-')); process.env.LEDGE_HOME = dir; log = join(dir, 'fake.log'); process.env.FAKE_OMP_LOG = log;
  store = new Store();
  const env = async () => ({ ...process.env });
  srv = await startServer({ store, tmux: noTmux, port: 0, home: dir, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: env, omp: createOmpHost({ store, env, dir: join(dir, 'omp'), command: FAKE }) });
});
afterEach(async () => { await srv.close(); delete process.env.FAKE_OMP_LOG; });

describe('server: OMP sessions', () => {
  it('another session\'s message reaches an OMP session as an instruction, attributed, and the sender\'s card is delivered', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    const T = '2026-10-20T12:00:00.000Z';
    store.upsert({ id: 'pim', name: 'Pim', tool: 'claude', cwd: dir, project: 'p', title: 'Pim', tmuxSession: 'ledge-pim', state: 'working', helpers: [], startedAt: T, lastActivityAt: T, source: 'launcher' });
    c.send({ type: 'session.launch', tool: 'omp', cwd: dir });
    const { id } = await c.next('session.launched');
    const name = store.get(id)!.name;
    c.send({ type: 'session.message', rid: 'r1', from: 'pim', to: name, text: 'please check the build' });
    expect(await c.next('message.ack')).toMatchObject({ rid: 'r1', outcome: 'accepted' });
    await until(() => /please check the build/.test(store.get(id)!.lastReply?.text ?? ''), 3000).catch(e => { console.log(JSON.stringify(store.get(id))); throw e; });
    expect(store.get(id)!.lastReply!.text).toMatch(/Pim/);
    await c.close();
  });
  it('the snapshot tells a front this daemon drives OMP', async () => {
    const c = await connect({ port: srv.port });
    expect((await c.next('snapshot')).daemon).toMatchObject({ omp: true, models: true });
    await c.close();
  });
  it('session.launch starts OMP with the model and folder asked, sends the first instruction and records an OMP session without a pane', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.launch', tool: 'omp', cwd: dir, prompt: 'hello there', model: 'anthropic/claude-opus-5-5', effort: 'low' });
    const { id } = await c.next('session.launched');
    const s = store.get(id)!;
    expect(s).toMatchObject({ tool: 'omp', backend: 'omp-rpc', tmuxSession: null, model: 'anthropic/claude-opus-5-5', effort: 'low' });
    await until(() => store.get(id)!.lastReply?.text === 'done: hello there');
    expect(store.get(id)).toMatchObject({ state: 'idle', topic: 'hello there' });
    expect(store.recents()[0]!.cwd).toBe(dir);
    await c.close();
  });
  it('a launch OMP cannot take is refused with its reason and records nothing; `continue` is never "the folder\'s latest"', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.launch', tool: 'omp', cwd: dir, continue: true });
    expect((await c.next('error')).message).toMatch(/exact conversation/);
    process.env.FAKE_OMP_DIE = '1';
    c.send({ type: 'session.launch', tool: 'omp', cwd: dir });
    expect((await c.next('error')).message).toMatch(/no credentials/);
    delete process.env.FAKE_OMP_DIE;
    expect(store.all()).toEqual([]);
    await c.close();
  });
  it('a reply answers OMP\'s dialog by option, and an instruction at rest starts the next turn', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.launch', tool: 'omp', cwd: dir, prompt: 'run a tool' });
    const { id } = await c.next('session.launched');
    await until(() => store.get(id)!.state === 'waiting_input');
    c.send({ type: 'session.decide', id, decision: 'accept' });
    expect((await c.next('error')).message).toMatch(/one of its options/);
    c.send({ type: 'session.reply', id, text: 'nope' });
    expect((await c.next('error')).message).toMatch(/not one of the options/);
    c.send({ type: 'session.reply', id, text: '1' });
    await until(() => store.get(id)!.state === 'idle');
    c.send({ type: 'session.reply', id, text: 'second turn' });
    await until(() => store.get(id)!.lastReply?.text === 'done: second turn');
    await c.close();
  });
  it('interrupt aborts the turn without ending the session; kill ends it, closing the process', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.launch', tool: 'omp', cwd: dir, prompt: 'slow work' });
    const { id } = await c.next('session.launched');
    await until(() => store.get(id)!.state === 'working');
    c.send({ type: 'session.interrupt', id });
    await until(() => cmdTypes().some(c => c.cmd?.type === 'abort'));
    expect(store.get(id)!.state).not.toBe('exited');
    c.send({ type: 'session.kill', id });
    await until(() => store.get(id)!.state === 'exited');
    expect(srv.omp.isLive(id)).toBe(false);
    await c.close();
  });
  it('resume continues the exact conversation file under the same id and name, as a new process', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.launch', tool: 'omp', cwd: dir, prompt: 'hello' });
    const { id } = await c.next('session.launched');
    const before = store.get(id)!;
    await until(() => store.get(id)!.state === 'idle' && !!store.get(id)!.lastReply);
    c.send({ type: 'session.kill', id });
    await until(() => store.get(id)!.state === 'exited');
    c.send({ type: 'session.resume', id });
    await until(() => store.get(id)!.state === 'idle');
    expect(store.get(id)).toMatchObject({ id, name: before.name, agentSessionFile: before.agentSessionFile, backend: 'omp-rpc' });
    const resumed = cmdTypes().filter(l => l.argv).at(-1)!.argv!;
    expect(resumed[resumed.indexOf('--resume') + 1]).toBe(before.agentSessionFile);
    expect(resumed).not.toContain('--continue');
    await c.close();
  });
  it('a model change is made in place with set_model: same process, same conversation, the effort validated against the new model first', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.launch', tool: 'omp', cwd: dir, model: 'anthropic/claude-opus-5-5', effort: 'high' });
    const { id } = await c.next('session.launched');
    const before = store.get(id)!;
    c.send({ type: 'session.model', id, model: 'openai-codex/gpt-6.1-sol', effort: 'medium' });
    await until(() => store.get(id)!.model === 'openai-codex/gpt-6.1-sol');
    expect(store.get(id)).toMatchObject({ model: 'openai-codex/gpt-6.1-sol', effort: 'medium', agentSessionFile: before.agentSessionFile, state: 'idle' });
    expect(store.get(id)!.modelNext).toBeUndefined();
    expect(cmdTypes().filter(l => l.argv)).toHaveLength(1); // one process ever started
    expect(cmdTypes().filter(l => l.cmd).map(l => l.cmd!.type)).toEqual(expect.arrayContaining(['set_model', 'get_available_thinking_levels', 'set_thinking_level']));
    await c.close();
  });
  it('a model OMP does not know changes nothing and says why; an effort the new model lacks leaves the new model and says so', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.launch', tool: 'omp', cwd: dir, model: 'anthropic/claude-opus-5-5' });
    const { id } = await c.next('session.launched');
    c.send({ type: 'session.model', id, model: 'anthropic/nope', effort: null });
    expect((await c.next('error')).message).toMatch(/Model not found/);
    expect(store.get(id)).toMatchObject({ model: 'anthropic/claude-opus-5-5', state: 'idle' }); expect(store.get(id)!.modelNext).toBeUndefined();
    c.send({ type: 'session.model', id, model: 'openai-codex/gpt-6.1-sol', effort: 'max' });
    expect((await c.next('error')).message).toMatch(/the model changed, but its effort did not: this model offers no effort “max”/);
    expect(store.get(id)).toMatchObject({ model: 'openai-codex/gpt-6.1-sol' });
    await c.close();
  });
  it('asked while OMP works, the change waits for its free moment (modelNext) and is then applied', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.launch', tool: 'omp', cwd: dir, prompt: 'slow work', model: 'anthropic/claude-opus-5-5' });
    const { id } = await c.next('session.launched');
    await until(() => store.get(id)!.state === 'working');
    c.send({ type: 'session.model', id, model: 'openai-codex/gpt-6.1-sol', effort: null });
    await until(() => !!store.get(id)!.modelNext);
    expect(cmdTypes().some(l => l.cmd?.type === 'set_model')).toBe(false);
    c.send({ type: 'session.interrupt', id });
    await until(() => store.get(id)!.model === 'openai-codex/gpt-6.1-sol', 6000);
    await c.close();
  });
  it('models.list answers with OMP\'s own catalog, provider/id, without the flag-like id', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'models.list', requestId: 'm1', tool: 'omp' });
    const l = await c.next('models.listing');
    expect(l.error).toBeUndefined();
    expect(l.models.map(m => m.id)).toEqual(['anthropic/claude-opus-5-5', 'openai-codex/gpt-6.1-sol']);
    await c.close();
  });
  it('delete closes the process and removes the session', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.launch', tool: 'omp', cwd: dir });
    const { id } = await c.next('session.launched');
    c.send({ type: 'session.delete', id });
    await until(() => !store.get(id));
    expect(srv.omp.isLive(id)).toBe(false);
    await c.close();
  });
});
