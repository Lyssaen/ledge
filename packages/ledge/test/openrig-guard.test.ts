import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type ServerMessage, type Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { paths } from '../src/paths.js';
import { rigManaged, RigManagedError, RIG_MANAGED } from '../src/daemon/openrig/guard.js';
import type { Tmux } from '../src/tmux.js';
import { authHeaders, until } from './helpers.js';

const T0 = '2026-10-30T10:00:00.000Z';
const SEAT_RIG = { machine: 'local', rigId: 'r1', rigName: 'starter', seat: 'dev-build@starter', pod: 'dev', member: 'build' };
const session = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: id, tool: 'claude', cwd: '/w/app', project: 'app', title: id, tmuxSession: `ledge-${id}`, state: 'idle', helpers: [],
  startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
});

function fakeTmux(): Tmux & { killed: string[] } {
  const killed: string[] = [];
  return {
    killed,
    async newSession() {}, async sendText() {}, async sendKeys() {}, async capture() { return ''; },
    async hasSession() { return true; }, async listSessions() { return []; }, async setOption() {},
    async killSession(n) { killed.push(n); }, attachArgs: n => ['attach', n]
  };
}

let srv: ServerHandle | null = null; let tmux: ReturnType<typeof fakeTmux>; let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ledge-guard-')); process.env.LEDGE_HOME = home; });
afterEach(async () => { await srv?.close(); srv = null; rmSync(home, { recursive: true, force: true }); });

async function serverWith(sessions: Session[]) {
  const store = new Store(); for (const s of sessions) store.upsert(s);
  tmux = fakeTmux();
  srv = await startServer({ store, tmux, port: 0, handoverBriefMs: 60_000 });
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`, { headers: authHeaders() });
  const msgs: ServerMessage[] = [];
  ws.on('message', d => msgs.push(parseServerMessage(JSON.parse(String(d)))));
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  await until(() => msgs.some(m => m.type === 'snapshot'));
  const send = async (m: ClientMessage, type: ServerMessage['type'] = 'error') => {
    const from = msgs.length; ws.send(JSON.stringify(m));
    await until(() => msgs.slice(from).some(x => x.type === type), 3000);
    return msgs.slice(from).find(x => x.type === type)!;
  };
  return { store, send, tmux, msgs, close: () => ws.close() };
}

describe('rig_managed: a seat of a rig is never ended by Ledge', () => {
  it('rigManaged and RigManagedError', () => {
    expect(rigManaged({})).toBeNull();
    expect(rigManaged({ rig: SEAT_RIG })).toMatchObject({ message: RIG_MANAGED, code: 'rig_managed' });
    expect(new RigManagedError()).toMatchObject({ code: 'rig_managed', message: RIG_MANAGED });
  });

  for (const msg of [{ type: 'session.kill', id: 'b' }, { type: 'session.archive', id: 'b' }, { type: 'session.delete', id: 'b' },
                     { type: 'session.model', id: 'b', model: 'sonnet', effort: null }] as const)
    it(`${msg.type} on a seat: error rig_managed, tmux untouched`, async () => {
      const { send, store, close } = await serverWith([session('b', { rig: SEAT_RIG })]);
      expect(await send(msg)).toMatchObject({ type: 'error', id: 'b', code: 'rig_managed', request: msg.type });
      expect(tmux.killed).toEqual([]);
      expect(store.get('b')?.state).toBe('idle');
      close();
    });

  it('session.resume on an exited seat: error rig_managed, nothing respawned', async () => {
    const { send, store, close } = await serverWith([session('b', { rig: SEAT_RIG, state: 'exited', agentSessionId: 'conv-1' })]);
    expect(await send({ type: 'session.resume', id: 'b' })).toMatchObject({ type: 'error', id: 'b', code: 'rig_managed', request: 'session.resume' });
    expect(store.get('b')?.state).toBe('exited');
    close();
  });

  it('a card close aimed at a seat fails with rig_managed and kills nothing', async () => {
    const { close } = await serverWith([session('b', { rig: SEAT_RIG })]);
    await expect(srv!.closeSession('b')).rejects.toMatchObject({ code: 'rig_managed' });
    expect(tmux.killed).toEqual([]);
    close();
  });

  it('a Ledge relief of a seat is ignored and noted in the journal', async () => {
    const { send, close } = await serverWith([session('b', { rig: SEAT_RIG })]);
    expect(await send({ type: 'session.handover', rid: 'h1', id: 'b' } as ClientMessage, 'session.handover.result')).toMatchObject({ ok: false });
    expect(tmux.killed).toEqual([]);
    expect(existsSync(paths().log) && readFileSync(paths().log, 'utf8')).toContain('seat of a rig');
    close();
  });

  it('a lone session is still killed', async () => {
    const { store, send, close } = await serverWith([session('c')]);
    await send({ type: 'session.kill', id: 'c' }, 'session.updated').catch(() => undefined);
    await until(() => tmux.killed.length === 1);
    expect(tmux.killed).toEqual(['ledge-c']);
    expect(store.get('c')?.state).toBe('exited');
    close();
  });
});
