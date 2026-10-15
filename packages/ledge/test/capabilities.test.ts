import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilitiesSchema, NO_CAPABILITIES, ToolSchema, parseServerMessage, type ServerMessage, type Session } from '@ledge/protocol';
import { toRemote } from '../src/daemon/remote/project.js';
import { adapterFor, capabilitiesByTool } from '../src/adapters/index.js';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { connect } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';

const T0 = '2026-10-15T09:00:00.000Z';
const mk = (id: string): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w/a', project: 'a', title: 'Otto · a',
  tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher'
});
const view = { deviceId: 'd1', unread: () => false };
const tmux: Tmux = {
  async newSession() {}, async sendText() {}, async sendKeys() {}, async capture() { return ''; }, async hasSession() { return true; },
  async listSessions() { return []; }, async setOption() {}, async killSession() {}, attachArgs: n => ['attach', n]
};

let srv: Awaited<ReturnType<typeof startServer>> | undefined;
const home = process.env.LEDGE_HOME;
afterEach(async () => {
  await srv?.close(); srv = undefined;
  if (home === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = home;
});

describe('adapter capabilities', () => {
  it('every adapter declares a valid capability set; Codex and Cursor Agent give no free answer', () => {
    expect(NO_CAPABILITIES).toEqual({ freeTextAnswer: false });
    for (const tool of ToolSchema.options) expect(CapabilitiesSchema.parse(adapterFor(tool).capabilities)).toEqual(adapterFor(tool).capabilities);
    expect(adapterFor('codex').capabilities.freeTextAnswer).toBe(false);
    expect(adapterFor('cursor').capabilities.freeTextAnswer).toBe(false);
  });
  it('capabilitiesByTool reads every tool from its adapter', () => {
    const all = capabilitiesByTool();
    expect(Object.keys(all).sort()).toEqual([...ToolSchema.options].sort());
    for (const tool of ToolSchema.options) expect(all[tool]).toEqual(adapterFor(tool).capabilities);
  });
  it('the remote snapshot tells what each tool can answer', () => {
    const m = toRemote({ type: 'snapshot', sessions: [mk('a')] }, view) as Extract<ServerMessage, { type: 'snapshot' }>;
    expect(m.capabilities).toEqual(capabilitiesByTool());
    expect(m.capabilities!.codex.freeTextAnswer).toBe(false);
    expect(parseServerMessage(m)).toEqual(m);
  });
  it('the local snapshot has no capabilities field', async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-'));
    srv = await startServer({ store: new Store(), tmux, port: 0 });
    const c = await connect({ port: srv.port });
    const snap = await c.next('snapshot');
    expect(snap).not.toHaveProperty('capabilities');
    await c.close();
  });
});
