import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect as tcp } from 'node:net';
import type { Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import WebSocket from 'ws';
import { startServer, ALLOWED_ORIGINS, FORWARDED_HEADERS, launchArgs, resolveFolder } from '../src/daemon/server.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { createDaemonUpdater } from '../src/update/run-update.js';
import { DeviceStore, type MobileControl } from '../src/daemon/devices.js';

const T0 = '2026-10-09T18:00:00.000Z';
const mk = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant',
  tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
});

type NewSession = { name: string; cwd: string; env: Record<string, string>; command: string[] };
function fakeTmux(panes: Record<string, string[]>): Tmux & { sent: string[][]; options: string[][]; created: NewSession[] } {
  // Options are kept apart from `sent`: every session update may set a tab title, and the tests on `sent` assert what was typed.
  const sent: string[][] = []; const options: string[][] = []; const created: NewSession[] = [];
  return {
    sent, options, created,
    async newSession(o) { created.push(o); panes[o.name] = ['']; }, async sendText(n, t) { sent.push(['text', n, t]); }, async sendKeys(n, k) { sent.push(['keys', n, ...k]); },
    async capture(n) { const q = panes[n] ?? ['']; return q.length > 1 ? q.shift()! : q[0]!; },
    async hasSession(n) { return n in panes; }, async listSessions() { return Object.keys(panes); },
    async setOption(n, o, v) { options.push(['option', n, o, v]); },
    async killSession(n) { delete panes[n]; sent.push(['kill', n]); }, attachArgs: n => ['attach', n]
  };
}

let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let tmux: ReturnType<typeof fakeTmux>;
// The bottom of a Claude Code 2.x permission dialog.
const PROMPT = 'x\n' + '─'.repeat(40) + '\n Bash command\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n\n Esc to cancel · Tab to amend';
beforeEach(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-'));
  store = new Store();
  tmux = fakeTmux({ 'ledge-a': [PROMPT, PROMPT, 'Running…'] });
  srv = await startServer({ store, tmux, port: 0, agentEnv: async () => ({ ...process.env, PATH: '/login/bin:/usr/bin', HTTPS_PROXY: 'http://proxy:8080' }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
});
afterEach(async () => { await srv.close(); });

/** Opens a raw WebSocket with the given Origin and extra headers; resolves with 'open' or the HTTP status of the refusal. */
function handshake(port: number, origin?: string, headers: Record<string, string> = {}): Promise<'open' | number> {
  return new Promise(res => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { ...(origin ? { origin } : {}), headers });
    ws.once('open', () => { ws.terminate(); res('open'); });
    ws.once('unexpected-response', (_req, r) => { res(r.statusCode ?? 0); ws.terminate(); });
    ws.once('error', () => {});
  });
}

describe('launchArgs and resolveFolder', () => {
  it('renames a session and tells tmux the new tab title', async () => {
    store.upsert(mk('a'));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.rename', id: 'a', topic: 'Hooks Codex' });
    const m = await c.next('session.updated');
    expect(m.session).toMatchObject({ topic: 'Hooks Codex', topicSource: 'user', title: 'Otto · Hooks Codex' });
    expect(tmux.options).toContainEqual(['option', 'ledge-a', '@ledge_title', 'Otto · Hooks Codex']);
    c.send({ type: 'session.rename', id: 'zz', topic: 'x' });
    expect((await c.next('error')).id).toBe('zz');
    await c.close();
  });
  it('builds the agent arguments: resume flag first, then the trimmed prompt; nothing for an empty form', () => {
    expect(launchArgs({ tool: 'claude' })).toEqual([]);
    expect(launchArgs({ tool: 'claude', prompt: '  ' })).toEqual([]);
    expect(launchArgs({ tool: 'claude', prompt: 'fix the build', continue: true })).toEqual(['--continue', 'fix the build']);
    expect(launchArgs({ tool: 'codex', continue: true })).toEqual(['resume', '--last']);
  });
  it('resolves a folder: ~ against the given home, absolute paths normalised', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-home-')); mkdirSync(join(home, 'w'));
    expect(await resolveFolder('~', home)).toBe(home);
    expect(await resolveFolder(' ~/w ', home)).toBe(join(home, 'w'));
    expect(await resolveFolder(`${home}/w/../w/`, home)).toBe(join(home, 'w'));
    await expect(resolveFolder('w', home)).rejects.toThrow(/not an absolute path/);
  });
});

