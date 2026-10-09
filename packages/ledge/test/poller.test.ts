import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startPoller } from '../src/daemon/poller.js';
import type { Tmux } from '../src/tmux.js';

const T0 = Date.parse('2026-10-09T18:00:00.000Z');
let clock = T0; const now = () => new Date(clock).toISOString();
const mk = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto · w', tmuxSession: `ledge-${id}`,
  state: 'working', helpers: [], startedAt: now(), lastActivityAt: now(), source: 'launcher', ...extra
});
const PROMPT = '╭──╮\n│ Do you want to proceed? │\n│ ❯ 1. Yes │\n╰──╯';
function fakeTmux(panes: Record<string, string>): Tmux {
  return {
    async newSession() {}, async sendText() {}, async sendKeys() {},
    async capture(n) { return panes[n] ?? ''; }, async hasSession(n) { return n in panes; },
    async listSessions() { return Object.keys(panes); }, async killSession(n) { delete panes[n]; }, attachArgs: () => []
  };
}
let store: Store; let panes: Record<string, string>; let previews: string[][];
beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); store = new Store(); panes = {}; previews = []; clock = T0; });

describe('poller', () => {
  it('bumps lastActivityAt only when the pane content changes, and broadcasts the preview', async () => {
    panes['ledge-a'] = 'line one'; store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now, broadcastPreview: (id, lines) => previews.push(lines) });
    clock += 1000; await p.tick();
    expect(store.get('a')!.lastActivityAt).toBe(now());
    clock += 1000; await p.tick();
    expect(store.get('a')!.lastActivityAt).toBe(new Date(T0 + 1000).toISOString());
    panes['ledge-a'] = 'line one\nline two'; clock += 1000; await p.tick();
    expect(store.get('a')!.lastActivityAt).toBe(now());
    expect(previews.at(-1)).toEqual(['line one', 'line two']);
    p.stop();
  });
  it('detects a prompt from the pane when no hook spoke recently', async () => {
    panes['ledge-a'] = PROMPT; store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now });
    clock += 5000; await p.tick();
    expect(store.get('a')!.state).toBe('waiting_permission');
    expect(store.get('a')!.pending?.source).toBe('pane');
    p.stop();
  });
  it('marks a dead pane as exited on the dead check and retires it after retireMs', async () => {
    panes['ledge-a'] = 'x'; store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, deadCheckMs: 0, retireMs: 600000, now });
    delete panes['ledge-a']; clock += 1000; await p.tick();
    expect(store.get('a')!.state).toBe('exited');
    expect(store.get('a')!.exitCode).toBeNull();
    clock += 600001; await p.tick();
    expect(store.get('a')).toBeUndefined();
    p.stop();
  });
  it('ignores sessions without a terminal', async () => {
    store.upsert(mk('h', { tmuxSession: null, source: 'hook_only' }));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, deadCheckMs: 0, now });
    clock += 1000; await p.tick();
    expect(store.get('h')!.state).toBe('working');
    p.stop();
  });
});

describe('poller prompt handling', () => {
  it('does not re-apply a prompt while the pane is unchanged', async () => {
    panes['ledge-a'] = PROMPT; store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now });
    let updates = 0;
    clock += 1000; await p.tick();
    store.onChange(() => updates++);
    clock += 1000; await p.tick(); clock += 1000; await p.tick();
    expect(updates).toBe(0);
    p.stop();
  });
});
