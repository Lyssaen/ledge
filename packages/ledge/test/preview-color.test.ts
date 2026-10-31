import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { startPoller } from '../src/daemon/poller.js';
import { connect } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { until } from './helpers.js';

const T0 = '2026-10-09T18:00:00.000Z';
const GREEN = '\x1b[32m● ok\x1b[0m';
const mk = (id: string): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto · w', tmuxSession: `ledge-${id}`,
  state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher'
});

/** A fake tmux: each pane has a plain text and a colored text; every capture is recorded. */
function fakeTmux(panes: Record<string, { plain: string; color: string }>) {
  const calls: { name: string; color: boolean }[] = [];
  const tmux: Tmux = {
    async newSession() {}, async sendText() {}, async sendKeys() {},
    async capture(n, lines, o) { calls.push({ name: n, color: !!o?.color }); const p = panes[n]; if (!p) return null; return (o?.color ? p.color : p.plain).split('\n').slice(-lines).join('\n'); },
    async hasSession(n) { return n in panes; }, async listSessions() { return Object.keys(panes); },
    async setOption() {}, async killSession() {}, attachArgs: () => []
  };
  return { tmux, calls, colorCalls: (id: string) => calls.filter(c => c.color && c.name === `ledge-${id}`).length };
}

let store: Store; let srv: Awaited<ReturnType<typeof startServer>>; let poller: ReturnType<typeof startPoller>;
let panes: Record<string, { plain: string; color: string }>; let fake: ReturnType<typeof fakeTmux>;
beforeEach(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-'));
  store = new Store(); store.upsert(mk('s1')); store.upsert(mk('s2'));
  panes = { 'ledge-s1': { plain: '● ok', color: GREEN }, 'ledge-s2': { plain: '● two', color: '\x1b[31m● two\x1b[0m' } };
  fake = fakeTmux(panes);
  srv = await startServer({ store, tmux: fake.tmux, port: 0 });
  poller = startPoller({ store, tmux: fake.tmux, intervalMs: 1_000_000, gitInfo: async () => null, broadcastPreview: srv.preview, colorWanted: srv.colorWanted, sendColorPreview: srv.sendColorPreview });
});
afterEach(async () => { poller.stop(); await srv.close(); });

describe('color previews', () => {
  it('a subscribed client gets session.preview.color, another client does not', async () => {
    const a = await connect({ port: srv.port }); await a.next('snapshot');
    const b = await connect({ port: srv.port }); await b.next('snapshot');
    a.send({ type: 'session.preview.subscribe', id: 's1', color: true });
    await until(() => srv.colorWanted('s1'));
    await poller.tick();
    expect(await a.next('session.preview.color')).toEqual({ type: 'session.preview.color', id: 's1', lines: [GREEN] });
    expect((await b.next('session.preview')).id).toBeTruthy(); // the plain preview still goes to everyone
    await expect(b.next('session.preview.color', 200)).rejects.toThrow();
    await a.close(); await b.close();
  });
  it('captures in color only when the plain capture changed, or at once on subscribe', async () => {
    const a = await connect({ port: srv.port }); await a.next('snapshot');
    await poller.tick(); expect(fake.colorCalls('s1')).toBe(0); // nobody follows
    a.send({ type: 'session.preview.subscribe', id: 's1', color: true });
    await until(() => srv.colorWanted('s1'));
    await poller.tick(); expect(fake.colorCalls('s1')).toBe(1); // unchanged pane, but new subscription
    await poller.tick(); expect(fake.colorCalls('s1')).toBe(1);
    panes['ledge-s1'] = { plain: '● ok\nmore', color: GREEN + '\nmore' };
    await poller.tick(); expect(fake.colorCalls('s1')).toBe(2);
    expect((await a.next('session.preview.color')).lines.length).toBeGreaterThan(0);
    await a.close();
  });
  it('the daemon stops color captures once the subscriber closes', async () => {
    const a = await connect({ port: srv.port }); await a.next('snapshot');
    a.send({ type: 'session.preview.subscribe', id: 's1', color: true });
    await until(() => srv.colorWanted('s1'));
    await poller.tick();
    await a.close();
    await until(() => !srv.colorWanted('s1'));
    const before = fake.colorCalls('s1');
    panes['ledge-s1'] = { plain: 'changed', color: '\x1b[31mchanged\x1b[0m' };
    await poller.tick();
    expect(fake.colorCalls('s1')).toBe(before);
  });
  it('subscribing to another session moves the color capture', async () => {
    const a = await connect({ port: srv.port }); await a.next('snapshot');
    a.send({ type: 'session.preview.subscribe', id: 's1', color: true });
    await until(() => srv.colorWanted('s1'));
    await poller.tick();
    a.send({ type: 'session.preview.subscribe', id: 's2', color: true });
    await until(() => srv.colorWanted('s2'));
    expect(srv.colorWanted('s1')).toBe(false);
    const s1 = fake.colorCalls('s1');
    panes['ledge-s1'] = { plain: 'changed', color: 'changed' };
    panes['ledge-s2'] = { plain: 'two changed', color: 'two changed' };
    await poller.tick();
    expect(fake.colorCalls('s1')).toBe(s1);
    expect(fake.colorCalls('s2')).toBeGreaterThan(0);
    expect((await a.next('session.preview.color')).id).toBe('s1'); // the first image, then s2's
    expect((await a.next('session.preview.color')).id).toBe('s2');
    a.send({ type: 'session.preview.subscribe', id: null, color: true });
    await until(() => !srv.colorWanted('s2'));
    await a.close();
  });
});
