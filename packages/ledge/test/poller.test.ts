import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
const PROMPT = '─'.repeat(40) + '\n Bash command\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n\n Esc to cancel · Tab to amend';
const failing: Record<string, true> = {}; const throwing: Record<string, true> = {};
function fakeTmux(panes: Record<string, string>): Tmux {
  return {
    async newSession() {}, async sendText() {}, async sendKeys() {},
    async capture(n, lines) { if (n in failing) return null; if (n in throwing) throw new Error('boom'); return (panes[n] ?? '').split('\n').slice(-lines).join('\n'); }, async hasSession(n) { return n in panes; },
    async listSessions() { return Object.keys(panes); }, async setOption() {}, async killSession(n) { delete panes[n]; }, attachArgs: () => []
  };
}
let store: Store; let panes: Record<string, string>; let previews: string[][];
beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); store = new Store(); panes = {}; previews = []; clock = T0; for (const k of Object.keys(failing)) delete failing[k]; for (const k of Object.keys(throwing)) delete throwing[k]; });

describe('poller', () => {
  it.each(['resume', 'permission', 'delete'] as const)('keeps a concurrent helper %s while an earlier session is polled', async action => {
    store.upsert(mk('first', { tmuxSession: null }));
    store.upsert(mk('later', { tmuxSession: null, helpers: [{ id: 'h', kind: 'Explore', task: '', state: 'exited' }] }));
    let unblock!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 1_000_000, now,
      gitInfo: async () => { await gate; return null; } });
    try {
      clock += 300000;
      const tick = p.tick();
      if (action === 'delete') store.remove('later');
      else store.apply('later', { name: action === 'resume' ? 'SubagentStart' : 'PermissionRequest', helperId: 'h', at: now(), source: 'hook' });
      const latest = store.get('later');
      unblock(); await tick;
      expect(store.get('later')).toBe(latest);
    } finally { unblock(); p.stop(); }
  });
  it('retries the resume labels on every tick', async () => {
    let n = 0;
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 1_000_000, now, labelExited: () => { n++; } });
    try { await p.tick(); await p.tick(); expect(n).toBe(2); } finally { p.stop(); }
  });
  it('removes finished helpers after five minutes, retaining active helpers and the parent', async () => {
    store.upsert(mk('a', { tmuxSession: null }));
    store.apply('a', { name: 'SubagentStart', helperId: 'done', at: now(), source: 'hook' });
    store.apply('a', { name: 'SubagentStart', helperId: 'busy', at: now(), source: 'hook' });
    store.apply('a', { name: 'SubagentStop', helperId: 'done', at: now(), source: 'hook' });
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 1_000_000, now });
    try {
      clock += 299999; await p.tick();
      expect(store.get('a')!.helpers.map(h => h.id)).toEqual(['done', 'busy']);
      clock++; await p.tick();
      expect(store.get('a')!.helpers.map(h => h.id)).toEqual(['busy']);
      expect(store.get('a')!.state).toBe('working');
    } finally { p.stop(); }
  });
  it('keeps the helper expiry across a journal reload, including archived parents', async () => {
    store.upsert(mk('a', { state: 'exited', exitedAt: now(), archivedAt: now(), tmuxSession: null }));
    // A journal written before helper finish dates existed.
    store.upsert({ ...store.get('a')!, helpers: [{ id: 'done', kind: 'Explore', task: 'Review', state: 'exited' }] });
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 1_000_000, now });
    try { clock += 120000; await p.tick(); } finally { p.stop(); }
    await store.save();
    const restored = new Store(); await restored.load();
    const q = startPoller({ store: restored, tmux: fakeTmux(panes), intervalMs: 1_000_000, now });
    try {
      clock = T0 + 299999; await q.tick(); expect(restored.get('a')!.helpers).toHaveLength(1);
      clock++; await q.tick(); expect(restored.get('a')!.helpers).toEqual([]);
      expect(restored.get('a')!.archivedAt).toBe(new Date(T0).toISOString());
    } finally { q.stop(); }
  });
  it('never removes a helper whose request still needs an answer', async () => {
    store.upsert(mk('a', { tmuxSession: null, helpers: [{ id: 'h', kind: 'Explore', task: '', state: 'exited' }],
      pending: { helperId: 'h', kind: 'permission', text: 'Allow?', source: 'hook' } }));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 1_000_000, now });
    try { clock += 300000; await p.tick(); expect(store.get('a')!.helpers).toHaveLength(1); }
    finally { p.stop(); }
  });
  it('seeds the hash on first sighting, then bumps lastActivityAt only on change and broadcasts the preview', async () => {
    panes['ledge-a'] = 'line one'; store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now, broadcastPreview: (id, lines) => previews.push(lines) });
    clock += 1000; await p.tick();
    expect(store.get('a')!.lastActivityAt).toBe(new Date(T0).toISOString());
    // The first sighting sends the preview too: a client has one before the agent writes again.
    expect(previews).toEqual([['line one']]);
    clock += 1000; await p.tick();
    expect(store.get('a')!.lastActivityAt).toBe(new Date(T0).toISOString());
    expect(previews).toEqual([['line one']]);
    panes['ledge-a'] = 'line one\nline two'; clock += 1000; await p.tick();
    expect(store.get('a')!.lastActivityAt).toBe(now());
    expect(previews.at(-1)).toEqual(['line one', 'line two']);
    p.stop();
  });
  it('emits PaneTitle once per title', async () => {
    const titled = (t: string) => `● Done.\n\n${'─'.repeat(28)} ${t} ─\n❯ \n${'─'.repeat(40)}\n  ⏸ manual mode on`;
    panes['ledge-a'] = titled('first'); store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now });
    clock += 1000; await p.tick(); expect(store.get('a')?.topic).toBe('first');
    const after = store.get('a');
    clock += 1000; await p.tick(); expect(store.get('a')).toBe(after); // same title, same pane: nothing emitted
    panes['ledge-a'] = titled('second'); clock += 1000; await p.tick(); expect(store.get('a')?.topic).toBe('second');
    p.stop();
  });
  it('a fullscreen Claude Code pane previews the conversation, not the input box', async () => {
    panes['ledge-a'] = readFileSync(new URL('./fixtures/panes/claude2-fullscreen-idle.txt', import.meta.url), 'utf8'); store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now, broadcastPreview: (id, l) => previews.push(l) });
    clock += 1000; await p.tick();
    expect(previews).toHaveLength(1);
    expect(previews[0]!.at(-1)).toBe('✻ Brewed for 3s · done 1:12 PM');
    expect(previews[0]).toContain('  1. tmux is a terminal multiplexer that runs several shell sessions inside one terminal window.');
    expect(previews[0]!.some(l => l.includes('auto mode on'))).toBe(false);
    p.stop();
  });
  it('a pane change that leaves the preview as it was (status line only) is not sent again', async () => {
    const box = (status: string) => ['● hello', '─'.repeat(40), '❯ ', '─'.repeat(40), status].join('\n');
    panes['ledge-a'] = box('  ⏵⏵ auto mode on'); store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now, broadcastPreview: (id, l) => previews.push(l) });
    clock += 1000; await p.tick();
    panes['ledge-a'] = box('  ⏵⏵ manual mode on'); clock += 1000; await p.tick();
    expect(store.get('a')!.lastActivityAt).toBe(now());
    expect(previews).toEqual([['● hello']]);
    p.stop();
  });
  it('a tool without an adapter still gets the generic preview', async () => {
    panes['ledge-a'] = 'cursor says hi\n\n\n\n> '; store.upsert(mk('a', { tool: 'cursor' }));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now, broadcastPreview: (id, l) => previews.push(l) });
    clock += 1000; await p.tick();
    expect(previews).toEqual([['cursor says hi', '', '>']]);
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
  it('detects a dialog taller than the preview, and the preview stays the last 30 lines', async () => {
    const body = Array.from({ length: 30 }, (_, i) => `  ${i + 1} line ${i + 1}`).join('\n');
    panes['ledge-a'] = 'seed'; store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now, broadcastPreview: (id, l) => previews.push(l) });
    clock += 1000; await p.tick();
    panes['ledge-a'] = Array.from({ length: 20 }, (_, i) => `scroll ${i}`).join('\n') + '\n' + '─'.repeat(40) + '\n Create file\n a.txt\n' + '╌'.repeat(40) + '\n' + body + '\n' + '╌'.repeat(40) +
      '\n Do you want to create a.txt?\n ❯ 1. Yes\n   2. No\n\n Esc to cancel · Tab to amend';
    clock += 5000; await p.tick();
    expect(store.get('a')!.state).toBe('waiting_permission');
    expect(store.get('a')!.pending?.text).toBe('Create file a.txt');
    expect(previews.at(-1)!.length).toBe(30);
    expect(previews.at(-1)!.at(-1)).toBe(' Esc to cancel · Tab to amend');
    p.stop();
  });
  it('marks a dead pane as exited on the dead check and archives it after retireMs', async () => {
    panes['ledge-a'] = 'x'; store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, deadCheckMs: 0, retireMs: 600000, now });
    delete panes['ledge-a']; clock += 1000; await p.tick();
    expect(store.get('a')!.state).toBe('exited');
    expect(store.get('a')!.exitCode).toBeNull();
    clock += 600001; await p.tick();
    expect(store.get('a')!.archivedAt).toBeDefined();
    p.stop();
  });
  it('archives an exited session after retireMs instead of removing it', async () => {
    const changes: string[] = [];
    store.upsert(mk('a', { state: 'exited', exitCode: 0, exitedAt: now() }));
    store.onChange(c => changes.push(c.type));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, deadCheckMs: 0, retireMs: 600000, now });
    clock += 600001; await p.tick();
    expect(store.get('a')!.archivedAt).toBe(now());
    expect(changes).not.toContain('removed');
    p.stop();
  });
  it('a restored old exited session stays at the table, and is archived again only retireMs after the restore', async () => {
    const at = new Date(T0).toISOString();
    store.upsert(mk('a', { state: 'exited', exitCode: 0, exitedAt: at, archivedAt: at }));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, deadCheckMs: 0, retireMs: 600000, now });
    clock += 3_600_000; store.unarchive('a', now());
    clock += 1000; await p.tick();
    clock += 1000; await p.tick();
    expect(store.get('a')!.archivedAt).toBeUndefined();
    clock += 597_000; await p.tick(); // 599 s after the restore
    expect(store.get('a')!.archivedAt).toBeUndefined();
    clock += 2000; await p.tick(); // 601 s after the restore
    expect(store.get('a')!.archivedAt).toBe(now());
    p.stop();
  });
  it('leaves an archived session alone', async () => {
    const at = new Date(T0).toISOString();
    store.upsert(mk('a', { state: 'exited', exitCode: 0, exitedAt: at, archivedAt: at }));
    const changes: string[] = [];
    store.onChange(c => changes.push(c.type));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, deadCheckMs: 0, retireMs: 600000, now });
    clock += 3_600_000; await p.tick();
    expect(store.get('a')!.archivedAt).toBe(at);
    expect(changes).toEqual([]);
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