describe('server: origin check', () => {
  it('refuses a handshake from a foreign web page', async () => {
    expect(await handshake(srv.port, 'https://evil.example')).toBe(401);
    expect(await handshake(srv.port, 'http://localhost:3000')).toBe(401);
    expect(await handshake(srv.port, 'null')).toBe(401);
  });
  it('accepts every allowlisted overlay origin', async () => {
    expect(ALLOWED_ORIGINS).toEqual(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://localhost:1420', 'http://127.0.0.1:1420']);
    for (const o of ALLOWED_ORIGINS) expect(await handshake(srv.port, o)).toBe('open');
  });
  it('accepts a Node client that sends no Origin', async () => {
    expect(await handshake(srv.port)).toBe('open');
  });
  it('refuses a forwarded upgrade on the local port', async () => {
    expect(await handshake(srv.port, undefined, { 'x-forwarded-for': '100.64.0.2' })).toBe(401);
    expect(await handshake(srv.port, undefined, { 'tailscale-user-login': 'me@example.com' })).toBe(401);
  });
  it('refuses every forwarding header, even from the overlay origin, and logs it', async () => {
    expect(FORWARDED_HEADERS).toEqual(['tailscale-user-login', 'x-forwarded-for', 'forwarded']);
    expect(await handshake(srv.port, 'tauri://localhost', { forwarded: 'for=100.64.0.2' })).toBe(401);
    expect(readFileSync(join(process.env.LEDGE_HOME!, 'daemon.log'), 'utf8')).toContain('refused a forwarded connection (forwarded)');
  });
});

describe('server', () => {
  it('returns document content and errors only to the requesting socket without touching tmux', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ledge-doc-')), 'plan.md');
    writeFileSync(file, '# Plan\n');
    const first = await connect({ port: srv.port }); await first.next('snapshot');
    const other = await connect({ port: srv.port }); await other.next('snapshot');
    first.send({ type: 'document.read', requestId: 'doc-1', path: file });
    expect(await first.next('document.content')).toMatchObject({ requestId: 'doc-1', path: file, text: '# Plan\n' });
    await expect(other.next('document.content', 100)).rejects.toThrow(/timeout/);
    first.send({ type: 'document.read', requestId: 'doc-2', path: 'relative.md' });
    expect(await first.next('document.error')).toMatchObject({ requestId: 'doc-2', code: 'ambiguous_path' });
    await expect(other.next('document.error', 100)).rejects.toThrow(/timeout/);
    expect(tmux.sent).toEqual([]);
    await first.close(); await other.close();
  });
  it('sends a snapshot on connect and broadcasts updates', async () => {
    store.upsert(mk('a'));
    const c = await connect({ port: srv.port });
    const snap = await c.next('snapshot');
    expect(snap.sessions.map(s => s.id)).toEqual(['a']);
    store.apply('a', { name: 'Stop', at: T0, source: 'hook' });
    const upd = await c.next('session.updated');
    expect(upd.session.state).toBe('idle');
    c.close();
  });

  it('a PostToolUse clears a stale pending answered in the terminal and broadcasts working', async () => {
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.event', id: 'a', event: { name: 'PostToolUse', at: T0, source: 'hook', tool: 'Bash' } });
    const upd = await c.next('session.updated');
    expect(upd.session.state).toBe('working');
    expect(upd.session.pending).toBeUndefined();
    await c.close();
  });

  it('logs a helper permission that is not routed because the parent already has a pending', async () => {
    const pending = { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook', id: 'p1-x', version: 1, since: T0 } as const;
    store.upsert(mk('a', { state: 'waiting_permission', pending }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.event', id: 'a', event: { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Edit', text: 'a.ts', helperId: 'h1' } });
    await c.next('session.updated');
    expect(store.get('a')?.pending).toEqual(pending);
    expect(readFileSync(join(process.env.LEDGE_HOME!, 'daemon.log'), 'utf8')).toContain('helper h1 permission for Edit on a not routed: the main thread already holds the pending request');
    await c.close();
  });

  describe('logs a dropped permission request from the pending before and after', () => {
    const logText = () => { try { return readFileSync(join(process.env.LEDGE_HOME!, 'daemon.log'), 'utf8'); } catch { return ''; } };
    const send = async (event: Record<string, unknown>) => {
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.event', id: 'a', event: { at: T0, source: 'hook', ...event } as never });
      await new Promise(r => setTimeout(r, 50));
      await c.close();
    };
    const helperPending = { kind: 'permission', text: 'one', tool: 'Bash', source: 'hook', helperId: 'h1', parentState: 'working', id: 'p1-x', version: 1, since: T0 } as const;
    it('a main-thread request while a helper holds the card', async () => {
      store.upsert(mk('a', { state: 'waiting_permission', pending: helperPending }));
      await send({ name: 'PermissionRequest', tool: 'Write', text: 'b.ts' });
      expect(store.get('a')?.pending).toEqual(helperPending);
      expect(logText()).toContain('main thread permission for Write on a not routed: helper h1 already holds the pending request');
    });
    it('the same helper asking twice', async () => {
      store.upsert(mk('a', { state: 'waiting_permission', pending: helperPending }));
      await send({ name: 'PermissionRequest', tool: 'Bash', text: 'two', helperId: 'h1' });
      expect(logText()).toContain('helper h1 permission for Bash on a not routed: helper h1 already holds the pending request');
    });
    it('a request on an exited session', async () => {
      store.upsert(mk('a', { state: 'exited', exitCode: 0 }));
      await send({ name: 'PermissionRequest', tool: 'Bash', text: 'x', helperId: 'h1' });
      expect(logText()).toContain('helper h1 permission for Bash on a not routed: the session has exited');
    });
    it('nothing for a routed request or the main thread refining its own card', async () => {
      store.upsert(mk('a'));
      await send({ name: 'PermissionRequest', tool: 'Bash', text: 'x', helperId: 'h1' });
      store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'plan', text: 'the plan', source: 'hook' } }));
      await send({ name: 'PermissionRequest', tool: 'ExitPlanMode', text: 'plan' });
      expect(logText()).not.toContain('not routed');
    });
  });

  it('register upgrades a hook_only session created by an early hook', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.event', id: 'b', event: { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'npm test' } });
    const first = await c.next('session.updated');
    expect(first.session.source).toBe('hook_only');
    expect(first.session.pending?.text).toBe('npm test');
    c.send({ type: 'session.register', session: mk('b', { name: 'Pim', source: 'launcher' }) });
    const second = await c.next('session.updated');
    expect(second.session.source).toBe('launcher');
    expect(second.session.name).toBe('Pim');
    expect(second.session.pending?.text).toBe('npm test');
    expect(store.all().length).toBe(1);
    c.close();
  });

  it('register re-picks a name already held by another live session and broadcasts the stored one', async () => {
    store.upsert(mk('a', { name: 'Otto' }));
    store.upsert(mk('x', { name: 'Pim', state: 'exited' }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.register', session: mk('b', { name: 'Otto', title: 'Otto · harness-assistant' }) });
    const upd = await c.next('session.updated');
    expect(upd.session.id).toBe('b');
    expect(upd.session.name).toBe('Nova');
    expect(upd.session.title).toBe('Nova · harness-assistant');
    expect(store.get('b')?.name).toBe('Nova');
    c.close();
  });

  it('register keeps a name only held by an exited session', async () => {
    store.upsert(mk('a', { name: 'Otto', state: 'exited' }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.register', session: mk('b', { name: 'Otto' }) });
    expect((await c.next('session.updated')).session.name).toBe('Otto');
    c.close();
  });

  it('decide accept types 1 alone, verifies the prompt is gone and applies Decided', async () => {
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    const upd = await c.next('session.updated', 3000);
    expect(upd.session.state).toBe('working');
    expect(upd.session.pending).toBeUndefined();
    expect(tmux.sent).toEqual([['text', 'ledge-a', '1']]);
    c.close();
  });

  it('decide accept on a plan picks "manually approve edits" read from the dialog, never auto mode', async () => {
    const plan = readFileSync(new URL('./fixtures/panes/claude2-plan.txt', import.meta.url), 'utf8').replace(/\s+$/, ''); // trimmed like Tmux.capture
    tmux = fakeTmux({ 'ledge-a': [plan, plan, 'Running…'] }); await srv.close();
    srv = await startServer({ store, tmux, port: 0 });
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'plan', text: '# Plan', source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    expect((await c.next('session.updated', 3000)).session.state).toBe('working');
    expect(tmux.sent).toEqual([['text', 'ledge-a', '2']]);
    c.close();
  });

  it('decide accept on the workspace trust dialog moves to the trust option and confirms', async () => {
    const trust = readFileSync(new URL('./fixtures/panes/claude2-trust.txt', import.meta.url), 'utf8').replace(/\s+$/, '');
    tmux = fakeTmux({ 'ledge-a': [trust, trust, 'Welcome'] }); await srv.close();
    srv = await startServer({ store, tmux, port: 0 });
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'Trust this folder? /home/dev/demo', source: 'pane' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    expect((await c.next('session.updated', 3000)).session.state).toBe('working');
    expect(tmux.sent).toEqual([['keys', 'ledge-a', 'Down', 'Enter']]);
    c.close();
  });

  it('decide fails to error when the prompt stays, and nothing is re-sent', async () => {
    tmux = fakeTmux({ 'ledge-a': [PROMPT] }); await srv.close(); srv = await startServer({ store, tmux, port: 0 });
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    const upd = await c.next('session.updated', 3000);
    expect(upd.session.state).toBe('error');
    expect(upd.session.pending?.text).toBe('npm test');
    expect(tmux.sent.length).toBe(1);
    expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: 'the terminal did not take it' });
    c.close();
  });

  it('a retry from error that the terminal still does not take replies with an error for that id', async () => {
    tmux = fakeTmux({ 'ledge-a': [PROMPT] }); await srv.close(); srv = await startServer({ store, tmux, port: 0 });
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    expect(await c.next('error', 3000)).toMatchObject({ id: 'a' });
    expect(store.get('a')?.state).toBe('error');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: 'the terminal did not take it' });
    expect(tmux.sent.length).toBe(2);
    c.close();
  });

  it('a failed capture after injecting is not read as prompt gone: session goes to error, nothing re-sent', async () => {
    tmux = fakeTmux({ 'ledge-a': [PROMPT] });
    const realCapture = tmux.capture; let captures = 0;
    tmux.capture = async (n, l) => (captures++ === 0 ? realCapture(n, l) : null);
    await srv.close(); srv = await startServer({ store, tmux, port: 0 });
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    const upd = await c.next('session.updated', 3000);
    expect(upd.session.state).toBe('error');
    expect(tmux.sent.length).toBe(1);
    c.close();
  });

  describe('fail closed when no prompt is on screen', () => {
    const NO_PROMPT = 'no prompt visible in the terminal, open the tab';
    async function expectRefused(pane: string | null, msg: object, pending: Session['pending']) {
      tmux = fakeTmux({ 'ledge-a': [pane ?? ''] }); if (pane === null) tmux.capture = async () => null;
      await srv.close(); srv = await startServer({ store, tmux, port: 0 });
      const before = mk('a', { state: pending?.kind === 'question' ? 'waiting_input' : 'waiting_permission', pending });
      store.upsert(before);
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send(msg as never);
      expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: NO_PROMPT });
      expect(tmux.sent).toEqual([]);
      expect(store.get('a')).toEqual(before);
      await expect(c.next('session.updated', 200)).rejects.toThrow(/timeout/);
      c.close();
    }
    const perm = { kind: 'permission' as const, text: 'npm test', source: 'hook' as const };
    const question = { kind: 'question' as const, text: 'Which?', source: 'hook' as const };
    it('decide on a stale pending (agent already working) injects nothing', () =>
      expectRefused('● Bash(npm test)\n  Running…', { type: 'session.decide', id: 'a', decision: 'accept' }, perm));
    it('decide when the capture fails injects nothing', () =>
      expectRefused(null, { type: 'session.decide', id: 'a', decision: 'deny' }, perm));
    it('reply to a question whose dialog is not on screen injects nothing', () =>
      expectRefused('> ', { type: 'session.reply', id: 'a', text: '2' }, question));
  });

  describe('a plan step that waits for its screen (Cursor Agent deny)', () => {
    const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8');
    const pending = { kind: 'permission' as const, text: 'echo ledge-perm-probe', source: 'pane' as const };
    async function deny(panes: string[]) {
      tmux = fakeTmux({ 'ledge-a': panes }); await srv.close();
      srv = await startServer({ store, tmux, port: 0, untilMs: 300, verify: { attempts: 2, intervalMs: 20 } });
      store.upsert(mk('a', { tool: 'cursor', state: 'waiting_permission', pending }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.decide', id: 'a', decision: 'deny' });
      return c;
    }
    it('sends Enter only once the skip field is on screen, then the prompt is gone', async () => {
      const c = await deny([fx('cursor-permission'), fx('cursor-permission'), fx('cursor-skip-field'), fx('cursor-working')]);
      await vi.waitFor(() => expect(store.get('a')?.state).toBe('working'), { timeout: 2000 });
      expect(tmux.sent).toEqual([['text', 'ledge-a', 'n'], ['keys', 'ledge-a', 'Enter']]);
      c.close();
    });
    it('never sends Enter when the skip field does not come: the decision fails', async () => {
      const c = await deny([fx('cursor-permission')]);
      expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: 'the terminal did not take it' });
      expect(tmux.sent).toEqual([['text', 'ledge-a', 'n']]);
      expect(store.get('a')?.state).toBe('error');
      c.close();
    });
  });

  it('Cursor Agent: answering question 1 of 2 ticks the option on screen, and question 2 coming up is success', async () => {
    // Trimmed at the end, as tmux.capture returns it.
    const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8').replace(/\s+$/, '');
    const q1 = fx('cursor-question-two'); const ticked = q1.replace('› [ ] c', '› [x] c');
    tmux = fakeTmux({ 'ledge-a': [q1, q1, ticked, fx('cursor-question-second')] }); await srv.close();
    srv = await startServer({ store, tmux, port: 0, untilMs: 300, verify: { attempts: 2, intervalMs: 20 } });
    store.upsert(mk('a', { tool: 'cursor', state: 'waiting_input', pending: { kind: 'question', text: 'Which letter should be added to notes.txt?', options: ['c', 'd'], source: 'pane' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.reply', id: 'a', text: '1' });
    await vi.waitFor(() => expect(store.get('a')?.state).toBe('working'), { timeout: 2000 });
    expect(tmux.sent).toEqual([['text', 'ledge-a', ' '], ['keys', 'ledge-a', 'Enter']]);
    c.close();
  });

  describe('Claude Code: an AskUserQuestion with two questions, answered from Ledge', () => {
    const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8').replace(/\s+$/, '');
    async function answer(panes: string[], pending: { kind: 'question'; text: string; source: 'hook' | 'pane' }) {
      tmux = fakeTmux({ 'ledge-a': panes }); await srv.close();
      srv = await startServer({ store, tmux, port: 0, verify: { attempts: 2, intervalMs: 20 } });
      store.upsert(mk('a', { tool: 'claude', state: 'waiting_input', pending }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.reply', id: 'a', text: '1' });
      return c;
    }
    it('question 2 coming up after question 1 is success, not a refused answer', async () => {
      const c = await answer([fx('claude2-question-multi-first'), fx('claude2-question-multi-second')], { kind: 'question', text: 'Color?', source: 'hook' });
      await vi.waitFor(() => expect(store.get('a')?.state).toBe('working'), { timeout: 2000 });
      expect(store.get('a')?.pending).toBeUndefined();
      expect(tmux.sent).toEqual([['text', 'ledge-a', '1']]);
      c.close();
    });
    it('the review screen takes its answer: Submit answers', async () => {
      const c = await answer([fx('claude2-question-multi-review'), fx('claude2-idle')], { kind: 'question', text: 'Ready to submit your answers?', source: 'pane' });
      await vi.waitFor(() => expect(store.get('a')?.state).toBe('working'), { timeout: 2000 });
      expect(tmux.sent).toEqual([['text', 'ledge-a', '1']]);
      c.close();
    });
  });

  it('a reply with no pending (your turn) is typed without a prompt check', async () => {
    tmux = fakeTmux({ 'ledge-a': ['> '] }); await srv.close(); srv = await startServer({ store, tmux, port: 0 });
    store.upsert(mk('a', { state: 'idle' }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.reply', id: 'a', text: 'run the tests' });
    await c.next('session.updated', 3000);
    expect(tmux.sent).toEqual([['text', 'ledge-a', 'run the tests'], ['keys', 'ledge-a', 'Enter']]);
    c.close();
  });

  it.each(['permission', 'diff', 'plan'] as const)('refuses a reply to a %s prompt, nothing injected', async kind => {
    const before = mk('a', { state: 'waiting_permission', pending: { kind, text: 'x', source: 'hook' } });
    store.upsert(before);
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.reply', id: 'a', text: 'yes please' });
    const err = await c.next('error');
    expect(err.id).toBe('a'); expect(err.message).toMatch(/accept or deny/);
    expect(tmux.sent).toEqual([]);
    expect(store.get('a')).toEqual(before);
    c.close();
  });

  it.each(['   ', '\n\n', ' \r\n \n\t'])('refuses a reply that is empty once flattened (%j)', async text => {
    store.upsert(mk('a', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.reply', id: 'a', text });
    expect((await c.next('error')).message).toBe('empty reply');
    expect(tmux.sent).toEqual([]);
    c.close();
  });

  it('reply with no pending types the text literally then Enter', async () => {
    store.upsert(mk('a', { state: 'idle' }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.reply', id: 'a', text: '-n ; backfill' });
    await c.next('session.updated', 3000);
    expect(tmux.sent[0]).toEqual(['text', 'ledge-a', '-n ; backfill']);
    expect(tmux.sent[1]).toEqual(['keys', 'ledge-a', 'Enter']);
    c.close();
  });

  it.each(['shadow table', '12', '0', '2 please'])('refuses a free-text reply (%j) to a question, nothing injected (fail closed)', async text => {
    const before = mk('a', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', options: ['Red', 'Blue'], source: 'pane' } });
    store.upsert(before);
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.reply', id: 'a', text });
    expect(await c.next('error')).toEqual({ type: 'error', id: 'a', message: 'free-text answers are not supported yet, answer in the terminal' });
    expect(tmux.sent).toEqual([]);
    expect(store.get('a')).toEqual(before);
    await expect(c.next('session.updated', 200)).rejects.toThrow(/timeout/);
    c.close();
  });

  it('a digit past the known options is still a selection (hook options omit the dialog extras)', async () => {
    store.upsert(mk('a', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', options: ['Red', 'Blue'], source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.reply', id: 'a', text: '3' });
    await c.next('session.updated', 3000);
    expect(tmux.sent).toEqual([['text', 'ledge-a', '3']]);
    c.close();
  });

  it('reply with an option number to a question sends the digit alone (2.x selects on the digit)', async () => {
    store.upsert(mk('a', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', options: ['Red', 'Blue'], source: 'pane' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.reply', id: 'a', text: '2' });
    expect((await c.next('session.updated', 3000)).session.state).toBe('working');
    expect(tmux.sent).toEqual([['text', 'ledge-a', '2']]);
    c.close();
  });

  describe('terminal preview delivery', () => {
    /** A raw socket that records every message type (and id) in arrival order. */
    async function recorder() {
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`);
      const got: Array<{ type: string; id?: string; lines?: string[] }> = [];
      ws.on('message', d => got.push(JSON.parse(String(d))));
      await new Promise(res => ws.once('open', res));
      const until = async (n: number) => { for (let i = 0; i < 100 && got.length < n; i++) await new Promise(r => setTimeout(r, 10)); };
      return { ws, got, until };
    }
    it('broadcasts a preview to connected clients', async () => {
      store.upsert(mk('a'));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      srv.preview('a', ['● hi']);
      expect(await c.next('session.preview')).toEqual({ type: 'session.preview', id: 'a', lines: ['● hi'] });
      c.close();
    });
    it('a client that connects later gets the last preview right after the snapshot', async () => {
      store.upsert(mk('a')); store.upsert(mk('b', { name: 'Pim' }));
      srv.preview('a', ['old']); srv.preview('a', ['● latest']);
      const r = await recorder(); await r.until(2);
      expect(r.got.map(m => m.type)).toEqual(['snapshot', 'session.preview', 'chat.history']);
      expect(r.got[1]).toEqual({ type: 'session.preview', id: 'a', lines: ['● latest'] });
      r.ws.terminate();
    });
    it('a snapshot.request gets the previews again after the snapshot', async () => {
      store.upsert(mk('a')); srv.preview('a', ['● hi']);
      const r = await recorder(); await r.until(2);
      r.ws.send(JSON.stringify({ type: 'snapshot.request' })); await r.until(6);
      expect(r.got.map(m => m.type)).toEqual(['snapshot', 'session.preview', 'chat.history', 'snapshot', 'session.preview', 'chat.history']);
      r.ws.terminate();
    });
    it('a removed session drops its preview; a preview for an unknown session is ignored', async () => {
      store.upsert(mk('a')); srv.preview('a', ['● hi']); srv.preview('ghost', ['boo']);
      store.remove('a');
      const r = await recorder(); await r.until(1); await new Promise(res => setTimeout(res, 50));
      expect(r.got.map(m => m.type)).toEqual(['snapshot', 'chat.history']);
      store.upsert(mk('a'));
      r.ws.send(JSON.stringify({ type: 'snapshot.request' })); await r.until(5); await new Promise(res => setTimeout(res, 50));
      expect(r.got.filter(m => m.type === 'session.preview')).toEqual([]);
      r.ws.terminate();
    });
  });

  describe('dismiss', () => {
    it('removes an exited session: session.removed is broadcast and the journal forgets it', async () => {
      store.upsert(mk('a', { state: 'exited', exitCode: 0, exitedAt: T0 })); srv.preview('a', ['● bye']);
      const c = await connect({ port: srv.port }); await c.next('snapshot'); await c.next('session.preview');
      const other = await connect({ port: srv.port }); await other.next('snapshot');
      c.send({ type: 'session.dismiss', id: 'a' });
      expect(await c.next('session.removed')).toEqual({ type: 'session.removed', id: 'a' });
      expect(await other.next('session.removed')).toEqual({ type: 'session.removed', id: 'a' });
      expect(store.get('a')).toBeUndefined();
      await store.save();
      const journal = JSON.parse(readFileSync(join(process.env.LEDGE_HOME!, 'sessions.json'), 'utf8'));
      expect(journal.sessions.map((s: Session) => s.id)).not.toContain('a');
      // Its preview is gone: a new client gets none.
      c.send({ type: 'snapshot.request' }); await c.next('snapshot');
      await expect(c.next('session.preview', 150)).rejects.toThrow(/timeout/);
      c.close(); other.close();
    });
    it('removes a read-only (hook_only) session even while it runs', async () => {
      store.upsert(mk('h', { source: 'hook_only', tmuxSession: null, state: 'working' }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.dismiss', id: 'h' });
      expect((await c.next('session.removed')).id).toBe('h');
      // A later hook brings it back through the hook-before-register path.
      c.send({ type: 'session.event', id: 'h', event: { name: 'Stop', at: T0, source: 'hook' } });
      expect((await c.next('session.updated')).session.id).toBe('h');
      c.close();
    });
    it('refuses a live launcher session and an unknown id with an error for that id', async () => {
      store.upsert(mk('a'));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.dismiss', id: 'a' });
      expect(await c.next('error')).toEqual({ type: 'error', id: 'a', message: 'the session is still running, kill it first' });
      expect(store.get('a')).toBeDefined();
      c.send({ type: 'session.dismiss', id: 'nope' });
      expect(await c.next('error')).toEqual({ type: 'error', id: 'nope', message: 'unknown session' });
      await expect(c.next('session.removed', 100)).rejects.toThrow(/timeout/);
      c.close();
    });
  });

  describe('launch from the overlay', () => {
    const home = () => process.env.LEDGE_HOME!;
    it('creates the tmux session in the folder, registers it starting, answers the requester and broadcasts', async () => {
      mkdirSync(join(home(), 'api-gateway'));
      const c = await connect({ port: srv.port }); const snap0 = await c.next('snapshot');
      expect(snap0.launcher).toEqual([process.execPath, process.argv[1]]);
      const other = await connect({ port: srv.port }); await other.next('snapshot');
      c.send({ type: 'session.launch', tool: 'claude', cwd: join(home(), 'api-gateway'), name: 'juno', prompt: ' run the tests ', continue: true });
      const launched = await c.next('session.launched');
      const s = store.get(launched.id)!;
      expect(s).toMatchObject({ name: 'Juno', tool: 'claude', cwd: join(home(), 'api-gateway'), project: 'api-gateway', title: 'Juno · api-gateway', state: 'starting', source: 'launcher', tmuxSession: `ledge-${launched.id}` });
      expect(tmux.created).toHaveLength(1);
      expect(tmux.created[0]).toMatchObject({ name: `ledge-${launched.id}`, cwd: join(home(), 'api-gateway'), command: ['claude', '--continue', 'run the tests'] });
      // The daemon runs with systemd's bare PATH: the agent gets the login shell's instead, so `claude` resolves as in a terminal.
      expect(tmux.created[0]!.env).toMatchObject({ LEDGE_SESSION: launched.id, LEDGE_NAME: 'Juno', PATH: '/login/bin:/usr/bin', HTTPS_PROXY: 'http://proxy:8080' });
      expect((await other.next('session.updated')).session.id).toBe(launched.id);
      // The other client never gets the launched reply; both learn the new recent folder.
      await expect(other.next('session.launched', 100)).rejects.toThrow(/timeout/);
      expect((await other.next('recents')).recents).toEqual([{ cwd: join(home(), 'api-gateway'), project: 'api-gateway', lastAt: s.startedAt }]);
      c.close(); other.close();
    });
    it('picks a free name when none is given or the wanted one is live, and never a live id', async () => {
      mkdirSync(join(home(), 'p'));
      store.upsert(mk('a', { name: 'Otto' })); store.upsert(mk('b', { name: 'Pim', state: 'exited' }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.launch', tool: 'codex', cwd: join(home(), 'p') });
      const first = await c.next('session.launched');
      expect(store.get(first.id)!.name).toBe('Pim'); // exited sessions free their name
      expect(['a', 'b']).not.toContain(first.id);
      c.send({ type: 'session.launch', tool: 'cursor', cwd: join(home(), 'p'), name: 'Otto' });
      const second = await c.next('session.launched');
      expect(store.get(second.id)!.name).toBe('Otto-2');
      expect(tmux.created.map(x => x.command[0])).toEqual(['codex', 'cursor-agent']);
      // Codex hooks run in a shared daemon: the session id reaches them through a per-thread config override.
      expect(tmux.created[0]!.command).toEqual(['codex', '-c', `shell_environment_policy.set.LEDGE_CODEX_HOOK_SESSION="${first.id}"`]);
      expect(tmux.created[0]!.env).toMatchObject({ LEDGE_SESSION: first.id, LEDGE_CODEX_SESSION: first.id });
      expect(tmux.created[1]!.env.LEDGE_CODEX_SESSION).toBeUndefined();
      c.close();
    });
    it('expands ~ and refuses a missing folder or a file with an error for the requester', async () => {
      mkdirSync(join(home(), 'tilde')); writeFileSync(join(home(), 'file.txt'), 'x');
      const srv2 = await startServer({ store, tmux, port: 0, home: home() });
      const c = await connect({ port: srv2.port }); await c.next('snapshot');
      c.send({ type: 'session.launch', tool: 'claude', cwd: '~/tilde' });
      expect(store.get((await c.next('session.launched')).id)!.cwd).toBe(join(home(), 'tilde'));
      c.send({ type: 'session.launch', tool: 'claude', cwd: '~/nope' });
      expect(await c.next('error')).toEqual({ type: 'error', message: `no such folder: ${join(home(), 'nope')}` });
      c.send({ type: 'session.launch', tool: 'claude', cwd: join(home(), 'file.txt') });
      expect((await c.next('error')).message).toMatch(/not a folder/);
      c.send({ type: 'session.launch', tool: 'claude', cwd: 'relative/path' });
      expect((await c.next('error')).message).toMatch(/not an absolute path/);
      expect(tmux.created).toHaveLength(1);
      c.close(); await srv2.close();
    });
    it('browses folders for the requester only: lists home, creates a folder and lands in it, says why it cannot', async () => {
      mkdirSync(join(home(), 'api-gateway'));
      const srv2 = await startServer({ store, tmux, port: 0, home: home() });
      const c = await connect({ port: srv2.port }); await c.next('snapshot');
      const other = await connect({ port: srv2.port }); await other.next('snapshot');
      c.send({ type: 'folder.list' });
      expect(await c.next('folder.listing')).toMatchObject({ path: home(), entries: ['api-gateway'] });
      c.send({ type: 'folder.create', parent: '~', name: 'new-project' });
      expect(await c.next('folder.listing')).toEqual({ type: 'folder.listing', path: join(home(), 'new-project'), parent: home(), entries: [] });
      c.send({ type: 'folder.create', parent: '~', name: 'new-project' });
      expect(await c.next('folder.listing')).toMatchObject({ path: home(), error: 'already exists: new-project' });
      await expect(other.next('folder.listing', 100)).rejects.toThrow(/timeout/);
      c.close(); other.close(); await srv2.close();
    });
    it('a terminal launch records its folder among the recents too, most recent first', async () => {
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.register', session: mk('a', { cwd: '/w/one', project: 'one', startedAt: '2026-10-10T09:00:00.000Z' }) });
      await c.next('session.updated');
      c.send({ type: 'session.register', session: mk('b', { name: 'Pim', cwd: '/w/two', project: 'two', startedAt: '2026-10-10T10:00:00.000Z' }) });
      await c.next('session.updated');
      c.send({ type: 'snapshot.request' });
      expect((await c.next('snapshot')).recents).toEqual([{ cwd: '/w/two', project: 'two', lastAt: '2026-10-10T10:00:00.000Z' }, { cwd: '/w/one', project: 'one', lastAt: '2026-10-10T09:00:00.000Z' }]);
      c.close();
    });
  });

  it('kill removes the tmux session and marks the bot exited', async () => {
    store.upsert(mk('a'));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.kill', id: 'a' });
    const upd = await c.next('session.updated');
    expect(upd.session.state).toBe('exited');
    expect(tmux.sent).toContainEqual(['kill', 'ledge-a']);
    c.close();
  });

  it('caps the queue of unsolicited messages at the most recent 100', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    for (let i = 0; i < 150; i++) srv.broadcast({ type: 'session.removed', id: `r${i}` });
    // The sync point is a reply with nothing after it: a snapshot is followed by chat.history, which would take a queue slot.
    c.send({ type: 'session.decide', id: 'zzz', decision: 'maybe' } as never); await c.next('error');
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) ids.push((await c.next('session.removed', 200)).id);
    expect(ids[0]).toBe('r50'); expect(ids[99]).toBe('r149');
    await expect(c.next('session.removed', 100)).rejects.toThrow(/timeout/);
    c.close();
  });

  it('survives a protocol violation on a raw socket', async () => {
    await new Promise<void>(res => {
      const sock = tcp(srv.port, '127.0.0.1', () => {
        sock.write(`GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
        setTimeout(() => { sock.write(Buffer.from([0x81, 0x02, 0x68, 0x69])); setTimeout(() => { sock.destroy(); res(); }, 150); }, 100);
      });
    });
    const c = await connect({ port: srv.port });
    await c.next('snapshot'); c.close();
  });

  it('two decides back-to-back inject once', async () => {
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    const err = await c.next('error');
    expect(err.message).toMatch(/already in progress/);
    await c.next('session.updated', 3000);
    expect(tmux.sent).toEqual([['text', 'ledge-a', '1']]);
    c.close();
  });

  it('does not apply Decided over a newer pending', async () => {
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    await new Promise(r => setTimeout(r, 100));
    store.apply('a', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'rm -rf x' });
    await new Promise(r => setTimeout(r, 800));
    expect(store.get('a')?.state).toBe('waiting_permission');
    expect(store.get('a')?.pending?.text).toBe('rm -rf x');
    c.close();
  });

  it('a failing key plan marks the session error and replies with an error', async () => {
    store.upsert(mk('a', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.reply', id: 'a', text: '2' });
    tmux.sendText = async () => { throw new Error('tmux send failed'); };
    const err = await c.next('error');
    expect(err.message).toMatch(/tmux send failed/);
    expect(store.get('a')?.state).toBe('error');
    c.close();
  });

  it('refuses decide, reply, interrupt and kill on a hook_only session, with no state change', async () => {
    const ro = mk('h', { tmuxSession: null, source: 'hook_only', state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } });
    store.upsert(ro);
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    const msgs = [
      { type: 'session.decide', id: 'h', decision: 'accept' },
      { type: 'session.reply', id: 'h', text: 'hello' },
      { type: 'session.interrupt', id: 'h' },
      { type: 'session.kill', id: 'h' }
    ] as const;
    for (const m of msgs) {
      c.send(m);
      const err = await c.next('error');
      expect(err).toEqual({ type: 'error', id: 'h', message: 'session started without ledge, read only' });
    }
    expect(store.get('h')).toEqual(ro);
    expect(tmux.sent).toEqual([]);
    await expect(c.next('session.updated', 200)).rejects.toThrow(/timeout/);
    c.close();
  });

  it('answers bad input with an error message and keeps serving', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'zzz', decision: 'maybe' } as never);
    const err = await c.next('error');
    expect(err.message).toMatch(/invalid/i);
    c.send({ type: 'snapshot.request' });
    await c.next('snapshot');
    c.close();
  });
});

describe('chat', () => {
  it('answers a question with steps, deltas and a result, then serves it in the history', async () => {
    store.upsert(mk('a', { topic: 'Hooks' }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    expect((await c.next('chat.history')).turns).toEqual([]);
    c.send({ type: 'chat.ask', qid: 'q1', text: 'Où en sont les autres ?' });
    const step = await c.next('chat.step'); expect(step.step).toEqual({ kind: 'sessions' });
    expect((await c.next('chat.step')).step).toEqual({ kind: 'pane', id: 'a', name: 'Otto' });
    expect((await c.next('chat.delta')).text).toBe('Deux ');
    const done = await c.next('chat.done', 5000); expect(done.text).toContain('Question : Où en sont les autres ?');
    await c.close();
    const c2 = await connect({ port: srv.port }); await c2.next('snapshot');
    const h = await c2.next('chat.history'); expect(h.turns).toHaveLength(1); expect(h.turns[0]).toMatchObject({ qid: 'q1', answer: done.text, steps: [{ kind: 'sessions' }, { kind: 'pane', id: 'a', name: 'Otto' }] });
    await c2.close();
  });
  it('tells a client connected before the question about the turn before its first step', async () => {
    const got: Array<{ type: string; turns?: Array<Record<string, unknown>> }> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`);
    const finished = new Promise<void>(res => ws.on('message', d => { const m = JSON.parse(String(d)); got.push(m); if (m.type === 'chat.done') res(); }));
    await new Promise(r => ws.once('open', r));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'chat.ask', qid: 'q1', text: 'a' });
    await finished;
    const chat = got.filter(m => m.type.startsWith('chat.'));
    // The connect-time history (empty), then the in-flight turn (no answer yet), then the first step.
    expect(chat.slice(0, 3).map(m => m.type)).toEqual(['chat.history', 'chat.history', 'chat.step']);
    expect(chat[1]!.turns).toEqual([expect.objectContaining({ qid: 'q1', question: 'a' })]);
    expect(chat[1]!.turns![0]).not.toHaveProperty('answer');
    ws.terminate(); await c.close();
  });
  it('refuses a second question while one runs', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'chat.ask', qid: 'q1', text: 'a' }); c.send({ type: 'chat.ask', qid: 'q2', text: 'b' });
    const err = await c.next('chat.error'); expect(err.qid).toBe('q2');
    await c.next('chat.done', 5000);
    await c.close();
  });
});

describe('update.daemon', () => {
  it('sends the daemon info in the snapshot and routes update.daemon to the updater', async () => {
    await srv.close();
    const seen: string[] = [];
    srv = await startServer({ store, tmux, port: 0, agentEnv: async () => ({ ...process.env }), daemon: { version: '0.2.2', install: 'npm', systemd: true },
      updater: { running: () => false, update: async (v, send) => { seen.push(v); send({ type: 'update.progress', version: v, step: 'installing' }); } } });
    const c = await connect({ port: srv.port });
    const snap = await c.next('snapshot');
    expect(snap.daemon).toEqual({ version: '0.2.2', install: 'npm', systemd: true });
    c.send({ type: 'update.daemon', version: '0.3.0' });
    expect(await c.next('update.progress')).toMatchObject({ step: 'installing' });
    expect(seen).toEqual(['0.3.0']);
    await c.close();
  });
  it('answers busy to the second overlay only, the first keeps its flow', async () => {
    await srv.close();
    let release!: () => void;
    const updater = createDaemonUpdater({ info: () => ({ version: '0.2.2', install: 'npm', systemd: true }), atRisk: async () => false,
      npm: () => new Promise(r => { release = () => r({ code: 1, output: 'x' }); }), restart: async () => 0, save: async () => {} });
    srv = await startServer({ store, tmux, port: 0, agentEnv: async () => ({ ...process.env }), daemon: { version: '0.2.2', install: 'npm', systemd: true }, updater });
    const a = await connect({ port: srv.port }); const b = await connect({ port: srv.port });
    await a.next('snapshot'); await b.next('snapshot');
    a.send({ type: 'update.daemon', version: '0.3.0' });
    await a.next('update.progress'); await b.next('update.progress');
    b.send({ type: 'update.daemon', version: '0.3.0' });
    expect(await b.next('update.failed')).toMatchObject({ reason: 'busy' });
    await expect(a.next('update.failed', 200)).rejects.toThrow(/timeout/);
    release();
    await a.close(); await b.close();
  });
});

describe('device commands', () => {
  const cred = { id: 'c', publicKey: 'pk', counter: 0 };
  const withMobile = async () => {
    const devices = new DeviceStore({ path: join(process.env.LEDGE_HOME!, 'devices.json') });
    const configured: (string | null)[] = [];
    const mobile: MobileControl = { devices, state: () => ({ origin: 'https://pc.tail.ts.net', listening: true }), configure: async o => { configured.push(o); } };
    await srv.close();
    srv = await startServer({ store, tmux, port: 0, agentEnv: async () => ({ ...process.env }), mobile });
    return { devices, configured };
  };
  const fakeRemote = () => {
    const handlers: Record<string, ((...a: any[]) => void)[]> = {}; const closed: number[] = [];
    const sock = {
      readyState: 1, closed, send() {}, on(ev: string, fn: (...a: any[]) => void) { (handlers[ev] ??= []).push(fn); return sock; },
      close(code?: number) { closed.push(code ?? 1000); for (const h of handlers.close ?? []) h(); }
    };
    return sock;
  };

  it('without mobile, the three commands answer an error', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    for (const m of [{ type: 'devices' }, { type: 'device.revoke', id: 'x' }, { type: 'mobile.configure', origin: null }] as const) {
      c.send(m);
      expect(await c.next('error')).toMatchObject({ message: 'mobile not available' });
    }
    await c.close();
  });
  it('lists devices with the origin and listening state', async () => {
    const { devices } = await withMobile();
    const { device } = await devices.create('iPhone', cred);
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'devices' });
    expect(await c.next('devices')).toEqual({ type: 'devices', devices: [expect.objectContaining({ id: device.id, name: 'iPhone', hasKey: true })], origin: 'https://pc.tail.ts.net', listening: true });
    await c.close();
  });
  it("device.revoke closes that device's open sockets with 4403 and tells local peers", async () => {
    const { devices } = await withMobile();
    const { device } = await devices.create('iPhone', cred);
    const other = await devices.create('iPad', cred);
    const mine = fakeRemote(); const theirs = fakeRemote();
    srv.attach(mine, { kind: 'remote', deviceId: device.id });
    srv.attach(theirs, { kind: 'remote', deviceId: other.device.id });
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'device.revoke', id: device.id });
    const m = await c.next('devices');
    expect(m.devices.map((d: { id: string }) => d.id)).toEqual([other.device.id]);
    expect(mine.closed).toEqual([4403]);
    expect(theirs.closed).toEqual([]);
    expect(devices.get(device.id)).toBeUndefined();
    c.send({ type: 'device.revoke', id: device.id });
    expect(await c.next('error')).toMatchObject({ message: 'unknown device' });
    await c.close();
  });
  it('mobile.configure hands the origin to the control and broadcasts the new state', async () => {
    const { configured } = await withMobile();
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'mobile.configure', origin: 'https://pc.tail.ts.net' });
    await c.next('devices');
    expect(configured).toEqual(['https://pc.tail.ts.net']);
    await c.close();
  });
});
