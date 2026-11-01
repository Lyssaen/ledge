import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type ServerMessage } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import type { Tmux } from '../src/tmux.js';
import { authHeaders, until } from './helpers.js';
import { createMemory } from '../src/daemon/brain/memory.js';
import { brainInstructions } from '../src/daemon/brain/persona.js';
import { DEFAULT_MANDATE } from '../src/daemon/brain/mandate.js';
import { paths } from '../src/paths.js';

const noTmux = new Proxy({} as Tmux, { get: () => async () => { throw new Error('no tmux in this test'); } });

async function client(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: authHeaders() });
  const msgs: ServerMessage[] = [];
  ws.on('message', d => msgs.push(parseServerMessage(JSON.parse(String(d)))));
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  const of = <K extends ServerMessage['type']>(t: K) => msgs.filter((m): m is Extract<ServerMessage, { type: K }> => m.type === t);
  return { msgs, of, send: (m: ClientMessage) => ws.send(JSON.stringify(m)), close: () => new Promise<void>(r => { ws.once('close', () => r()); ws.close(); }) };
}

let srv: ServerHandle | null = null; let dir = ''; let oldHome: string | undefined;
beforeEach(() => { oldHome = process.env.LEDGE_HOME; dir = mkdtempSync(join(tmpdir(), 'ledge-brain-srv-')); process.env.LEDGE_HOME = dir; });
afterEach(async () => {
  await srv?.close(); srv = null; rmSync(dir, { recursive: true, force: true });
  if (oldHome === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = oldHome;
});
const start = async () => { srv = await startServer({ store: new Store(), tmux: noTmux, port: 0, home: dir, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }) }); return srv; };
const result = (c: Awaited<ReturnType<typeof client>>, rid: string) => c.of('rig.result').find(r => r.rid === rid);

describe('the daemon serves the mandate, rules and decisions', () => {
  it('a new client gets mandate, rules, decisions and brain status', async () => {
    const mem = createMemory({ dir: paths().memoryDir });
    const r = mem.propose('Merge → oui', 'git', 'user');
    for (let i = 0; i < 3; i++) mem.record({ at: `2026-10-30T10:0${i}:00.000Z`, escalationId: `E${i}`, by: 'user', category: 'git', summary: `q${i}`, answers: { text: 'oui' } });
    const s = await start(); const c = await client(s.port);
    await until(() => c.of('decisions').length >= 1 && c.of('brain.status').length >= 1);
    expect(c.of('mandate')[0]).toEqual({ type: 'mandate', text: DEFAULT_MANDATE, path: paths().mandate });
    expect(existsSync(paths().mandate)).toBe(true);
    expect(c.of('rules')[0]!.items.map(x => x.id)).toEqual([r.id]);
    expect(c.of('decisions')[0]!.items.map(d => d.summary)).toEqual(['q2', 'q1', 'q0']);
    const types = c.msgs.map(m => m.type);
    expect(types.indexOf('brain.status')).toBeLessThan(types.indexOf('mandate'));
    await c.close();
  });

  it('mandate.update writes the file atomically and broadcasts; an unreadable text is accepted with a warning', async () => {
    const s = await start(); const c = await client(s.port); const d = await client(s.port);
    await until(() => c.of('mandate').length >= 1 && d.of('mandate').length >= 1);
    const text = DEFAULT_MANDATE.replace('- code :', '- code (petit) :').replace('- code (petit) :', '- code :');
    c.send({ type: 'mandate.update', rid: 'm1', text: `${text}\n` });
    await until(() => result(c, 'm1') !== undefined && d.of('mandate').length >= 2);
    expect(result(c, 'm1')).toMatchObject({ ok: true }); expect(result(c, 'm1')!.reason).toBeUndefined();
    expect(readFileSync(paths().mandate, 'utf8')).toBe(`${text}\n`);
    expect(d.of('mandate').at(-1)).toMatchObject({ text: `${text}\n`, path: paths().mandate });
    c.send({ type: 'mandate.update', rid: 'm2', text: 'rien de lisible' });
    await until(() => result(c, 'm2') !== undefined);
    expect(result(c, 'm2')).toMatchObject({ ok: true, reason: 'le mandat illisible fait tout remonter à toi' });
    expect(readFileSync(paths().mandate, 'utf8')).toBe('rien de lisible');
    await c.close(); await d.close();
  });

  it('category.escalate moves the category and broadcasts the mandate; already on the user side changes nothing', async () => {
    const s = await start(); const c = await client(s.port);
    await until(() => c.of('mandate').length >= 1);
    c.send({ type: 'category.escalate', rid: 'c1', category: 'git' });
    await until(() => result(c, 'c1') !== undefined && c.of('mandate').length >= 2);
    expect(result(c, 'c1')).toMatchObject({ ok: true });
    const after = readFileSync(paths().mandate, 'utf8');
    expect(after.split('## Te revient toujours')[1]).toContain('- git :');
    expect(after.split('## Te revient toujours')[0]).not.toContain('- git :');
    expect(c.of('mandate').at(-1)!.text).toBe(after);
    c.send({ type: 'category.escalate', rid: 'c2', category: 'git' });
    await until(() => result(c, 'c2') !== undefined);
    expect(result(c, 'c2')).toMatchObject({ ok: true });
    expect(readFileSync(paths().mandate, 'utf8')).toBe(after);
    expect(c.of('mandate').length).toBe(2);
    await c.close();
  });

  it('rule.set activates a rule, broadcasts the rules, and the brain sees it at next relief; an unknown id is not ok', async () => {
    const mem = createMemory({ dir: paths().memoryDir });
    const r = mem.propose('Merge → oui', 'git', 'user');
    const s = await start(); const c = await client(s.port);
    await until(() => c.of('rules').length >= 1);
    c.send({ type: 'rule.set', rid: 'r0', id: 'nope', status: 'active' });
    c.send({ type: 'rule.set', rid: 'r1', id: r.id, status: 'active' });
    await until(() => result(c, 'r0') !== undefined && result(c, 'r1') !== undefined);
    expect(result(c, 'r0')).toMatchObject({ ok: false, reason: expect.any(String) });
    expect(result(c, 'r1')).toMatchObject({ ok: true });
    await until(() => c.of('rules').at(-1)!.items.some(x => x.id === r.id && x.status === 'active'));
    const fresh = createMemory({ dir: paths().memoryDir });
    expect(brainInstructions({ mandate: DEFAULT_MANDATE, rules: fresh.rules(), decisions: [], tool: 'claude' })).toContain('Merge → oui');
    c.send({ type: 'rule.set', rid: 'r2', id: r.id, status: 'rejected' });
    await until(() => result(c, 'r2') !== undefined);
    expect(c.of('rules').at(-1)!.items).toEqual([]);
    await c.close();
  });
});