describe('poller robustness', () => {
  it('re-applies a prompt shadowed by a recent hook once the guard window passes, on an unchanged pane', async () => {
    panes['ledge-a'] = 'idle'; store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now });
    clock += 1000; await p.tick(); // seed
    store.apply('a', { name: 'PreToolUse', at: now(), source: 'hook', tool: 'Bash' } as never);
    clock += 1000; panes['ledge-a'] = PROMPT; await p.tick();
    expect(store.get('a')!.state).toBe('working');
    clock += 2000; await p.tick();
    expect(store.get('a')!.state).toBe('waiting_permission');
    expect(store.get('a')!.pending?.source).toBe('pane');
    p.stop();
  });
  it('skips a session whose capture failed: no activity bump, no preview', async () => {
    panes['ledge-a'] = 'x'; store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now, broadcastPreview: (id, l) => previews.push(l) });
    clock += 1000; await p.tick();
    expect(previews).toEqual([['x']]);
    failing['ledge-a'] = true; clock += 1000; await p.tick();
    expect(store.get('a')!.lastActivityAt).toBe(new Date(T0).toISOString());
    expect(previews).toEqual([['x']]);
    p.stop();
  });
  it('one throwing session does not abort the tick for later sessions', async () => {
    panes['ledge-a'] = 'x'; panes['ledge-b'] = PROMPT;
    store.upsert(mk('a')); store.upsert(mk('b'));
    throwing['ledge-a'] = true;
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now });
    clock += 5000; await p.tick();
    expect(store.get('b')!.state).toBe('waiting_permission');
    p.stop();
  });
});

const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8');

describe('poller rest detection', () => {
  it('turns a working session idle once the pane has rested for a while, never on the first sighting', async () => {
    panes['ledge-a'] = fx('claude2-rest-after-deny'); store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now });
    clock += 1000; await p.tick();
    expect(store.get('a')!.state).toBe('working');
    clock += 1000; await p.tick();
    expect(store.get('a')!.state).toBe('working');
    clock += 1000; await p.tick();
    expect(store.get('a')!.state).toBe('idle');
    p.stop();
  });
  it('keeps a session working while its status line says a turn runs', async () => {
    panes['ledge-a'] = fx('claude2-working-status'); store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now });
    for (let i = 0; i < 5; i++) { clock += 1000; await p.tick(); }
    expect(store.get('a')!.state).toBe('working');
    p.stop();
  });
  it('a plan found in the pane reaches the session with its body', async () => {
    panes['ledge-a'] = fx('cursor-plan'); store.upsert(mk('a', { tool: 'cursor', state: 'working' }));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now });
    for (let i = 0; i < 4; i++) { clock += 1000; await p.tick(); }
    expect(store.get('a')!.pending).toMatchObject({ kind: 'plan', text: 'Add line d to notes.txt', source: 'pane' });
    expect(store.get('a')!.pending?.body).toContain('No other files need to change.');
    p.stop();
  });
  it('Claude without hooks: a plan found in the pane reads its text from the session transcript', async () => {
    const transcriptPath = join(process.env.LEDGE_HOME!, 'claude.jsonl');
    writeFileSync(transcriptPath, JSON.stringify({ type: 'assistant', uuid: 'u1', timestamp: now(), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'ExitPlanMode', input: { plan: '# Add README\n\n1. Write it' } }] } }) + '\n');
    panes['ledge-a'] = fx('claude2-plan'); store.upsert(mk('a', { transcriptPath }));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now });
    for (let i = 0; i < 4; i++) { clock += 1000; await p.tick(); }
    expect(store.get('a')!.pending).toMatchObject({ kind: 'plan', body: '# Add README\n\n1. Write it', source: 'pane' });
    p.stop();
  });
  it('clears a plan dismissed in the terminal once the input box is back', async () => {
    const pending = { kind: 'plan' as const, text: '# Plan', source: 'hook' as const };
    panes['ledge-a'] = fx('claude2-plan'); store.upsert(mk('a', { state: 'waiting_permission', pending, lastHookAt: now() }));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now });
    for (let i = 0; i < 4; i++) { clock += 1000; await p.tick(); }
    expect(store.get('a')!.pending?.kind).toBe('plan');
    panes['ledge-a'] = fx('claude2-rest-after-deny');
    for (let i = 0; i < 4; i++) { clock += 1000; await p.tick(); }
    expect(store.get('a')!.state).toBe('idle');
    expect(store.get('a')!.pending).toBeUndefined();
    p.stop();
  });
  it('surfaces the workspace trust dialog of a starting session', async () => {
    panes['ledge-a'] = fx('claude2-trust'); store.upsert(mk('a', { state: 'starting' }));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now });
    clock += 1000; await p.tick();
    expect(store.get('a')!.state).toBe('waiting_permission');
    expect(store.get('a')!.pending?.text).toBe('Trust this folder? /home/dev/demo');
    p.stop();
  });
  it('refreshes repository fields on first sight and on the dead check, hook-only sessions included', async () => {
    store.upsert(mk('a')); store.upsert(mk('h', { tmuxSession: null, source: 'hook_only', cwd: '/h' }));
    const calls: string[] = [];
    const p = startPoller({ store, tmux: fakeTmux({ 'ledge-a': 'x' }), intervalMs: 1_000_000, deadCheckMs: 1_000_000, now, gitInfo: async cwd => { calls.push(cwd); return { repo: 'r', repoPath: cwd, branch: 'main', worktree: false }; } });
    await p.tick();
    expect(calls.sort()).toEqual(['/h', mk('a').cwd].sort()); expect(store.get('h')?.branch).toBe('main');
    await p.tick(); expect(calls).toHaveLength(2); // no dead check yet: no refresh
    p.stop();
  });
});
