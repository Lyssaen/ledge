import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect as tcp } from 'node:net';
import type { ChatAction, ChatClose, ChatProposal, ChatRelay, Projects, ServerMessage, Session, SessionEvent } from '@ledge/protocol';
import { DEFAULT_ISLAND_PREFS, pendingKey } from '@ledge/protocol';
import type { Chat } from '../src/chat/service.js';
import { sessionKey } from '../src/auth.js';
import { resolveAction } from '../src/daemon/actions.js';
import { Store } from '../src/daemon/store.js';
import { ledgeCard } from './helpers/ledge-card.js';
import WebSocket from 'ws';
import { startServer, ALLOWED_ORIGINS, launchArgs, resolveFolder } from '../src/daemon/server.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { connect } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { createDaemonUpdater } from '../src/update/run-update.js';
import { History } from '../src/daemon/history.js';
import { authHeaders, until } from './helpers.js';
import { paths } from '../src/paths.js';
import { writeMachines } from '../src/daemon/machines.js';
import { writeProjects } from '../src/daemon/projects.js';
import { createMobileService } from '../src/mobile/service.js';
import { mailId } from '../src/daemon/crossSession.js';

const T0 = '2026-10-09T18:00:00.000Z';
const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8');
const tmpDir = () => mkdtempSync(join(tmpdir(), 'ledge-history-'));
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
/** The same dialog showing `command` between its dashed rules, its lines drawn as they are. */
const bashPrompt = (command: string) => ['x', '─'.repeat(80), ' Bash command', '╌'.repeat(80), ...command.split('\n').map(l => ` ${l}`), '╌'.repeat(80),
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '', ' Esc to cancel · Tab to amend'].join('\n');
/** A Claude Code 2.x question dialog (« Which? »), its third option the one the hook does not list. */
const QUESTION = 'x\n' + '─'.repeat(40) + '\n Which?\n\n ❯ 1. Red\n   2. Blue\n   3. Type something.\n\n Enter to select · ↑/↓ to navigate · Esc to cancel';
beforeEach(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-'));
  store = new Store();
  tmux = fakeTmux({ 'ledge-a': [PROMPT, PROMPT, 'Running…'] });
  srv = await startServer({ store, tmux, port: 0, agentEnv: async () => ({ ...process.env, PATH: '/login/bin:/usr/bin', HTTPS_PROXY: 'http://proxy:8080' }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
});
afterEach(async () => { await srv.close(); });

/** Opens a raw WebSocket with the given Origin; resolves with 'open' or the HTTP status of the refusal. */
function handshake(port: number, origin?: string): Promise<'open' | number> {
  return new Promise(res => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: authHeaders(), ...(origin ? { origin } : {}) });
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
  it('extra folders go to Claude with --add-dir, the prompt after --', () => {
    expect(launchArgs({ tool: 'claude', prompt: 'Relis', dirs: ['/w/a', '/w/b'] })).toEqual(['--add-dir', '/w/a', '/w/b', '--', 'Relis']);
    expect(launchArgs({ tool: 'claude', prompt: 'Relis' })).toEqual(['Relis']);
    expect(launchArgs({ tool: 'claude', continue: true, dirs: ['/w/a'] })).toEqual(['--continue', '--add-dir', '/w/a']);
    expect(launchArgs({ tool: 'claude', prompt: 'Relis', dirs: [] })).toEqual(['Relis']);
  });
  it('model and effort go before the folders and the prompt, each agent its own way (#58)', () => {
    expect(launchArgs({ tool: 'claude', prompt: 'Relis', model: 'opus', effort: 'high', dirs: ['/w/a'] })).toEqual(['--model', 'opus', '--effort', 'high', '--add-dir', '/w/a', '--', 'Relis']);
    expect(launchArgs({ tool: 'codex', prompt: 'Relis', model: 'gpt-6.1-sol', effort: 'ultra', continue: true })).toEqual(['resume', '--last', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="ultra"', 'Relis']);
    expect(launchArgs({ tool: 'cursor', model: 'gpt-5.3-codex-high' })).toEqual(['--model', 'gpt-5.3-codex-high']);
    expect(launchArgs({ tool: 'claude', effort: 'low' })).toEqual(['--effort', 'low']);
  });
  it('resolves a folder: ~ against the given home, absolute paths normalised', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-home-')); mkdirSync(join(home, 'w'));
    expect(await resolveFolder('~', home)).toBe(home);
    expect(await resolveFolder(' ~/w ', home)).toBe(join(home, 'w'));
    expect(await resolveFolder(`${home}/w/../w/`, home)).toBe(join(home, 'w'));
    await expect(resolveFolder('w', home)).rejects.toThrow(/not an absolute path/);
  });
});

describe('server: extra folders and repos.inspect', () => {
  const home = () => process.env.LEDGE_HOME!;
  it('a harness that takes one folder refuses extra ones, spawning nothing', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.launch', tool: 'codex', cwd: home(), dirs: [tmpdir()] });
    expect(await c.next('error')).toEqual({ type: 'error', message: 'launch: codex takes one folder', request: 'session.launch' });
    expect(tmux.created).toEqual([]);
    c.close();
  });
  it('a launch records the model and effort asked; Cursor refuses an effort apart from its model (#58)', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.launch', tool: 'claude', cwd: home(), model: 'sonnet', effort: 'max' });
    const { id } = await c.next('session.launched');
    expect(store.get(id)).toMatchObject({ model: 'sonnet', effort: 'max' });
    expect(tmux.created[0]!.command).toEqual(expect.arrayContaining(['--model', 'sonnet', '--effort', 'max']));
    c.send({ type: 'session.launch', tool: 'cursor', cwd: home(), model: 'auto', effort: 'high' });
    expect(await c.next('error')).toEqual({ type: 'error', message: 'launch: cursor takes its effort in the model id', request: 'session.launch' });
    expect(tmux.created).toHaveLength(1);
    c.close();
  });
  it('an extra folder is resolved like the cwd: a missing one is refused', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.launch', tool: 'claude', cwd: home(), dirs: ['~/nope'] });
    const err = await c.next('error');
    expect(err.message).toMatch(/no such folder/); expect(err.request).toBe('session.launch');
    expect(tmux.created).toEqual([]);
    c.close();
  });
  it('repos.inspect answers each path: Git branch, plain folder, missing, in order', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'ledge-repo-')); const plain = mkdtempSync(join(tmpdir(), 'ledge-plain-'));
    execFileSync('git', ['init', '-b', 'trunk', repo]);
    execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'one']);
    const missing = join(plain, 'missing');
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'repos.inspect', requestId: 'r1', paths: [repo, plain, missing] });
    expect(await c.next('repos.info')).toEqual({ type: 'repos.info', requestId: 'r1', repos: [
      { path: repo, exists: true, branch: 'trunk' }, { path: plain, exists: true, branch: null }, { path: missing, exists: false, branch: null }
    ] });
    c.close();
  });
  it('repos.scan answers repos.found on the same socket: home, then the parents of recent and live folders outside home', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-scan-home-')); const away = mkdtempSync(join(tmpdir(), 'ledge-scan-away-')); const far = mkdtempSync(join(tmpdir(), 'ledge-scan-far-'));
    const init = (p: string, remote?: string) => { mkdirSync(p, { recursive: true }); execFileSync('git', ['init', '-q', '-b', 'main', p]); if (remote) execFileSync('git', ['-C', p, 'remote', 'add', 'origin', remote]); };
    init(join(home, 'w/app'), 'https://bob:secret@github.com/paradow/app.git');
    init(join(away, 'sib')); mkdirSync(join(away, 'recent'));
    init(join(far, 'other')); mkdirSync(join(far, 'live'));
    store.touchRecent(join(away, 'recent'), 'recent', T0);
    store.upsert(mk('a', { cwd: join(far, 'live') }));
    const srv2 = await startServer({ store, tmux, port: 0, home });
    const c = await connect({ port: srv2.port }); await c.next('snapshot');
    c.send({ type: 'repos.scan', requestId: 's1' });
    const found = await c.next('repos.found', 5000);
    expect({ ...found, repos: [...found.repos].sort((a, b) => a.path.localeCompare(b.path)) }).toEqual({ type: 'repos.found', requestId: 's1', truncated: false, repos: [
      { path: join(home, 'w/app'), branch: 'main', remote: 'github.com/paradow/app' },
      { path: join(away, 'sib'), branch: 'main' }, { path: join(far, 'other'), branch: 'main' }
    ].sort((a, b) => a.path.localeCompare(b.path)) });
    c.close(); await srv2.close();
  });
  it('concurrent repos.scan share one walk: each request gets the same result under its own requestId', async () => {
    let calls = 0; let finish!: (v: { repos: { path: string; branch: string | null }[]; truncated: boolean }) => void;
    const scan = async () => { calls++; return new Promise<{ repos: { path: string; branch: string | null }[]; truncated: boolean }>(r => { finish = r; }); };
    const srv2 = await startServer({ store, tmux, port: 0, home: mkdtempSync(join(tmpdir(), 'ledge-scan-home-')), scan });
    const a = await connect({ port: srv2.port }); await a.next('snapshot');
    const b = await connect({ port: srv2.port }); await b.next('snapshot');
    a.send({ type: 'repos.scan', requestId: 's1' }); b.send({ type: 'repos.scan', requestId: 's2' }); a.send({ type: 'repos.scan', requestId: 's3' });
    await until(() => calls === 1); await new Promise(r => setTimeout(r, 50));
    expect(calls).toBe(1);
    const repos = [{ path: '/w/x', branch: 'main' }];
    finish({ repos, truncated: true });
    expect(await a.next('repos.found')).toEqual({ type: 'repos.found', requestId: 's1', repos, truncated: true });
    expect(await b.next('repos.found')).toEqual({ type: 'repos.found', requestId: 's2', repos, truncated: true });
    expect(await a.next('repos.found')).toEqual({ type: 'repos.found', requestId: 's3', repos, truncated: true });
    a.send({ type: 'repos.scan', requestId: 's4' }); // the walk is over: a new one starts
    await until(() => calls === 2);
    finish({ repos: [], truncated: false });
    expect(await a.next('repos.found')).toEqual({ type: 'repos.found', requestId: 's4', repos: [], truncated: false });
    a.close(); b.close(); await srv2.close();
  });
});

describe('server: origin check', () => {
  it('refuses a handshake from a foreign web page', async () => {
    expect(await handshake(srv.port, 'https://evil.example')).toBe(401);
    expect(await handshake(srv.port, 'http://localhost:3000')).toBe(401);
    expect(await handshake(srv.port, 'null')).toBe(401);
  });
  it('accepts every allowlisted overlay origin', async () => {
    expect(ALLOWED_ORIGINS).toEqual(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://localhost:1420', 'http://127.0.0.1:1420', 'http://localhost:1421', 'http://127.0.0.1:1421']);
    for (const o of ALLOWED_ORIGINS) expect(await handshake(srv.port, o)).toBe('open');
  });
  it('accepts the Desktop dev origin on 1421 only', async () => {
    expect(await handshake(srv.port, 'http://localhost:1421')).toBe('open');
    expect(await handshake(srv.port, 'http://127.0.0.1:1421')).toBe('open');
    expect(await handshake(srv.port, 'http://localhost:1422')).not.toBe('open');
    expect(await handshake(srv.port, 'http://evil:1421')).not.toBe('open');
    expect(ALLOWED_ORIGINS).toContain('http://localhost:1421');
  });
  it('accepts a Node client that sends no Origin', async () => {
    expect(await handshake(srv.port)).toBe('open');
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
    const pending = { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } as const;
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
    const helperPending = { kind: 'permission', text: 'one', tool: 'Bash', source: 'hook', helperId: 'h1', parentState: 'working' } as const;
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

  it('routes the first event of a hook-only session through the store, so event listeners see it', async () => {
    const seen: string[] = [];
    store.onEvent((id, ev) => seen.push(`${id}:${ev.name}`));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.event', id: 'h1', cwd: '/w/x', event: { name: 'UserPromptSubmit', at: T0, source: 'hook', text: 'Fais le plan' } });
    await c.next('session.updated');
    expect(seen).toEqual(['h1:UserPromptSubmit']);
    expect(store.get('h1')?.source).toBe('hook_only');
    c.close();
  });

  it('reads a session document from the folder its hooks report, once the agent moved into a worktree', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ledge-doc-')); const workdir = join(root, 'wt'); mkdirSync(join(workdir, 'docs'), { recursive: true });
    writeFileSync(join(workdir, 'docs', 'plan.md'), '# Plan\n');
    store.upsert(mk('a', { cwd: root }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.event', id: 'a', cwd: workdir, event: { name: 'UserPromptSubmit', at: T0, source: 'hook', text: 'écris le plan' } });
    await c.next('session.updated');
    expect(store.get('a')).toMatchObject({ cwd: root, workdir });
    c.send({ type: 'document.read', requestId: 'doc-wt', path: 'docs/plan.md', sessionId: 'a' });
    expect(await c.next('document.content')).toMatchObject({ requestId: 'doc-wt', path: join(workdir, 'docs', 'plan.md') });
    c.close();
  });

  it('a hook from an archived hook_only session brings it back', async () => {
    store.upsert(mk('h', { source: 'hook_only', tmuxSession: null, archivedAt: T0 }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.event', id: 'h', event: { name: 'UserPromptSubmit', at: T0, source: 'hook', text: 'encore' } });
    await c.next('session.updated');
    expect(store.get('h')!.archivedAt).toBeUndefined();
    c.close();
  });

  it('register upgrades a hook_only session created by an early hook', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.event', id: 'b', event: { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'npm test' } });
    await c.next('session.updated'); // the bare session, then the event applied to it
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

  describe('resume label', () => {
    const transcript = () => { const p = join(mkdtempSync(join(tmpdir(), 'ledge-tr-')), 'abc.jsonl'); writeFileSync(p, '{"type":"user"}\n'); return p; };
    const lines = (p: string) => readFileSync(p, 'utf8').trimEnd().split('\n');

    it('labels the transcript of an exited launched Claude once per exit', async () => {
      const p = transcript();
      store.upsert(mk('a', { name: 'Pim', topic: 'Sujet', transcriptPath: p }));
      store.upsert(mk('a', { name: 'Pim', topic: 'Sujet', transcriptPath: p, state: 'exited', exitedAt: T0 }));
      await until(() => lines(p).length === 2);
      expect(JSON.parse(lines(p)[1]!)).toEqual({ type: 'custom-title', customTitle: 'Pim - Sujet', sessionId: 'abc', ledge: true });
      store.upsert(mk('a', { name: 'Pim', topic: 'Sujet', transcriptPath: p, state: 'exited', exitedAt: T0, lastActivityAt: '2026-10-09T18:05:00.000Z' }));
      await new Promise(r => setTimeout(r, 50));
      expect(lines(p)).toHaveLength(2);
    });

    it('a session resumed and exited again is relabelled with its new topic', async () => {
      const p = transcript();
      store.upsert(mk('a', { name: 'Pim', topic: 'Sujet', transcriptPath: p, state: 'exited', exitedAt: T0 }));
      await until(() => lines(p).length === 2);
      store.upsert(mk('a', { name: 'Pim', topic: 'Autre', transcriptPath: p }));
      store.upsert(mk('a', { name: 'Pim', topic: 'Autre', transcriptPath: p, state: 'exited', exitedAt: '2026-10-09T19:00:00.000Z' }));
      await until(() => lines(p).length === 3);
      expect(JSON.parse(lines(p)[2]!).customTitle).toBe('Pim - Autre');
    });

    it('waits for the Claude process to end: no label while a live peer holds the transcript, written on the next retry', async () => {
      const p = transcript(); const q = transcript(); const st = new Store();
      let peers = [{ pid: 1, sessionId: 'abc', name: 'Pim', address: 'uds:/x/1.sock' }];
      const s2 = await startServer({ store: st, tmux: fakeTmux({}), port: 0, peers: () => peers });
      try {
        st.upsert(mk('a', { name: 'Pim', topic: 'Sujet', transcriptPath: p, state: 'exited', exitedAt: T0 }));
        st.upsert(mk('b', { name: 'Nova', topic: 'Sujet', transcriptPath: q, state: 'exited', exitedAt: T0 }));
        await new Promise(r => setTimeout(r, 50));
        s2.labelExited();
        expect(lines(p)).toHaveLength(1); expect(lines(q)).toHaveLength(1);
        st.upsert(mk('b', { name: 'Nova', topic: 'Sujet', transcriptPath: q })); // respawned before the retry: not this exit's label
        peers = [];
        s2.labelExited();
        expect(lines(p)).toHaveLength(2); expect(JSON.parse(lines(p)[1]!).customTitle).toBe('Pim - Sujet');
        expect(lines(q)).toHaveLength(1);
      } finally { await s2.close(); }
    });

    it('a label that cannot be written is logged', async () => {
      const p = join(mkdtempSync(join(tmpdir(), 'ledge-tr-')), 'gone.jsonl');
      store.upsert(mk('a', { name: 'Pim', topic: 'Sujet', transcriptPath: p, state: 'exited', exitedAt: T0 }));
      await until(() => { try { return readFileSync(paths().log, 'utf8').includes('resume label of a not written'); } catch { return false; } });
    });

    it('writes no label while the topic is still the name (a session launched before the change)', async () => {
      const p = transcript();
      store.upsert(mk('a', { name: 'Pim', topic: 'Pim', transcriptPath: p, state: 'exited', exitedAt: T0 }));
      await new Promise(r => setTimeout(r, 50));
      expect(lines(p)).toHaveLength(1);
    });
    it('leaves Codex and hook-only sessions alone', async () => {
      const p = transcript(); const q = transcript();
      store.upsert(mk('c', { tool: 'codex', topic: 'Sujet', transcriptPath: p, state: 'exited', exitedAt: T0 }));
      store.upsert(mk('h', { source: 'hook_only', topic: 'Sujet', transcriptPath: q, state: 'exited', exitedAt: T0 }));
      await new Promise(r => setTimeout(r, 50));
      expect(lines(p)).toHaveLength(1); expect(lines(q)).toHaveLength(1);
    });
  });

  it('register re-picks a name already held by another live session and broadcasts the stored one', async () => {
    store.upsert(mk('a', { name: 'Otto' }));
    store.upsert(mk('x', { name: 'Pim', state: 'exited' }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.register', session: mk('b', { name: 'Otto', title: 'Otto · harness-assistant' }) });
    const upd = await c.next('session.updated');
    expect(upd.session.id).toBe('b');
    // An ended session no longer holds its name (namesInUse): only the live Otto is skipped.
    expect(upd.session.name).toBe('Pim');
    expect(upd.session.title).toBe('Pim · harness-assistant');
    expect(store.get('b')?.name).toBe('Pim');
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

  it('a decide from a local front is applied as Decided by the PC', async () => {
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }));
    const applied: SessionEvent[] = [];
    const apply = store.apply.bind(store);
    store.apply = (id, ev) => { applied.push(ev); return apply(id, ev); };
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    await c.next('session.updated', 3000);
    expect(applied.find(e => e.name === 'Decided')).toMatchObject({ decision: 'accept', by: { kind: 'pc' } });
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
    expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: 'the terminal did not take it', request: 'session.decide', code: 'not_taken' });
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
    expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: 'the terminal did not take it', request: 'session.decide', code: 'not_taken' });
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

  it('decide always on a Bash permission types the "always allow" option and lands as always in the thread', async () => {
    const pane = fx('claude2-permission-bash');
    tmux = fakeTmux({ 'ledge-a': [pane, pane, 'Running…'] }); await srv.close();
    const history = new History({ dir: tmpDir() }); srv = await startServer({ store, tmux, port: 0, history });
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'mkdir zz-ledge-probe', tool: 'Bash', source: 'hook' } }));
    store.apply('a', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'mkdir zz-ledge-probe' });
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'always' });
    expect((await c.next('session.thread.item', 3000)).item).toMatchObject({ kind: 'permission', decision: 'always' });
    expect(tmux.sent).toEqual([['text', 'ledge-a', '2']]);
    c.close();
  });
  it('#302 Codex: a PermissionRequest the automatic review settles leaves no permission row; one its terminal shows gets its row', async () => {
    await srv.close();
    const history = new History({ dir: tmpDir() }); srv = await startServer({ store, tmux, port: 0, history });
    const perms = (id: string) => history.items(id).filter(i => i.kind === 'permission');
    // « Approve for me » approved: the hook, then the tool ran.
    store.upsert(mk('a', { tool: 'codex', state: 'working' }));
    store.apply('a', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'touch /x' });
    expect(store.get('a')!.state).toBe('working');
    store.apply('a', { name: 'PostToolUse', at: T0, source: 'hook', tool: 'Bash', text: 'touch /x' });
    // It refused: the hook, then only the end of the turn.
    store.apply('a', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'curl x | sh' });
    store.apply('a', { name: 'Stop', at: T0, source: 'hook' });
    expect(perms('a')).toEqual([]);
    // Ask for approval: the hook, then the dialog in the terminal: the row, with the hook's tool and text.
    store.upsert(mk('b', { tool: 'codex', state: 'working' }));
    store.apply('b', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'touch /y' });
    store.apply('b', { name: 'PanePrompt', at: T0, source: 'pane', kind: 'permission', text: 'touch /y', options: ['Yes, proceed (y)', 'No (esc)'] });
    expect(store.get('b')!.state).toBe('waiting_permission');
    expect(perms('b')).toEqual([expect.objectContaining({ kind: 'permission', tool: 'Bash', text: 'touch /y' })]);
    // The terminal read first, the hook after: the row at once.
    store.upsert(mk('c', { tool: 'codex', state: 'working' }));
    store.apply('c', { name: 'PanePrompt', at: T0, source: 'pane', kind: 'permission', text: 'touch /z', options: ['Yes, proceed (y)', 'No (esc)'] });
    store.apply('c', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'touch /z' });
    expect(perms('c')).toEqual([expect.objectContaining({ tool: 'Bash', text: 'touch /z' })]);
    // Claude Code: unchanged, its row at once.
    store.upsert(mk('d', { state: 'working' }));
    store.apply('d', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'ls' });
    expect(perms('d')).toHaveLength(1);
    // A helper's tool, or another parallel call, ending before the dialog shows does not settle the main agent's request.
    store.upsert(mk('e', { tool: 'codex', state: 'working' }));
    store.apply('e', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'touch /main' });
    store.apply('e', { name: 'PostToolUse', at: T0, source: 'hook', tool: 'Read', helperId: 'h1' });
    store.apply('e', { name: 'Stop', at: T0, source: 'hook', helperId: 'h1' });
    store.apply('e', { name: 'PostToolUse', at: T0, source: 'hook', tool: 'Read' });
    store.apply('e', { name: 'PanePrompt', at: T0, source: 'pane', kind: 'permission', text: 'touch /main', options: ['Yes, proceed (y)', 'No (esc)'] });
    expect(store.get('e')).toMatchObject({ state: 'waiting_permission', pending: { source: 'hook', tool: 'Bash', text: 'touch /main' } });
    expect(perms('e')).toEqual([expect.objectContaining({ tool: 'Bash', text: 'touch /main' })]);
    // Its terminal cannot be captured while a request is held: the request waits now, its row with it.
    store.upsert(mk('g', { tool: 'codex', state: 'working' }));
    store.apply('g', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'touch /g' });
    store.apply('g', { name: 'PaneUnreadable', at: T0, source: 'daemon' });
    expect(store.get('g')!.state).toBe('waiting_permission');
    expect(perms('g')).toEqual([expect.objectContaining({ tool: 'Bash', text: 'touch /g' })]);
    // Two calls of the same tool at once: the other call's end does not settle this one's request.
    store.upsert(mk('h', { tool: 'codex', state: 'working' }));
    store.apply('h', { name: 'PreToolUse', at: T0, source: 'hook', tool: 'Bash', text: 'touch /main', toolUseId: 'main-call' });
    store.apply('h', { name: 'PreToolUse', at: T0, source: 'hook', tool: 'Bash', text: 'ls', toolUseId: 'other-call' });
    store.apply('h', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'touch /main' });
    expect(store.get('h')!.codexAskCall).toBe('main-call');
    store.apply('h', { name: 'PostToolUse', at: T0, source: 'hook', tool: 'Bash', toolUseId: 'other-call' });
    store.apply('h', { name: 'PanePrompt', at: T0, source: 'pane', kind: 'permission', text: 'touch /main', options: ['Yes, proceed (y)', 'No (esc)'] });
    expect(store.get('h')!.pending).toMatchObject({ source: 'hook', text: 'touch /main' });
    expect(perms('h')).toEqual([expect.objectContaining({ tool: 'Bash', text: 'touch /main' })]);
    // Its own call's end does.
    store.upsert(mk('i', { tool: 'codex', state: 'working' }));
    store.apply('i', { name: 'PreToolUse', at: T0, source: 'hook', tool: 'Bash', text: 'touch /i', toolUseId: 'c1' });
    store.apply('i', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'touch /i' });
    store.apply('i', { name: 'PostToolUse', at: T0, source: 'hook', tool: 'Bash', toolUseId: 'c1' });
    expect(store.get('i')!.codexAsk).toBeUndefined();
    expect(perms('i')).toEqual([]);
    // A session Ledge only hears through hooks (no terminal to read): its request waits at once, as before.
    store.upsert(mk('f', { tool: 'codex', state: 'working', tmuxSession: null, source: 'hook_only' }));
    store.apply('f', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'touch /f' });
    expect(store.get('f')!.state).toBe('waiting_permission');
    expect(perms('f')).toHaveLength(1);
  });
  it('a sent message becomes the session\'s last message, once, when it lands', async () => {
    await srv.close();
    const history = new History({ dir: tmpDir() }); srv = await startServer({ store, tmux, port: 0, history });
    store.upsert(mk('a'));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    store.apply('a', { name: 'PreToolUse', at: T0, source: 'hook', tool: 'SendMessage', toolUseId: 'toolu_1', toolInput: { to: 'a-bf', summary: 'OK for Nova', message: 'Long text' } });
    const lastOf = async () => { for (;;) { const m = await c.next('session.updated', 3000); if (m.session.lastMessage) return m.session.lastMessage; } };
    expect(await lastOf()).toMatchObject({ id: 'toolu_1', to: 'a-bf', summary: 'OK for Nova', at: T0 });
    store.apply('a', { name: 'PostToolUse', at: '2026-10-09T18:00:05.000Z', source: 'hook', tool: 'SendMessage', toolUseId: 'toolu_1' });
    expect(store.get('a')!.lastMessage!.at).toBe(T0);
    store.apply('a', { name: 'PreToolUse', at: '2026-10-09T18:00:09.000Z', source: 'hook', tool: 'SendMessage', toolUseId: 'toolu_2', toolInput: { to: 'a-bf', message: 'Première ligne\nSuite' } });
    expect(store.get('a')!.lastMessage).toMatchObject({ id: 'toolu_2', summary: 'Première ligne' });
    c.close();
  });
  it('a result that lands before its call still sets the last message, at from that item', async () => {
    await srv.close();
    const history = new History({ dir: tmpDir() }); srv = await startServer({ store, tmux, port: 0, history });
    store.upsert(mk('a'));
    store.apply('a', { name: 'PostToolUse', at: T0, source: 'hook', tool: 'SendMessage', toolUseId: 'toolu_1', toolInput: { to: 'a-bf', message: 'Vite' } });
    expect(store.get('a')!.lastMessage).toMatchObject({ id: 'toolu_1', summary: 'Vite', at: T0 });
  });
  it('an older sent message turning read does not replace a newer last message', async () => {
    await srv.close();
    const history = new History({ dir: tmpDir(), peerOf: t => ({ 'a-bf': 'b', 'a-2d': 'a' } as Record<string, string>)[t] }); srv = await startServer({ store, tmux, port: 0, history });
    store.upsert(mk('a')); store.upsert(mk('b'));
    store.apply('a', { name: 'PreToolUse', at: T0, source: 'hook', tool: 'SendMessage', toolUseId: 'toolu_1', toolInput: { to: 'a-bf', message: 'Un' } });
    store.apply('a', { name: 'PreToolUse', at: '2026-10-09T18:00:02.000Z', source: 'hook', tool: 'SendMessage', toolUseId: 'toolu_2', toolInput: { to: 'a-bf', message: 'Deux' } });
    store.apply('b', { name: 'UserPromptSubmit', at: '2026-10-09T18:00:04.000Z', source: 'hook', text: '<cross-session-message from="x" from-name="a-2d">\nUn\n</cross-session-message>' });
    expect(history.items('a')[0]).toMatchObject({ id: 'toolu_1', status: 'read' });
    expect(store.get('a')!.lastMessage).toMatchObject({ id: 'toolu_2', summary: 'Deux' });
  });
  it('parallel sends: a late result of the older call never takes the last message back', async () => {
    await srv.close();
    const history = new History({ dir: tmpDir() }); srv = await startServer({ store, tmux, port: 0, history });
    store.upsert(mk('a'));
    const T1 = '2026-10-09T18:00:02.000Z';
    const call = (name: 'PreToolUse' | 'PostToolUse', at: string, id: string) => store.apply('a', { name, at, source: 'hook', tool: 'SendMessage', toolUseId: id, toolInput: { to: 'a-bf', message: id } });
    call('PreToolUse', T0, 'toolu_1'); call('PreToolUse', T1, 'toolu_2'); call('PostToolUse', '2026-10-09T18:00:03.000Z', 'toolu_2'); call('PostToolUse', '2026-10-09T18:00:04.000Z', 'toolu_1');
    expect(store.get('a')!.lastMessage).toMatchObject({ id: 'toolu_2', at: T1 });
  });
  it('a failed send never becomes the last message', async () => {
    await srv.close();
    const history = new History({ dir: tmpDir() }); srv = await startServer({ store, tmux, port: 0, history });
    store.upsert(mk('a'));
    store.apply('a', { name: 'PostToolUseFailure', at: T0, source: 'hook', tool: 'SendMessage', toolUseId: 'toolu_1', toolInput: { to: 'a-bf', message: 'Raté' }, error: 'no such peer' });
    expect(history.items('a')[0]).toMatchObject({ kind: 'sent', status: 'failed' });
    expect(store.get('a')!.lastMessage).toBeUndefined();
  });
  it('a decision from Ledge settles only its own permission, never an older one answered in the terminal', async () => {
    const pane = fx('claude2-permission-bash');
    tmux = fakeTmux({ 'ledge-a': [pane, pane, 'Running…'] }); await srv.close();
    const history = new History({ dir: tmpDir() }); srv = await startServer({ store, tmux, port: 0, history });
    history.record('a', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'ls' });
    // `ls` was answered in the terminal: never decided here.
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'mkdir zz-ledge-probe', tool: 'Bash', source: 'hook' } }));
    store.apply('a', { name: 'PermissionRequest', at: '2026-10-09T18:00:05.000Z', source: 'hook', tool: 'Bash', text: 'mkdir zz-ledge-probe' });
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'always' });
    expect((await c.next('session.thread.item', 3000)).item).toMatchObject({ text: 'mkdir zz-ledge-probe', decision: 'always' });
    await expect(c.next('session.thread.item', 300)).rejects.toThrow(/timeout/);
    expect(history.items('a').map(i => i.kind === 'permission' && [i.text, i.decision])).toEqual([['ls', undefined], ['mkdir zz-ledge-probe', 'always']]);
    c.close();
  });
  it('an answer the harness does not offer is refused before any key, and the refusal names its request', async () => {
    store.upsert(mk('a', { tool: 'cursor', state: 'waiting_permission', pending: { kind: 'permission', text: 'echo hi', source: 'pane' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'always' });
    expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: 'this answer is not offered for this request, answer in the terminal', request: 'session.decide', code: 'not_offered' });
    c.send({ type: 'session.decide', id: 'a', decision: 'accept', note: 'why' });
    expect((await c.next('error', 3000)).message).toBe('this answer is not offered for this request, answer in the terminal');
    expect(tmux.sent).toEqual([]);
    c.close();
  });
  it('a decision for a request that changed is refused before any key; the request it saw lets it through; none keeps today', async () => {
    const plan = fx('claude2-plan');
    tmux = fakeTmux({ 'ledge-a': [plan, plan, 'Running…'] }); await srv.close();
    srv = await startServer({ store, tmux, port: 0 });
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'plan', text: '# Plan', source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    // The user saw a Bash permission; the plan dialog is up now: « always » would type « Yes, and use auto mode ».
    c.send({ type: 'session.decide', id: 'a', decision: 'always', expect: { kind: 'permission', text: 'npm test' } });
    expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: 'the request changed, look again', request: 'session.decide', code: 'stale' });
    c.send({ type: 'session.decide', id: 'a', decision: 'accept', expect: { kind: 'plan', text: '# Plan, v2' } });
    expect((await c.next('error', 3000)).message).toBe('the request changed, look again');
    expect(tmux.sent).toEqual([]);
    c.send({ type: 'session.decide', id: 'a', decision: 'accept', expect: { kind: 'plan', text: '# Plan' } });
    expect((await c.next('session.updated', 3000)).session.state).toBe('working');
    expect(tmux.sent).toEqual([['text', 'ledge-a', '2']]);
    // No request left: a decision that saw one is stale, not « nothing to decide ».
    c.send({ type: 'session.decide', id: 'a', decision: 'accept', expect: { kind: 'plan', text: '# Plan' } });
    expect((await c.next('error', 3000)).message).toBe('the request changed, look again');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    expect((await c.next('error', 3000)).message).toBe('nothing to decide');
    expect(tmux.sent).toEqual([['text', 'ledge-a', '2']]);
    c.close();
  });
  it('a request that changes while the terminal is read gets no key: the decision is stale', async () => {
    const realCapture = tmux.capture;
    // The capture that looks for the prompt is when the agent swaps the request the user saw for another.
    tmux.capture = async (n, l) => {
      store.apply('a', { name: 'PermissionRequest', at: '2026-10-09T18:00:09.000Z', source: 'hook', tool: 'Bash', text: 'rm -rf dist' });
      tmux.capture = realCapture;
      return realCapture(n, l);
    };
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept', expect: { kind: 'permission', text: 'npm test' } });
    expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: 'the request changed, look again', request: 'session.decide', code: 'stale' });
    expect(tmux.sent).toEqual([]);
    expect(store.get('a')).toMatchObject({ state: 'waiting_permission', pending: { text: 'rm -rf dist' } });
    c.close();
  });
  it('a plan whose content changes under the same label gets no key, at the click or while the terminal is read', async () => {
    const plan = fx('claude2-plan');
    tmux = fakeTmux({ 'ledge-a': [plan, plan, 'Running…'] }); await srv.close();
    srv = await startServer({ store, tmux, port: 0 });
    const seen = { kind: 'plan' as const, text: 'Implement this plan?', body: '1. Add tests', source: 'hook' as const };
    store.upsert(mk('a', { state: 'waiting_permission', pending: { ...seen, body: '1. Delete the tests' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    // Same label, another plan: the key the front computed on the plan it showed tells them apart.
    c.send({ type: 'session.decide', id: 'a', decision: 'accept', expect: { kind: 'plan', text: seen.text, key: pendingKey(seen) } });
    expect((await c.next('error', 3000)).message).toBe('the request changed, look again');
    expect(tmux.sent).toEqual([]);
    // The plan the user saw is pending; it is rewritten while the terminal is read.
    store.upsert(mk('a', { state: 'waiting_permission', pending: seen }));
    const realCapture = tmux.capture;
    tmux.capture = async (n, l) => {
      store.upsert(mk('a', { state: 'waiting_permission', pending: { ...seen, body: '1. Delete the tests' } }));
      tmux.capture = realCapture;
      return realCapture(n, l);
    };
    c.send({ type: 'session.decide', id: 'a', decision: 'accept', expect: { kind: 'plan', text: seen.text, key: pendingKey(seen) } });
    expect((await c.next('error', 3000)).message).toBe('the request changed, look again');
    expect(tmux.sent).toEqual([]);
    c.close();
  });
  it('another command already on screen, its hook not come yet, gets no key though the request is the one seen', async () => {
    const pane = fx('claude2-permission-bash');
    tmux = fakeTmux({ 'ledge-a': [pane, pane, 'Running…'] }); await srv.close();
    srv = await startServer({ store, tmux, port: 0 });
    const seen = { kind: 'permission' as const, text: 'pnpm test', tool: 'Bash', source: 'hook' as const };
    store.upsert(mk('a', { state: 'waiting_permission', pending: seen }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    // The terminal asks for `mkdir zz-ledge-probe`; the daemon still holds `pnpm test`, the request the user approves.
    c.send({ type: 'session.decide', id: 'a', decision: 'accept', expect: { kind: 'permission', text: 'pnpm test', key: pendingKey(seen) } });
    expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: 'the request changed, look again', request: 'session.decide', code: 'stale' });
    expect(tmux.sent).toEqual([]);
    expect(store.get('a')).toMatchObject({ state: 'waiting_permission', pending: { text: 'pnpm test' } });
    c.close();
  });
  describe('Claude Code 2.1.318: the command behind a gutter (« the request changed » on a request still on screen)', () => {
    const one = `D=/tmp; ls -la $D | head -3; echo ---; python3 -c "import json;print(json.dumps({\\"a\\":1},indent=1))" | head -150`;
    const seen = { kind: 'permission' as const, text: one, tool: 'Bash', source: 'hook' as const };
    /** A transcript its Claude Code wrote last (`version` on each entry), or one with no version. */
    const transcript = (version?: string) => {
      const p = join(tmpDir(), 'session.jsonl');
      writeFileSync(p, `${JSON.stringify({ type: 'user', ...(version ? { version } : {}) })}\n`);
      return p;
    };
    const v318 = transcript('2.1.318');
    const start = async (panes: string[]) => {
      tmux = fakeTmux({ 'ledge-a': panes }); await srv.close();
      srv = await startServer({ store, tmux, port: 0 });
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      return c;
    };
    it('the request on screen, unchanged, is approved or refused from Ledge', async () => {
      const pane = fx('claude2-318-permission-bash');
      for (const [decision, keys] of [['accept', ['text', 'ledge-a', '1']], ['deny', ['keys', 'ledge-a', 'Escape']]] as const) {
        const c = await start([pane, pane, 'Running…']);
        store.upsert(mk('a', { state: 'waiting_permission', pending: seen, transcriptPath: v318 }));
        c.send({ type: 'session.decide', id: 'a', decision, expect: { kind: 'permission', text: one, key: pendingKey(seen) } });
        await until(() => tmux.sent.length > 0);
        expect(tmux.sent).toEqual([keys]);
        c.close();
      }
    });
    it('always on a dialog whose only lasting option is auto mode: refused, no key (never « switch to auto mode »)', async () => {
      const pane = fx('claude2-318-permission-bash');
      const c = await start([pane, pane, 'Running…']);
      store.upsert(mk('a', { state: 'waiting_permission', pending: seen, transcriptPath: v318 }));
      c.send({ type: 'session.decide', id: 'a', decision: 'always', expect: { kind: 'permission', text: one, key: pendingKey(seen) } });
      expect(await c.next('error', 3000)).toMatchObject({ id: 'a', code: 'not_offered', message: 'no "always" option in this dialog, answer in the terminal' });
      expect(tmux.sent).toEqual([]);
      expect(store.get('a')).toMatchObject({ state: 'waiting_permission', pending: { text: one } });
      c.close();
    });
    it('the version not known, or older than the gutter: the same screen gets no key (`│` may be the command\'s own)', async () => {
      const pane = fx('claude2-318-permission-bash');
      for (const [path, code] of [[undefined, 'no_prompt'], [transcript(), 'no_prompt'], [transcript('2.1.317'), 'stale']] as const) {
        const c = await start([pane, pane, 'Running…']);
        store.upsert(mk('a', { state: 'waiting_permission', pending: seen, ...(path ? { transcriptPath: path } : {}) }));
        c.send({ type: 'session.decide', id: 'a', decision: 'accept', expect: { kind: 'permission', text: one, key: pendingKey(seen) } });
        expect(await c.next('error', 3000)).toMatchObject({ id: 'a', code });
        expect(tmux.sent).toEqual([]);
        c.close();
      }
    });
    it('the same text but another request (its key differs): refused before any key', async () => {
      const pane = fx('claude2-318-permission-bash');
      const c = await start([pane, pane, 'Running…']);
      // A helper's request for the same command replaced the one the user saw: it looks the same on the card.
      store.upsert(mk('a', { state: 'waiting_permission', pending: { ...seen, helperId: 'h1' }, transcriptPath: v318 }));
      c.send({ type: 'session.decide', id: 'a', decision: 'accept', expect: { kind: 'permission', text: one, key: pendingKey(seen) } });
      expect(await c.next('error', 3000)).toMatchObject({ id: 'a', code: 'stale' });
      expect(tmux.sent).toEqual([]);
      c.close();
    });
    it('answered in the terminal first, then a new request: Ledge types nothing, the new request is the one held', async () => {
      const next = { ...seen, text: 'rm -rf build' };
      const c = await start([bashPrompt('rm -rf build')]);
      store.upsert(mk('a', { state: 'waiting_permission', pending: next, transcriptPath: v318 }));
      c.send({ type: 'session.decide', id: 'a', decision: 'accept', expect: { kind: 'permission', text: one, key: pendingKey(seen) } });
      expect(await c.next('error', 3000)).toMatchObject({ id: 'a', code: 'stale' });
      // Nor when the client sends no expectation: the dialog on screen is not the request the daemon holds.
      store.upsert(mk('a', { state: 'waiting_permission', pending: seen, transcriptPath: v318 }));
      c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
      expect(await c.next('error', 3000)).toMatchObject({ id: 'a', code: 'stale' });
      expect(tmux.sent).toEqual([]);
      c.close();
    });
  });
  it('a dialog taller than the capture is read whole before any key, or gets none', async () => {
    const command = ['cat > notes.txt <<EOF', ...Array.from({ length: 70 }, (_, i) => `line ${i}`), 'EOF'].join('\n');
    const tall = bashPrompt(command);
    let pane = tall; let deepest = Infinity;
    tmux = fakeTmux({}); await srv.close();
    // The capture reads the last `lines` lines of the pane, no more than tmux keeps (`deepest`).
    tmux.capture = async (_n, lines) => pane.split('\n').slice(-Math.min(lines, deepest)).join('\n');
    tmux.sendText = async (n, t) => { tmux.sent.push(['text', n, t]); pane = 'Running…'; };
    tmux.sendKeys = async (n, k) => { tmux.sent.push(['keys', n, ...k]); pane = 'Running…'; };
    tmux.width = async () => 80;
    srv = await startServer({ store, tmux, port: 0 });
    const pending = { kind: 'permission' as const, text: command, tool: 'Bash', source: 'hook' as const };
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    // Its top out of every capture: the command on screen cannot be checked, nothing is typed.
    deepest = 60;
    store.upsert(mk('a', { state: 'waiting_permission', pending }));
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    expect((await c.next('error', 3000)).message).toBe('the request on screen cannot be checked, answer in the terminal');
    expect(tmux.sent).toEqual([]);
    // Read whole, it is another command than the one approved.
    deepest = Infinity;
    store.upsert(mk('a', { state: 'waiting_permission', pending: { ...pending, text: command.replace('line 3\n', 'line 3 ') } }));
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    expect((await c.next('error', 3000)).message).toBe('the request changed, look again');
    expect(tmux.sent).toEqual([]);
    // Read whole, it is the one approved.
    store.upsert(mk('a', { state: 'waiting_permission', pending }));
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    await until(() => store.get('a')?.state === 'working', 3000);
    expect(tmux.sent).toEqual([['text', 'ledge-a', '1']]);
    c.close();
  });
  it('a note on a question is refused for every harness, and a reply refusal names session.reply', async () => {
    store.upsert(mk('a', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'deny', note: 'Neither' });
    expect(await c.next('error', 3000)).toMatchObject({ message: 'this answer is not offered for this request, answer in the terminal', request: 'session.decide' });
    c.send({ type: 'session.reply', id: 'a', text: '   ' });
    expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: 'empty reply', request: 'session.reply', code: 'invalid' });
    expect(tmux.sent).toEqual([]);
    c.close();
  });
  it('a slash command that opens a terminal panel, or ends the session, is refused before any key', async () => {
    store.upsert(mk('a', { state: 'idle' }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.reply', id: 'a', text: '/model' });
    expect(await c.next('error', 3000)).toMatchObject({ id: 'a', request: 'session.reply', code: 'not_offered', message: expect.stringMatching(/^\/model without arguments opens a panel/) });
    c.send({ type: 'session.reply', id: 'a', text: '/exit' });
    expect(await c.next('error', 3000)).toMatchObject({ code: 'not_offered', message: expect.stringMatching(/close it from Ledge/) });
    expect(tmux.sent).toEqual([]);
    c.close();
  });
  it('session.commands answers with the agent\'s commands in the session\'s folder, or why there are none', async () => {
    const asked: string[] = [];
    await srv.close();
    srv = await startServer({ store, tmux, port: 0, commands: { list: async (tool, cwd) => { asked.push(`${tool} ${cwd}`); return { commands: [{ name: 'compact', source: 'builtin' }] }; } } });
    const dir = mkdtempSync(join(tmpdir(), 'ledge-commands-'));
    store.upsert(mk('a', { state: 'idle', cwd: dir })); store.upsert(mk('b', { state: 'idle', cwd: join(dir, 'gone') }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.commands', requestId: 'r1', id: 'a' });
    expect(await c.next('session.commands.listing', 3000)).toEqual({ type: 'session.commands.listing', requestId: 'r1', id: 'a', tool: 'claude', commands: [{ name: 'compact', source: 'builtin' }] });
    expect(asked).toEqual([`claude ${dir}`]);
    c.send({ type: 'session.commands', requestId: 'r2', id: 'b' });
    expect(await c.next('session.commands.listing', 3000)).toMatchObject({ requestId: 'r2', commands: [], error: 'folder not found' });
    c.send({ type: 'session.commands', requestId: 'r3', id: 'nope' });
    expect(await c.next('session.commands.listing', 3000)).toMatchObject({ requestId: 'r3', commands: [], error: 'unknown session' });
    c.close();
  });
  it('deny with a note: Escape, the note once the input is back, Enter; the thread says denied', async () => {
    const pane = fx('claude2-permission-bash'); const rest = fx('claude2-rest-after-deny');
    tmux = fakeTmux({ 'ledge-a': [pane, rest, rest] }); await srv.close();
    const history = new History({ dir: tmpDir() }); srv = await startServer({ store, tmux, port: 0, history });
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'mkdir zz-ledge-probe', tool: 'Bash', source: 'hook' } }));
    store.apply('a', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'mkdir zz-ledge-probe' });
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'deny', note: 'Use\npnpm' });
    expect((await c.next('session.thread.item', 3000)).item).toMatchObject({ kind: 'permission', decision: 'deny' });
    expect(tmux.sent).toEqual([['keys', 'ledge-a', 'Escape'], ['keys', 'ledge-a', 'C-u'], ['text', 'ledge-a', 'Use pnpm'], ['keys', 'ledge-a', 'Enter']]);
    c.close();
  });

  describe('session.message', () => {
    const line = 'Salut';
    it('task.cmd gives a task and the owner gets its pointer typed', async () => {
      tmux = fakeTmux({ 'ledge-b': [fx('codex-idle-after-turn')] }); await srv.close();
      srv = await startServer({ store, tmux, port: 0 });
      store.upsert(mk('a')); store.upsert(mk('b', { name: 'Pim', tool: 'codex', state: 'idle' }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'task.cmd', rid: 't-r1', by: 'a', key: sessionKey('a'), op: 'give', to: 'Pim', title: 'Lance les tests' });
      const r = await c.next('task.result', 3000);
      expect(r.task).toMatchObject({ owner: 'b', state: 'open', title: 'Lance les tests' });
      await until(() => tmux.sent.some(x => x[0] === 'keys' && x[2] === 'Enter'), 3000);
      expect(tmux.sent[0]).toEqual(['text', 'ledge-b', expect.stringContaining(`<ledge-task id="${r.task!.id}" from="Otto">Tâche de Otto : « Lance les tests »`)]);
      c.send({ type: 'task.cmd', rid: 't-r2', by: 'b', op: 'list' });
      expect((await c.next('task.result', 3000)).tasks!.map(t => t.id)).toEqual([r.task!.id]);
      c.close();
    });
    it('a task given between two sessions reaches the fronts with its transmission, and Ledge lists it (#92)', async () => {
      store.upsert(mk('a')); store.upsert(mk('b', { name: 'Pim', tool: 'codex', state: 'idle' }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'task.cmd', rid: 't-r1', by: 'a', key: sessionKey('a'), op: 'give', to: 'Pim', title: 'Lance les tests' });
      const { task } = await c.next('task.updated', 3000);
      await c.next('task.result', 3000);
      expect(task).toMatchObject({ giver: 'a', owner: 'b' });
      expect(task.log.at(-1)).toMatchObject({ op: 'give', from: 'a', to: 'b', fromName: 'Otto', toName: 'Pim' });
      c.send({ type: 'task.cmd', rid: 't-r2', by: 'ledge', op: 'list' });
      expect((await c.next('task.result', 3000)).tasks!.map(t => t.id)).toEqual([task.id]);
      c.close();
    });
    it('the sender’s thread gets the card of the task it handed over; Ledge’s give and seen add none (#92)', async () => {
      await srv.close();
      const card = ledgeCard(); const history = new History({ dir: tmpDir() }); srv = await startServer({ store, tmux, port: 0, history, chat: card.chat });
      store.upsert(mk('a')); store.upsert(mk('b', { name: 'Pim', tool: 'codex', state: 'idle' }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'task.cmd', rid: 'g1', by: 'a', key: sessionKey('a'), op: 'give', to: 'Pim', title: 'Lance les tests' });
      const given = (await c.next('task.result', 3000)).task!;
      expect(history.items('a')).toEqual([expect.objectContaining({ kind: 'notice', id: `task-${given.id}-0`, taskOp: 'give', outgoing: true, name: 'Pim', peer: 'b' })]);
      card.give(c, 'g2', { to: 'Pim', title: 'Relis' });
      const mine = (await c.next('task.result', 3000)).task!;
      c.send({ type: 'task.cmd', rid: 'd', by: 'b', key: sessionKey('b'), op: 'done', task: mine.id, text: 'ok' });
      await c.next('task.result', 3000);
      const outgoing = history.items('b').filter(i => i.kind === 'notice' && i.outgoing);
      expect(outgoing).toEqual([expect.objectContaining({ id: `task-${mine.id}-1`, taskOp: 'done', name: 'Ledge', summary: 'Relis\nok' })]);
      expect(outgoing[0]).not.toHaveProperty('peer');
      const before = [history.items('a').length, history.items('b').length];
      c.send({ type: 'task.cmd', rid: 's', by: 'ledge', op: 'seen', task: mine.id });
      expect((await c.next('task.result', 3000)).task).toMatchObject({ seen: true });
      expect([history.items('a').length, history.items('b').length]).toEqual(before);
      c.close();
    });
    it('the giver’s thread gets the card of the task it cancelled, as of the one it refused (#92)', async () => {
      await srv.close();
      const history = new History({ dir: tmpDir() }); srv = await startServer({ store, tmux, port: 0, history });
      store.upsert(mk('a')); store.upsert(mk('b', { name: 'Pim', tool: 'codex', state: 'idle' }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'task.cmd', rid: 'g1', by: 'a', key: sessionKey('a'), op: 'give', to: 'Pim', title: 'A' });
      const a = (await c.next('task.result', 3000)).task!;
      c.send({ type: 'task.cmd', rid: 'g2', by: 'a', key: sessionKey('a'), op: 'give', to: 'Pim', title: 'B' });
      const b = (await c.next('task.result', 3000)).task!;
      c.send({ type: 'task.cmd', rid: 'r', by: 'a', key: sessionKey('a'), op: 'refuse', task: a.id, text: 'plus besoin' });
      await c.next('task.result', 3000);
      c.send({ type: 'task.cmd', rid: 'x', by: 'a', key: sessionKey('a'), op: 'cancel', task: b.id, text: 'plus besoin' });
      await c.next('task.result', 3000);
      const cancels = history.items('a').filter(i => i.kind === 'notice' && i.taskOp === 'cancel');
      expect(cancels.map(i => i.id)).toEqual([`task-${a.id}-1`, `task-${b.id}-1`]);
      c.close();
    });
    it('a task a session gave, cancelled by Ledge, reaches its giver’s thread; one Ledge gave reaches no thread (#92)', async () => {
      await srv.close();
      const card = ledgeCard(); const history = new History({ dir: tmpDir() }); srv = await startServer({ store, tmux, port: 0, history, chat: card.chat });
      store.upsert(mk('a')); store.upsert(mk('b', { name: 'Pim', tool: 'codex', state: 'idle' }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'task.cmd', rid: 'g1', by: 'a', key: sessionKey('a'), op: 'give', to: 'Pim', title: 'A' });
      const a = (await c.next('task.result', 3000)).task!;
      // Ledge cancels over a session's head only as the user's action (the chat's card, action.run), never as a client's task.cmd.
      const cancel = async (task: string) => {
        c.send({ type: 'action.run', rid: `x-${task}`, action: 'task.cancel', args: { task }, confirmed: true } as never);
        expect((await c.next('action.result', 3000)).reason).toBeUndefined();
        c.send({ type: 'task.cmd', rid: `s-${task}`, by: 'ledge', op: 'show', task });
        return (await c.next('task.result', 3000)).task!;
      };
      expect((await cancel(a.id)).log.at(-1)).toMatchObject({ by: 'Ledge', op: 'cancel', from: 'a', to: 'b' });
      expect(history.items('a').filter(i => i.kind === 'notice' && i.taskOp === 'cancel')).toEqual([expect.objectContaining({ id: `task-${a.id}-1`, outgoing: true, name: 'Pim', peer: 'b' })]);
      card.give(c, 'g2', { to: 'Pim', title: 'B' });
      const b = (await c.next('task.result', 3000)).task!;
      const before = [history.items('a').length, history.items('b').length];
      expect((await cancel(b.id)).log.at(-1)).toMatchObject({ op: 'cancel', from: 'ledge', to: 'b' });
      expect([history.items('a').length, history.items('b').length]).toEqual(before);
      c.close();
    });
    it('message.read gives a long body whole to its receiver, and refuses anyone else', async () => {
      store.upsert(mk('a')); store.upsert(mk('b', { name: 'Pim', tool: 'codex', state: 'working' }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      const long = 'ligne\n'.repeat(30);
      c.send({ type: 'session.message', rid: 'r-long', from: 'a', to: 'Pim', text: long });
      expect(await c.next('message.ack', 3000)).toMatchObject({ outcome: 'queued' });
      const id = mailId('r-long');
      c.send({ type: 'message.read', id, by: 'b' });
      expect(await c.next('message.body', 3000)).toMatchObject({ id, from: 'Otto', to: 'Pim', text: long });
      c.send({ type: 'message.read', id, by: 'z' });
      expect(await c.next('message.body', 3000)).toMatchObject({ id, reason: expect.stringContaining("ne t'est pas adressé") });
      c.close();
    });
    it('to a free Codex is acked accepted and typed', async () => {
      tmux = fakeTmux({ 'ledge-b': [fx('codex-idle-after-turn')] }); await srv.close();
      srv = await startServer({ store, tmux, port: 0 });
      store.upsert(mk('a')); store.upsert(mk('b', { name: 'Pim', tool: 'codex', state: 'idle' }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.message', rid: 'r1', from: 'a', to: 'Pim', text: line });
      expect(await c.next('message.ack', 3000)).toEqual({ type: 'message.ack', rid: 'r1', outcome: 'accepted' });
      await until(() => tmux.sent.some(x => x[0] === 'keys' && x[2] === 'Enter'), 3000);
      expect(tmux.sent[0]).toEqual(['text', 'ledge-b', expect.stringMatching(new RegExp(`^<ledge-message from="Otto" tool="claude" id="m[0-9a-f]{6}">\\(message de la session Otto, .*\\) ${line}</ledge-message>$`))]);
      expect(tmux.sent.at(-1)).toEqual(['keys', 'ledge-b', 'Enter']);
      c.close();
    });
    it('intercept to a Claude is native, nothing typed', async () => {
      store.upsert(mk('a')); store.upsert(mk('b', { name: 'Pim', state: 'idle' }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.message', rid: 'r1', from: 'a', to: 'Pim', text: line, intercept: true });
      expect(await c.next('message.ack', 3000)).toEqual({ type: 'message.ack', rid: 'r1', outcome: 'native' });
      expect(tmux.sent).toEqual([]);
      c.close();
    });
    it("the card in the sender's thread goes sending → delivered", async () => {
      tmux = fakeTmux({ 'ledge-b': [fx('codex-idle-after-turn')] }); await srv.close();
      const history = new History({ dir: tmpDir() }); srv = await startServer({ store, tmux, port: 0, history });
      store.upsert(mk('a')); store.upsert(mk('b', { name: 'Pim', tool: 'codex', state: 'idle' }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.message', rid: 'r1', from: 'a', to: 'Pim', text: line });
      expect((await c.next('session.thread.item', 3000)).item).toMatchObject({ kind: 'sent', id: 'r1', to: 'Pim', peer: 'b', status: 'sending' });
      expect((await c.next('session.thread.item', 3000)).item).toMatchObject({ kind: 'sent', id: 'r1', status: 'delivered' });
      c.close();
    });
  });

  describe('deny with a note whose input box does not come back', () => {
    async function denyWithNote(panes: string[]) {
      tmux = fakeTmux({ 'ledge-a': panes }); await srv.close();
      const history = new History({ dir: tmpDir() });
      srv = await startServer({ store, tmux, port: 0, history, untilMs: 300, verify: { attempts: 2, intervalMs: 20 }, confirmMs: 400 });
      store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'mkdir zz-ledge-probe', tool: 'Bash', source: 'hook' } }));
      store.apply('a', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'mkdir zz-ledge-probe' });
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.decide', id: 'a', decision: 'deny', note: 'Use pnpm' });
      return { c, history };
    }
    it('Esc taken, the note not typed: the thread says denied and the refusal has its own code', async () => {
      const { c, history } = await denyWithNote([fx('claude2-permission-bash'), '● Bash(mkdir zz-ledge-probe)\n  ⎿  Interrupted by user']);
      expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: 'denied, but the note could not be typed', request: 'session.decide', code: 'note_not_typed' });
      expect(tmux.sent).toEqual([['keys', 'ledge-a', 'Escape']]);
      expect(history.items('a').at(-1)).toMatchObject({ kind: 'permission', decision: 'deny' });
      expect(store.get('a')).toMatchObject({ state: 'working' });
      expect(store.get('a')?.pending).toBeUndefined();
      c.close();
    });
    it('Esc taken while a newer request came: the code still says the note was not typed, the newer request is left alone', async () => {
      const after = '● Bash(mkdir zz-ledge-probe)\n  ⎿  Interrupted by user';
      tmux = fakeTmux({ 'ledge-a': [fx('claude2-permission-bash'), after] });
      const realCapture = tmux.capture; let captures = 0;
      // While the plan waits for the input box, the agent asks something else.
      tmux.capture = async (n, l) => {
        if (++captures === 3) store.apply('a', { name: 'PermissionRequest', at: '2026-10-09T18:00:09.000Z', source: 'hook', tool: 'Bash', text: 'rm -rf dist' });
        return realCapture(n, l);
      };
      await srv.close();
      const history = new History({ dir: tmpDir() });
      srv = await startServer({ store, tmux, port: 0, history, untilMs: 300, verify: { attempts: 2, intervalMs: 20 } });
      store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'mkdir zz-ledge-probe', tool: 'Bash', source: 'hook' } }));
      store.apply('a', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'mkdir zz-ledge-probe' });
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.decide', id: 'a', decision: 'deny', note: 'Use pnpm' });
      expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: 'denied, but the note could not be typed', request: 'session.decide', code: 'note_not_typed' });
      expect(tmux.sent).toEqual([['keys', 'ledge-a', 'Escape']]);
      expect(store.get('a')).toMatchObject({ state: 'waiting_permission', pending: { text: 'rm -rf dist' } });
      expect(history.items('a').filter(i => i.kind === 'permission').map(i => i.kind === 'permission' && i.decision)).toEqual([undefined, undefined]);
      c.close();
    });
    it('Esc not taken (the dialog stays): nothing was denied, the usual failure', async () => {
      const { c } = await denyWithNote([fx('claude2-permission-bash')]);
      expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: 'the terminal did not take it', request: 'session.decide', code: 'not_taken' });
      expect(tmux.sent).toEqual([['keys', 'ledge-a', 'Escape']]);
      expect(store.get('a')).toMatchObject({ state: 'error', pending: { text: 'mkdir zz-ledge-probe' } });
      c.close();
    });
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
      expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: NO_PROMPT, request: (msg as { type: string }).type, code: 'no_prompt' });
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
      expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: 'the terminal did not take it', request: 'session.decide', code: 'not_taken' });
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

  it('Claude Code: a free-text answer goes through the "Type something." row, typed once that row has the cursor', async () => {
    const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8').replace(/\s+$/, '');
    tmux = fakeTmux({ 'ledge-a': [fx('claude2-question'), fx('claude2-question'), fx('claude2-question-other-focused'), '● Thinking…'] }); await srv.close();
    srv = await startServer({ store, tmux, port: 0, untilMs: 300, verify: { attempts: 2, intervalMs: 20 } });
    store.upsert(mk('a', { tool: 'claude', state: 'waiting_input', pending: { kind: 'question', text: 'Which color do you prefer?', options: ['Red', 'Blue'], source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.reply', id: 'a', text: 'Vert pomme' });
    await vi.waitFor(() => expect(store.get('a')?.state).toBe('working'), { timeout: 2000 });
    expect(tmux.sent).toEqual([['text', 'ledge-a', '3'], ['keys', 'ledge-a', 'C-u'], ['text', 'ledge-a', 'Vert pomme'], ['keys', 'ledge-a', 'Enter']]);
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
    it('the first question of a launched session takes its answer: blank rows and the titled input rule under the dialog (#31)', async () => {
      const c = await answer([fx('claude2-question-fullscreen-gap'), fx('claude2-idle')], { kind: 'question', text: 'Quel est l objectif ?', source: 'pane' });
      await vi.waitFor(() => expect(store.get('a')?.state).toBe('working'), { timeout: 2000 });
      expect(tmux.sent).toEqual([['text', 'ledge-a', '1']]);
      c.close();
    });
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

  describe('Claude Code: a reply confirmed by its PostToolUse or its tool_result, not by the screen (#35)', () => {
    // The dialog stays drawn as it was: read alone, the screen would call every answer not taken.
    const question = { kind: 'question' as const, text: 'Which?', options: ['Red', 'Blue'], source: 'hook' as const };
    const call = (id: string) => JSON.stringify({ type: 'assistant', uuid: 'u1', timestamp: T0, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: {} }] } });
    const result = (id: string) => JSON.stringify({ type: 'user', uuid: 'u2', timestamp: T0, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Your questions have been answered' }] } });
    async function reply(pending: Session['pending'], extra: Partial<Session> = {}) {
      tmux = fakeTmux({ 'ledge-a': [QUESTION] }); await srv.close();
      srv = await startServer({ store, tmux, port: 0, verify: { attempts: 2, intervalMs: 20 }, confirmMs: 400 });
      store.upsert(mk('a', { state: 'waiting_input', pending, ...extra }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.reply', id: 'a', text: '1' });
      await vi.waitFor(() => expect(tmux.sent).toEqual([['text', 'ledge-a', '1']]), { timeout: 2000 });
      return c;
    }
    /** Past the confirmation window: a reply not confirmed by then is an error. */
    const settle = () => new Promise(r => setTimeout(r, 600));
    it('a question is answered once its PostToolUse comes, whatever the screen shows', async () => {
      const c = await reply(question);
      c.send({ type: 'session.event', id: 'a', event: { name: 'PostToolUse', at: T0, source: 'hook', tool: 'AskUserQuestion' } });
      await vi.waitFor(() => expect(store.get('a')?.state).toBe('working'), { timeout: 2000 });
      await settle();
      expect(store.get('a')).toMatchObject({ state: 'working' });
      expect(store.get('a')?.lastError).toBeUndefined();
      c.close();
    });
    it('or once its tool_result is in the transcript', async () => {
      const transcriptPath = join(mkdtempSync(join(tmpdir(), 'ledge-tr-')), 't.jsonl');
      writeFileSync(transcriptPath, call('toolu_1') + '\n');
      const c = await reply(question, { transcriptPath });
      writeFileSync(transcriptPath, [call('toolu_1'), result('toolu_1')].join('\n') + '\n');
      await vi.waitFor(() => expect(store.get('a')?.state).toBe('working'), { timeout: 2000 });
      await settle();
      expect(store.get('a')?.state).toBe('working');
      expect(store.get('a')?.pending).toBeUndefined();
      c.close();
    });
    it('a permission decided from Ledge lands in the thread once its PostToolUse comes', async () => {
      const history = new History({ dir: tmpDir() });
      tmux = fakeTmux({ 'ledge-a': [bashPrompt('mkdir x')] }); await srv.close();
      srv = await startServer({ store, tmux, port: 0, history, verify: { attempts: 2, intervalMs: 20 }, confirmMs: 400 });
      store.upsert(mk('a', { state: 'working' }));
      store.apply('a', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'mkdir x' });
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
      await vi.waitFor(() => expect(tmux.sent.length).toBeGreaterThan(0), { timeout: 2000 });
      c.send({ type: 'session.event', id: 'a', event: { name: 'PostToolUse', at: T0, source: 'hook', tool: 'Bash' } });
      await vi.waitFor(() => expect(history.items('a').find(i => i.kind === 'permission')).toMatchObject({ decision: 'accept' }), { timeout: 2000 });
      await settle();
      expect(store.get('a')?.state).toBe('working');
      c.close();
    });
    it('another tool\'s PostToolUse confirms nothing: not taken, as before', async () => {
      const c = await reply(question);
      c.send({ type: 'session.event', id: 'a', event: { name: 'PostToolUse', at: T0, source: 'hook', tool: 'Read', helperId: 'h1' } });
      await vi.waitFor(() => expect(store.get('a')?.state).toBe('error'), { timeout: 2000 });
      expect(store.get('a')?.lastError).toBe('the terminal did not take it');
      c.close();
    });
    it('a pane request keeps the screen\'s answer: no hook can name it', async () => {
      const c = await reply({ ...question, source: 'pane' });
      await vi.waitFor(() => expect(store.get('a')?.state).toBe('error'), { timeout: 2000 });
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

  it('a reply still in the input box after Enter is one the terminal did not take (#76): an error, never working', async () => {
    const box = (draft: string) => ['● done', '─'.repeat(80), `❯ ${draft}`, '─'.repeat(80), '  ⏵⏵ auto mode on'].join('\n');
    tmux = fakeTmux({ 'ledge-a': [box('[Pasted text #2 +1 lines]')] }); await srv.close(); srv = await startServer({ store, tmux, port: 0, untilMs: 300 });
    store.upsert(mk('a', { state: 'idle' }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.reply', id: 'a', text: 'run the tests' });
    expect(await c.next('error', 3000)).toMatchObject({ id: 'a', message: 'the terminal did not take it', code: 'not_taken' });
    expect(store.get('a')?.state).toBe('error');
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

  it.each(['shadow table', '12', '0', '2 please'])('refuses a free-text reply (%j) to a question of a tool that cannot take one, nothing injected (fail closed)', async text => {
    const before = mk('a', { tool: 'codex', state: 'waiting_input', pending: { kind: 'question', text: 'Which?', options: ['Red', 'Blue'], source: 'pane' } });
    store.upsert(before);
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.reply', id: 'a', text });
    expect(await c.next('error')).toEqual({ type: 'error', id: 'a', message: 'free-text answers are not supported yet, answer in the terminal', request: 'session.reply', code: 'free_text' });
    expect(tmux.sent).toEqual([]);
    expect(store.get('a')).toEqual(before);
    await expect(c.next('session.updated', 200)).rejects.toThrow(/timeout/);
    c.close();
  });

  it('a digit past the known options is still a selection (hook options omit the dialog extras)', async () => {
    tmux = fakeTmux({ 'ledge-a': [QUESTION, QUESTION, 'Running…'] }); await srv.close();
    srv = await startServer({ store, tmux, port: 0 });
    store.upsert(mk('a', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', options: ['Red', 'Blue'], source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.reply', id: 'a', text: '3' });
    await c.next('session.updated', 3000);
    expect(tmux.sent).toEqual([['text', 'ledge-a', '3']]);
    c.close();
  });

  it('reply with an option number to a question sends the digit alone (2.x selects on the digit)', async () => {
    tmux = fakeTmux({ 'ledge-a': [QUESTION, QUESTION, 'Running…'] }); await srv.close();
    srv = await startServer({ store, tmux, port: 0 });
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
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`, { headers: authHeaders() });
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
      const r = await recorder(); await r.until(7);
      expect(r.got.map(m => m.type)).toEqual(['snapshot', 'machines', 'projects', 'island', 'session.preview', 'chat.history', 'context.prefs']);
      expect(r.got[4]).toEqual({ type: 'session.preview', id: 'a', lines: ['● latest'] });
      r.ws.terminate();
    });
    it('a snapshot.request gets the previews again after the snapshot', async () => {
      store.upsert(mk('a')); srv.preview('a', ['● hi']);
      const r = await recorder(); await r.until(3);
      r.ws.send(JSON.stringify({ type: 'snapshot.request' })); await r.until(14);
      expect(r.got.map(m => m.type)).toEqual(['snapshot', 'machines', 'projects', 'island', 'session.preview', 'chat.history', 'context.prefs', 'snapshot', 'machines', 'projects', 'island', 'session.preview', 'chat.history', 'context.prefs']);
      r.ws.terminate();
    });
    it('a removed session drops its preview; a preview for an unknown session is ignored', async () => {
      store.upsert(mk('a')); srv.preview('a', ['● hi']); srv.preview('ghost', ['boo']);
      store.remove('a');
      const r = await recorder(); await r.until(1); await new Promise(res => setTimeout(res, 50));
      expect(r.got.map(m => m.type)).toEqual(['snapshot', 'machines', 'projects', 'island', 'chat.history', 'context.prefs']);
      store.upsert(mk('a'));
      r.ws.send(JSON.stringify({ type: 'snapshot.request' })); await r.until(8); await new Promise(res => setTimeout(res, 50));
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
      expect(await c.next('error')).toEqual({ type: 'error', id: 'a', message: 'the session is still running, kill it first', request: 'session.dismiss', code: 'busy' });
      expect(store.get('a')).toBeDefined();
      c.send({ type: 'session.dismiss', id: 'nope' });
      expect(await c.next('error')).toEqual({ type: 'error', id: 'nope', message: 'unknown session', request: 'session.dismiss', code: 'unknown_session' });
      await expect(c.next('session.removed', 100)).rejects.toThrow(/timeout/);
      c.close();
    });
  });

  describe('archive, restore and delete', () => {
    const withHistory = async (panes: Record<string, string[]>) => {
      tmux = fakeTmux(panes); await srv.close();
      const history = new History({ dir: tmpDir() }); srv = await startServer({ store, tmux, port: 0, history });
      return history;
    };
    const archived = async (c: Awaited<ReturnType<typeof connect>>) => {
      for (;;) { const m = await c.next('session.updated'); if (m.session.archivedAt) return m.session; }
    };
    it('archives a live launcher session: tmux killed, exited, archivedAt set, thread kept', async () => {
      const history = await withHistory({ 'ledge-ab12': [''] });
      store.upsert(mk('ab12')); history.record('ab12', { name: 'UserPromptSubmit', at: T0, source: 'hook', text: 'hello' });
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.archive', id: 'ab12' });
      expect(await archived(c)).toMatchObject({ state: 'exited', archivedAt: expect.any(String) });
      expect(tmux.sent).toContainEqual(['kill', 'ledge-ab12']);
      expect(history.items('ab12')).not.toEqual([]);
      c.close();
    });
    it('archives a live session whose tmux is already gone', async () => {
      store.upsert(mk('a'));
      tmux.killSession = async () => { throw new Error('no such session'); };
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.archive', id: 'a' });
      expect(await archived(c)).toMatchObject({ state: 'exited' });
      c.close();
    });
    it('archives a running hook_only session without stopping it', async () => {
      store.upsert(mk('h', { source: 'hook_only', tmuxSession: null }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.archive', id: 'h' });
      expect(await archived(c)).toMatchObject({ state: 'working' });
      expect(tmux.sent.filter(m => m[0] === 'kill')).toEqual([]);
      c.close();
    });
    it('restore clears archivedAt and keeps the session exited', async () => {
      store.upsert(mk('a', { state: 'exited', exitCode: 0, exitedAt: T0, archivedAt: T0 }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.restore', id: 'a' });
      const m = await c.next('session.updated');
      expect(m.session.archivedAt).toBeUndefined(); expect(m.session.state).toBe('exited');
      // The retirement clock restarts from the restore, so the poller does not archive it again at once.
      expect(m.session.restoredAt).toEqual(expect.any(String));
      c.close();
    });
    it('a late SessionEnd for an archived exited session leaves it archived', async () => {
      store.upsert(mk('a', { state: 'exited', exitCode: 0, exitedAt: T0, archivedAt: T0 }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.event', id: 'a', event: { name: 'SessionEnd', at: T0, source: 'hook', exitCode: 0 } });
      c.send({ type: 'session.event', id: 'a', event: { name: 'Stop', at: T0, source: 'hook' } });
      c.send({ type: 'snapshot.request' }); await c.next('snapshot');
      expect(store.get('a')!.archivedAt).toBe(T0);
      c.close();
    });
    it('a late SessionEnd for an archived running hook_only session leaves it archived, and exited', async () => {
      store.upsert(mk('h', { source: 'hook_only', tmuxSession: null, archivedAt: T0 }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.event', id: 'h', event: { name: 'SessionEnd', at: T0, source: 'hook', exitCode: 0 } });
      c.send({ type: 'snapshot.request' }); await c.next('snapshot');
      expect(store.get('h')).toMatchObject({ state: 'exited', archivedAt: T0 });
      c.close();
    });
    it('a running hook_only archived session comes back on its next hook', async () => {
      store.upsert(mk('h', { source: 'hook_only', tmuxSession: null, archivedAt: T0 }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.event', id: 'h', event: { name: 'UserPromptSubmit', at: T0, source: 'hook', text: 'encore' } });
      await until(() => store.get('h')?.archivedAt === undefined);
      c.close();
    });
    it('a late hook for a deleted session does not bring it back', async () => {
      store.upsert(mk('a', { state: 'exited', exitCode: 0, exitedAt: T0, tmuxSession: null }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.delete', id: 'a' }); await c.next('session.removed');
      c.send({ type: 'session.event', id: 'a', event: { name: 'SessionEnd', at: T0, source: 'hook', exitCode: 0 } });
      c.send({ type: 'session.event', id: 'a', event: { name: 'Stop', at: T0, source: 'hook' } });
      c.send({ type: 'snapshot.request' }); await c.next('snapshot');
      expect(store.get('a')).toBeUndefined();
      c.close();
    });
    it('never creates a session from a SessionEnd for an unknown id', async () => {
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.event', id: 'z', cwd: '/w/x', event: { name: 'SessionEnd', at: T0, source: 'hook', exitCode: 0 } });
      c.send({ type: 'snapshot.request' }); await c.next('snapshot');
      expect(store.get('z')).toBeUndefined();
      c.close();
    });
    it('delete kills a live launcher session, then removes it and its thread', async () => {
      const history = await withHistory({ 'ledge-a': [''] });
      store.upsert(mk('a')); history.record('a', { name: 'UserPromptSubmit', at: T0, source: 'hook', text: 'hello' });
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.delete', id: 'a' });
      expect(await c.next('session.removed')).toEqual({ type: 'session.removed', id: 'a' });
      expect(tmux.sent).toContainEqual(['kill', 'ledge-a']);
      expect(history.items('a')).toEqual([]);
      c.close();
    });
    it('refuses an unknown id for each of archive, restore and delete', async () => {
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      for (const type of ['session.archive', 'session.restore', 'session.delete'] as const) {
        c.send({ type, id: 'nope' });
        expect(await c.next('error')).toEqual({ type: 'error', id: 'nope', message: 'unknown session', request: type, code: 'unknown_session' });
      }
      c.close();
    });
  });

  describe('resume', () => {
    const cwd = () => tmpdir();
    const ended = (id: string, extra: Partial<Session> = {}) => mk(id, { cwd: cwd(), project: 'p', state: 'exited', exitCode: 0, exitedAt: T0, archivedAt: T0, tmuxSession: null, topic: 'Fix the bug', topicSource: 'pane', ...extra });
    const resume = async (id: string) => { const c = await connect({ port: srv.port }); await c.next('snapshot'); c.send({ type: 'session.resume', id }); return c; };
    it('resumes an archived Claude session under the same id and name', async () => {
      store.upsert(ended('ab12', { agentSessionId: 'u-1', source: 'hook_only' }));
      const c = await resume('ab12');
      await until(() => !!store.get('ab12')?.tmuxSession);
      const m = { session: store.get('ab12')! };
      expect(tmux.created).toHaveLength(1);
      expect(tmux.created[0]!.name).toBe('ledge-ab12');
      expect(tmux.created[0]!.command.slice(-2)).toEqual(['--resume', 'u-1']);
      expect(tmux.created[0]!.command).not.toContain('--session-id');
      expect(m.session).toMatchObject({ id: 'ab12', name: 'Otto', state: 'starting', source: 'launcher', topic: 'Fix the bug' });
      expect(m.session.archivedAt).toBeUndefined(); expect(m.session.exitedAt).toBeUndefined(); expect(m.session.exitCode).toBeUndefined();
      c.close();
    });
    it('resumes Codex with resume <id> and Cursor with --resume <id>', async () => {
      store.upsert(ended('c1', { tool: 'codex', agentSessionId: 'cx-1' })); store.upsert(ended('c2', { tool: 'cursor', name: 'Mia', agentSessionId: 'cu-1' }));
      const c = await resume('c1'); await until(() => tmux.created.length === 1); c.send({ type: 'session.resume', id: 'c2' }); await until(() => tmux.created.length === 2);
      expect(tmux.created[0]!.command.slice(-2)).toEqual(['resume', 'cx-1']);
      expect(tmux.created[1]!.command.slice(-2)).toEqual(['--resume', 'cu-1']);
      c.close();
    });
    it('a resumed session keeps the model and effort it was launched with (#58)', async () => {
      store.upsert(ended('m1', { tool: 'codex', agentSessionId: 'cx-1', model: 'gpt-6-luna', effort: 'high' }));
      const c = await resume('m1'); await until(() => !!store.get('m1')?.tmuxSession);
      expect(tmux.created[0]!.command.slice(-6)).toEqual(['resume', 'cx-1', '-m', 'gpt-6-luna', '-c', 'model_reasoning_effort="high"']);
      expect(store.get('m1')).toMatchObject({ model: 'gpt-6-luna', effort: 'high' });
      c.close();
    });
    it('falls back to the transcript name for Claude', async () => {
      store.upsert(ended('t1', { transcriptPath: '/h/.claude/projects/x/u-9.jsonl' }));
      const c = await resume('t1'); await until(() => tmux.created.length === 1);
      expect(tmux.created[0]!.command.slice(-2)).toEqual(['--resume', 'u-9']);
      c.close();
    });
    it('refuses a live session and one without a conversation id', async () => {
      store.upsert(mk('live', { cwd: cwd(), agentSessionId: 'u-1' })); store.upsert(ended('none')); store.upsert(ended('cx', { tool: 'codex', transcriptPath: '/h/u-9.jsonl' }));
      const c = await resume('live');
      expect(await c.next('error')).toEqual({ type: 'error', id: 'live', message: 'the session is still running', request: 'session.resume', code: 'busy' });
      c.send({ type: 'session.resume', id: 'none' });
      expect(await c.next('error')).toEqual({ type: 'error', id: 'none', message: 'no conversation to resume', request: 'session.resume', code: 'no_conversation' });
      c.send({ type: 'session.resume', id: 'cx' });
      expect(await c.next('error')).toMatchObject({ id: 'cx', message: 'no conversation to resume' });
      c.send({ type: 'session.resume', id: 'nope' });
      expect(await c.next('error')).toMatchObject({ id: 'nope', message: 'unknown session' });
      expect(tmux.created).toEqual([]);
      c.close();
    });
    it('a second resume right after the first is refused', async () => {
      store.upsert(ended('ab12', { agentSessionId: 'u-1' }));
      const c = await resume('ab12'); c.send({ type: 'session.resume', id: 'ab12' });
      expect(await c.next('error')).toMatchObject({ id: 'ab12', message: 'the session is still running' });
      await until(() => tmux.created.length === 1);
      expect(tmux.created).toHaveLength(1);
      c.close();
    });
    /** Holds the spawn inside tmux.newSession until `release` is called. */
    const holdSpawn = () => {
      const orig = tmux.newSession.bind(tmux); let entered = false; let release!: () => void;
      const gate = new Promise<void>(r => { release = r; });
      tmux.newSession = async o => { entered = true; await gate; return orig(o); };
      return { entered: () => entered, release: () => release() };
    };
    it('a delete during the spawn wins: no session, the new tmux killed', async () => {
      store.upsert(ended('ab12', { agentSessionId: 'u-1' }));
      const hold = holdSpawn();
      const c = await resume('ab12'); await until(hold.entered);
      c.send({ type: 'session.delete', id: 'ab12' }); await c.next('session.removed');
      hold.release();
      await until(() => tmux.sent.some(m => m[0] === 'kill' && m[1] === 'ledge-ab12'));
      expect(store.get('ab12')).toBeUndefined();
      c.send({ type: 'snapshot.request' }); const snap = await c.next('snapshot');
      expect(snap.sessions.map(x => x.id)).not.toContain('ab12');
      c.close();
    });
    it('an archive during the spawn wins: it stays archived and exited, the new tmux killed', async () => {
      store.upsert(ended('ab12', { agentSessionId: 'u-1' }));
      const hold = holdSpawn();
      const c = await resume('ab12'); await until(hold.entered);
      c.send({ type: 'session.archive', id: 'ab12' });
      await until(() => !!store.get('ab12')?.archivedAt);
      hold.release();
      await until(() => tmux.sent.some(m => m[0] === 'kill' && m[1] === 'ledge-ab12'));
      c.send({ type: 'snapshot.request' }); await c.next('snapshot');
      expect(store.get('ab12')).toMatchObject({ state: 'exited', archivedAt: expect.any(String) });
      c.close();
    });
    it('a failed spawn does not bring back a session deleted meanwhile', async () => {
      store.upsert(ended('ab12', { agentSessionId: 'u-1' }));
      let entered = false; let fail!: () => void;
      tmux.newSession = async () => { entered = true; await new Promise<void>((_, rej) => { fail = () => rej(new Error('tmux is gone')); }); };
      const c = await resume('ab12'); await until(() => entered);
      c.send({ type: 'session.delete', id: 'ab12' }); await c.next('session.removed');
      fail();
      expect(await c.next('error')).toMatchObject({ id: 'ab12', message: 'tmux is gone', request: 'session.resume' });
      expect(store.get('ab12')).toBeUndefined();
      c.close();
    });
    it('puts the session back and refuses with the reason when the launch fails', async () => {
      const before = ended('ab12', { agentSessionId: 'u-1' }); store.upsert(before);
      tmux.newSession = async () => { throw new Error('tmux is gone'); };
      const c = await resume('ab12');
      expect(await c.next('error')).toMatchObject({ id: 'ab12', message: 'tmux is gone', request: 'session.resume' });
      expect(store.get('ab12')).toEqual(before);
      c.close();
    });
  });

  describe('session.model: a live session changes model (#58, lot 2)', () => {
    const live = (id: string, extra: Partial<Session> = {}) => mk(id, { cwd: tmpdir(), project: 'p', agentSessionId: 'u-1', state: 'idle', model: 'opus', effort: 'high', ...extra });
    const ask = async (msg: { id: string; model: string | null; effort: string | null }) => {
      const c = await connect({ port: srv.port }); await c.next('snapshot'); c.send({ type: 'session.model', ...msg }); return c;
    };
    it('a free session is stopped and resumed on the same conversation with the new model and effort', async () => {
      store.upsert(live('ab12'));
      const c = await ask({ id: 'ab12', model: 'sonnet', effort: 'max' });
      await until(() => tmux.created.length === 1);
      expect(tmux.sent).toContainEqual(['kill', 'ledge-ab12']);
      expect(tmux.created[0]!.command.slice(-6)).toEqual(['--resume', 'u-1', '--model', 'sonnet', '--effort', 'max']);
      await until(() => store.get('ab12')?.model === 'sonnet');
      expect(store.get('ab12')).toMatchObject({ id: 'ab12', name: 'Otto', state: 'starting', model: 'sonnet', effort: 'max' });
      expect(store.get('ab12')?.modelNext).toBeUndefined();
      c.close();
    });
    it('null goes back to the agent\'s default: no --model, no --effort', async () => {
      store.upsert(live('cx', { tool: 'codex', agentSessionId: 'cx-1', model: 'gpt-6-astra', effort: 'ultra' }));
      const c = await ask({ id: 'cx', model: null, effort: null });
      await until(() => tmux.created.length === 1);
      expect(tmux.created[0]!.command.slice(-2)).toEqual(['resume', 'cx-1']);
      await until(() => store.get('cx')?.state === 'starting');
      expect(store.get('cx')?.model).toBeUndefined(); expect(store.get('cx')?.effort).toBeUndefined();
      c.close();
    });
    it('while the agent works the change waits, then applies at its next free moment', async () => {
      store.upsert(live('ab12', { state: 'working' }));
      const c = await ask({ id: 'ab12', model: 'fable', effort: null });
      await until(() => !!store.get('ab12')?.modelNext);
      expect(store.get('ab12')?.modelNext).toEqual({ model: 'fable' });
      expect(tmux.created).toEqual([]); expect(tmux.sent).not.toContainEqual(['kill', 'ledge-ab12']);
      store.apply('ab12', { name: 'Stop', at: T0, source: 'hook' });
      await until(() => tmux.created.length === 1);
      expect(tmux.created[0]!.command.slice(-4)).toEqual(['--resume', 'u-1', '--model', 'fable']);
      await until(() => store.get('ab12')?.model === 'fable');
      expect(store.get('ab12')?.modelNext).toBeUndefined();
      c.close();
    });
    it('asking for the model it runs drops a waiting change and restarts nothing', async () => {
      store.upsert(live('ab12', { state: 'working', modelNext: { model: 'haiku' } }));
      const c = await ask({ id: 'ab12', model: 'opus', effort: 'high' });
      await until(() => !store.get('ab12')?.modelNext);
      store.apply('ab12', { name: 'Stop', at: T0, source: 'hook' });
      await c.next('session.updated');
      expect(tmux.created).toEqual([]);
      c.close();
    });
    it('the replaced agent\'s late end hooks do not end the one resumed in its place', async () => {
      store.upsert(live('ab12'));
      const c = await ask({ id: 'ab12', model: 'sonnet', effort: null });
      await until(() => store.get('ab12')?.model === 'sonnet');
      c.send({ type: 'session.event', id: 'ab12', event: { name: 'SessionEnd', at: T0, source: 'hook', exitCode: null } });
      c.send({ type: 'session.unregister', id: 'ab12', exitCode: 0 });
      c.send({ type: 'session.event', id: 'ab12', event: { name: 'Stop', at: T0, source: 'hook' } });
      await until(() => store.get('ab12')?.state === 'idle');
      expect(store.get('ab12')?.state).toBe('idle');
      c.close();
    });
    it('refuses a read-only, an ended, an unknown session, one without a conversation, and an effort apart for Cursor', async () => {
      store.upsert(live('ro', { source: 'hook_only' })); store.upsert(live('end', { state: 'exited', tmuxSession: null }));
      store.upsert(live('nokey', { agentSessionId: undefined })); store.upsert(live('cu', { tool: 'cursor', model: 'auto', effort: undefined }));
      const c = await ask({ id: 'ro', model: 'opus', effort: null });
      expect(await c.next('error')).toMatchObject({ id: 'ro', request: 'session.model' });
      c.send({ type: 'session.model', id: 'end', model: 'opus', effort: null });
      expect(await c.next('error')).toMatchObject({ id: 'end', message: 'the session has ended' });
      c.send({ type: 'session.model', id: 'nope', model: 'opus', effort: null });
      expect(await c.next('error')).toMatchObject({ id: 'nope', message: 'unknown session' });
      c.send({ type: 'session.model', id: 'nokey', model: 'opus', effort: null });
      expect(await c.next('error')).toMatchObject({ id: 'nokey', message: 'no conversation to resume' });
      c.send({ type: 'session.model', id: 'cu', model: 'gpt-5.3-codex', effort: 'high' });
      expect(await c.next('error')).toMatchObject({ id: 'cu', message: 'cursor takes its effort in the model id' });
      expect(tmux.created).toEqual([]);
      c.close();
    });
    it('refuses a hook_only session with code not_launched', async () => {
      store.upsert(live('ro', { source: 'hook_only' }));
      const c = await ask({ id: 'ro', model: 'sonnet', effort: null });
      expect(await c.next('error')).toMatchObject({ type: 'error', id: 'ro', request: 'session.model', code: 'not_launched' });
      c.close();
    });
    it('refuses an exited session with code ended', async () => {
      store.upsert(live('end', { state: 'exited', tmuxSession: null }));
      const c = await ask({ id: 'end', model: 'sonnet', effort: null });
      expect(await c.next('error')).toMatchObject({ type: 'error', id: 'end', request: 'session.model', code: 'ended' });
      c.close();
    });
    it('refuses a session without conversation with code no_conversation', async () => {
      store.upsert(live('nokey', { agentSessionId: undefined }));
      const c = await ask({ id: 'nokey', model: 'sonnet', effort: null });
      expect(await c.next('error')).toMatchObject({ type: 'error', id: 'nokey', request: 'session.model', code: 'no_conversation' });
      c.close();
    });
    it('refuses an effort for cursor with code effort_in_model', async () => {
      store.upsert(live('cu', { tool: 'cursor', model: 'auto', effort: undefined }));
      const c = await ask({ id: 'cu', model: 'gpt-5.3-codex', effort: 'high' });
      expect(await c.next('error')).toMatchObject({ type: 'error', id: 'cu', request: 'session.model', code: 'effort_in_model' });
      expect(tmux.created).toEqual([]);
      c.close();
    });
    it('answers accepted now when the session is idle', async () => {
      store.upsert(live('ab12'));
      const c = await ask({ id: 'ab12', model: 'sonnet', effort: null });
      expect(await c.next('session.model.accepted')).toEqual({ type: 'session.model.accepted', id: 'ab12', when: 'now' });
      await until(() => tmux.created.length === 1);
      expect(tmux.created[0]!.command.slice(-4)).toEqual(['--resume', 'u-1', '--model', 'sonnet']);
      c.close();
    });
    it('answers accepted turn while the agent works', async () => {
      store.upsert(live('ab12', { state: 'working' }));
      const c = await ask({ id: 'ab12', model: 'sonnet', effort: null });
      expect(await c.next('session.model.accepted')).toEqual({ type: 'session.model.accepted', id: 'ab12', when: 'turn' });
      expect(store.get('ab12')?.modelNext).toEqual({ model: 'sonnet' });
      expect(tmux.created).toEqual([]);
      store.apply('ab12', { name: 'Stop', at: T0, source: 'hook' });
      await until(() => tmux.created.length === 1);
      c.close();
    });
    it('answers accepted none for a no-op and clears modelNext', async () => {
      store.upsert(live('ab12', { state: 'working', modelNext: { model: 'haiku' } }));
      const c = await ask({ id: 'ab12', model: 'opus', effort: 'high' });
      expect(await c.next('session.model.accepted')).toEqual({ type: 'session.model.accepted', id: 'ab12', when: 'none' });
      expect(store.get('ab12')?.modelNext).toBeUndefined();
      expect(tmux.created).toEqual([]);
      c.close();
    });
    it('a second change asked while the first is applied is kept, then applied after it', async () => {
      store.upsert(live('ab12'));
      let release!: () => void; const gate = new Promise<void>(r => { release = r; });
      let killing = false; const kill = tmux.killSession.bind(tmux);
      tmux.killSession = async n => { killing = true; await gate; return kill(n); };
      const c = await ask({ id: 'ab12', model: 'sonnet', effort: null });
      expect(await c.next('session.model.accepted')).toMatchObject({ when: 'now' });
      await until(() => killing);
      c.send({ type: 'session.model', id: 'ab12', model: 'haiku', effort: null });
      expect(await c.next('session.model.accepted')).toEqual({ type: 'session.model.accepted', id: 'ab12', when: 'turn' });
      release();
      await until(() => store.get('ab12')?.model === 'sonnet');
      expect(store.get('ab12')?.modelNext).toEqual({ model: 'haiku' });
      // Its next free moment applies the second one.
      store.apply('ab12', { name: 'Stop', at: T0, source: 'hook' });
      await until(() => store.get('ab12')?.model === 'haiku');
      expect(tmux.created.at(-1)!.command.slice(-4)).toEqual(['--resume', 'u-1', '--model', 'haiku']);
      expect(store.get('ab12')?.modelNext).toBeUndefined();
      c.close();
    });
    it('going back to the former model while a change is applied is kept for after it', async () => {
      store.upsert(live('ab12'));
      let release!: () => void; const gate = new Promise<void>(r => { release = r; });
      let killing = false; const kill = tmux.killSession.bind(tmux);
      tmux.killSession = async n => { killing = true; await gate; return kill(n); };
      const c = await ask({ id: 'ab12', model: 'sonnet', effort: null });
      expect(await c.next('session.model.accepted')).toMatchObject({ when: 'now' });
      await until(() => killing);
      c.send({ type: 'session.model', id: 'ab12', model: 'opus', effort: 'high' });
      expect(await c.next('session.model.accepted')).toMatchObject({ when: 'turn' });
      release();
      await until(() => store.get('ab12')?.model === 'sonnet');
      expect(store.get('ab12')?.modelNext).toEqual({ model: 'opus', effort: 'high' });
      c.close();
    });
    it('a change asked while a failing respawn runs is refused with code ended once it failed', async () => {
      store.upsert(live('ab12'));
      let release!: () => void; const gate = new Promise<void>(r => { release = r; });
      let killing = false; const kill = tmux.killSession.bind(tmux);
      tmux.killSession = async n => { killing = true; await gate; return kill(n); };
      tmux.newSession = async () => { throw new Error('tmux is gone'); };
      const c = await ask({ id: 'ab12', model: 'sonnet', effort: null });
      expect(await c.next('session.model.accepted')).toMatchObject({ when: 'now' });
      await until(() => killing);
      c.send({ type: 'session.model', id: 'ab12', model: 'haiku', effort: null });
      expect(await c.next('session.model.accepted')).toMatchObject({ when: 'turn' });
      release();
      expect(await c.next('error')).toMatchObject({ id: 'ab12', code: 'restart_failed' });
      expect(await c.next('error')).toMatchObject({ id: 'ab12', request: 'session.model', code: 'ended' });
      expect(store.get('ab12')?.modelNext).toBeUndefined();
      c.close();
    });
    it('broadcasts restart_failed when the respawn fails', async () => {
      store.upsert(live('ab12'));
      tmux.newSession = async () => { throw new Error('tmux is gone'); };
      const c = await ask({ id: 'ab12', model: 'sonnet', effort: null });
      expect(await c.next('session.model.accepted')).toMatchObject({ when: 'now' });
      expect(await c.next('error')).toMatchObject({ type: 'error', id: 'ab12', request: 'session.model', message: 'tmux is gone', code: 'restart_failed' });
      expect(store.get('ab12')?.modelNext).toBeUndefined();
      c.close();
    });
  });

  describe('launch from a chat card', () => {
    const home = () => process.env.LEDGE_HOME!;
    /** A chat holding one proposal for `q1`; the marks are recorded and broadcast as a history, like the real one. */
    function stubChat(initial: ChatProposal | undefined) {
      let proposal = initial; const marks: string[][] = [];
      const chat: Chat = {
        async ask() {}, attachmentIds: () => [], cancel() {}, async reset() {}, history: () => [],
        proposal: qid => (qid === 'q1' ? proposal : undefined),
        markLaunched(qid, id, emit) { marks.push(['launched', qid, id]); proposal = { ...proposal!, launchedId: id }; emit({ type: 'chat.history', turns: [] }); },
        markFailed(qid, message, emit) { marks.push(['failed', qid, message]); proposal = { ...proposal!, error: message }; emit({ type: 'chat.history', turns: [] }); },
        relay: () => undefined, markRelay() {}, queuedRelays: () => [], close: () => undefined, markClosed() {}, markCloseFailed() {}, idle: async () => {}, task: () => undefined, markTask() {}, followTask() {}, action: () => undefined, markAction() {}, ignore: () => null, ignored: () => false
      };
      return { chat, marks };
    }
    const start = (chat: Chat) => startServer({ store, tmux, port: 0, home: home(), chat, agentEnv: async () => ({ ...process.env, PATH: '/login/bin:/usr/bin' }) });

    it('launches the proposal\'s own fields, marks the turn for everyone, and refuses a second launch, even a simultaneous one', async () => {
      mkdirSync(join(home(), 'ledge'));
      const { chat, marks } = stubChat({ cwd: join(home(), 'ledge'), project: 'ledge', tool: 'claude', prompt: 'Corrige le build' });
      const srv2 = await start(chat);
      const c = await connect({ port: srv2.port }); await c.next('snapshot'); await c.next('chat.history');
      const other = await connect({ port: srv2.port }); await other.next('snapshot'); await other.next('chat.history');
      // The message's fields are ignored: only the qid names the card.
      c.send({ type: 'session.launch', tool: 'codex', cwd: '/elsewhere', prompt: 'autre chose', qid: 'q1' });
      c.send({ type: 'session.launch', tool: 'claude', cwd: join(home(), 'ledge'), qid: 'q1' });
      const launched = await c.next('session.launched');
      expect(await c.next('error')).toEqual({ type: 'error', message: 'already launched', request: 'session.launch' });
      expect(tmux.created).toHaveLength(1);
      expect(tmux.created[0]!.cwd).toBe(join(home(), 'ledge'));
      expect(JSON.stringify(tmux.created[0]!.command)).toContain('Corrige le build');
      expect(JSON.stringify(tmux.created[0]!.command)).not.toContain('autre chose');
      expect(store.get(launched.id)).toMatchObject({ tool: 'claude', project: 'ledge', source: 'launcher' });
      expect(marks).toEqual([['launched', 'q1', launched.id]]);
      await other.next('chat.history');
      c.send({ type: 'session.launch', tool: 'claude', cwd: join(home(), 'ledge'), qid: 'q1' });
      expect(await c.next('error')).toEqual({ type: 'error', message: 'already launched', request: 'session.launch' });
      expect(tmux.created).toHaveLength(1);
      c.close(); other.close(); await srv2.close();
    });

    it('a card launches its rows with the model chosen on the card (#58)', async () => {
      mkdirSync(join(home(), 'ledge'), { recursive: true });
      const srv2 = await start(stubChat({ cwd: join(home(), 'ledge'), project: 'ledge', tool: 'claude', prompt: 'Corrige' }).chat);
      const c = await connect({ port: srv2.port }); await c.next('snapshot');
      c.send({ type: 'session.launch', tool: 'claude', cwd: '/x', qid: 'q1', model: 'haiku', effort: 'low' });
      const { id } = await c.next('session.launched');
      expect(tmux.created[0]!.command).toEqual(expect.arrayContaining(['--model', 'haiku', '--effort', 'low']));
      expect(store.get(id)).toMatchObject({ model: 'haiku', effort: 'low' });
      c.close(); await srv2.close();
    });

    it('refuses an unknown proposal without spawning', async () => {
      const srv2 = await start(stubChat(undefined).chat);
      const c = await connect({ port: srv2.port }); await c.next('snapshot');
      c.send({ type: 'session.launch', tool: 'claude', cwd: '/w', qid: 'q1' });
      expect(await c.next('error')).toEqual({ type: 'error', message: 'unknown proposal', request: 'session.launch' });
      expect(tmux.created).toHaveLength(0);
      c.close(); await srv2.close();
    });

    it('marks a failed launch, then lets the card retry', async () => {
      const { chat, marks } = stubChat({ cwd: join(home(), 'gone'), project: 'gone', tool: 'claude' });
      const srv2 = await start(chat);
      const c = await connect({ port: srv2.port }); await c.next('snapshot');
      c.send({ type: 'session.launch', tool: 'claude', cwd: join(home(), 'gone'), qid: 'q1' });
      expect(await c.next('error')).toEqual({ type: 'error', message: `no such folder: ${join(home(), 'gone')}`, request: 'session.launch' });
      expect(marks).toEqual([['failed', 'q1', `no such folder: ${join(home(), 'gone')}`]]);
      mkdirSync(join(home(), 'gone'));
      c.send({ type: 'session.launch', tool: 'claude', cwd: join(home(), 'gone'), qid: 'q1' });
      const launched = await c.next('session.launched');
      expect(marks.at(-1)).toEqual(['launched', 'q1', launched.id]);
      c.close(); await srv2.close();
    });

    describe('several rows (#24)', () => {
      /** A chat whose `q1` card holds these rows; marks are recorded per row. */
      function rowsChat(initial: ChatProposal[]) {
        const rows = [...initial]; const marks: Array<[string, number, string]> = [];
        const chat: Chat = {
          async ask() {}, attachmentIds: () => [], cancel() {}, async reset() {}, history: () => [],
          proposal: (qid, row = 0) => (qid === 'q1' ? rows[row] : undefined),
          markLaunched(_qid, id, emit, row = 0) { marks.push(['launched', row, id]); rows[row] = { ...rows[row]!, launchedId: id }; emit({ type: 'chat.history', turns: [] }); },
          markFailed(_qid, message, emit, row = 0) { marks.push(['failed', row, message]); rows[row] = { ...rows[row]!, error: message }; emit({ type: 'chat.history', turns: [] }); },
          relay: () => undefined, markRelay() {}, queuedRelays: () => [], close: () => undefined, markClosed() {}, markCloseFailed() {}, idle: async () => {}, task: () => undefined, markTask() {}, followTask() {}, action: () => undefined, markAction() {}, ignore: () => null, ignored: () => false
        };
        return { chat, marks };
      }
      const row = (name: string): ChatProposal => ({ cwd: join(home(), name), project: name, tool: 'claude' });

      it('launches the rows asked, one after the other, each with its own bot name', async () => {
        for (const n of ['a', 'b', 'c']) mkdirSync(join(home(), n));
        const { chat, marks } = rowsChat([row('a'), row('b'), row('c')]);
        const srv2 = await start(chat);
        const c = await connect({ port: srv2.port }); await c.next('snapshot');
        c.send({ type: 'session.launch', tool: 'claude', cwd: '/x', qid: 'q1', rows: [2, 0] });
        const first = await c.next('session.launched'); const second = await c.next('session.launched');
        expect(tmux.created.map(t => t.cwd)).toEqual([join(home(), 'c'), join(home(), 'a')]);
        expect(marks).toEqual([['launched', 2, first.id], ['launched', 0, second.id]]);
        expect(store.get(first.id)!.name).not.toBe(store.get(second.id)!.name);
        c.close(); await srv2.close();
      });

      it('skips a launched row, goes on past a failed one, then refuses with the failure', async () => {
        mkdirSync(join(home(), 'c'));
        const { chat, marks } = rowsChat([{ ...row('a'), launchedId: 'n0' }, row('gone'), row('c')]);
        const srv2 = await start(chat);
        const c = await connect({ port: srv2.port }); await c.next('snapshot');
        c.send({ type: 'session.launch', tool: 'claude', cwd: '/x', qid: 'q1', rows: [0, 1, 2] });
        const launched = await c.next('session.launched');
        expect(await c.next('error')).toEqual({ type: 'error', message: `no such folder: ${join(home(), 'gone')}`, request: 'session.launch' });
        expect(marks).toEqual([['failed', 1, `no such folder: ${join(home(), 'gone')}`], ['launched', 2, launched.id]]);
        expect(tmux.created).toHaveLength(1);
        c.close(); await srv2.close();
      });

      it('refuses when no row asked is left to launch, or none exists', async () => {
        const { chat } = rowsChat([{ ...row('a'), launchedId: 'n0' }]);
        const srv2 = await start(chat);
        const c = await connect({ port: srv2.port }); await c.next('snapshot');
        c.send({ type: 'session.launch', tool: 'claude', cwd: '/x', qid: 'q1', rows: [0] });
        expect(await c.next('error')).toEqual({ type: 'error', message: 'already launched', request: 'session.launch' });
        c.send({ type: 'session.launch', tool: 'claude', cwd: '/x', qid: 'q1', rows: [3] });
        expect(await c.next('error')).toEqual({ type: 'error', message: 'unknown proposal', request: 'session.launch' });
        expect(tmux.created).toHaveLength(0);
        c.close(); await srv2.close();
      });
    });
  });

  describe('relay from a chat card', () => {
    function relayChat(relay: ChatRelay) {
      let r: ChatRelay | undefined = relay;
      const chat: Chat = {
        async ask() {}, attachmentIds: () => [], cancel() {}, async reset() {}, history: () => [], proposal: () => undefined, markLaunched() {}, markFailed() {},
        relay: qid => (qid === 'q1' ? r : undefined),
        markRelay(_qid, patch, emit) { const { id, name, tool, text } = r!; r = { id, name, tool, text, ...patch }; emit({ type: 'chat.history', turns: [] }); },
        queuedRelays: () => (r?.status === 'queued' ? [{ qid: 'q1', relay: r, askedAt: '2026-10-12T08:00:00.000Z' }] : []),
        close: () => undefined, markClosed() {}, markCloseFailed() {}, idle: async () => {}, task: () => undefined, markTask() {}, followTask() {}, action: () => undefined, markAction() {}, ignore: () => null, ignored: () => false
      };
      return { chat, current: () => r };
    }

    it('types the turn\'s own text into a free session and tells every client', async () => {
      tmux = fakeTmux({ 'ledge-a': ['> '] });
      const { chat, current } = relayChat({ id: 'a', name: 'Otto', tool: 'claude', text: 'Lance les tests' });
      const srv2 = await startServer({ store, tmux, port: 0, chat });
      store.upsert(mk('a', { state: 'idle' }));
      const c = await connect({ port: srv2.port }); await c.next('snapshot'); await c.next('chat.history');
      const other = await connect({ port: srv2.port }); await other.next('snapshot'); await other.next('chat.history');
      c.send({ type: 'session.relay', qid: 'q1' });
      await other.next('chat.history', 3000);
      expect(tmux.sent).toEqual([['text', 'ledge-a', 'Lance les tests'], ['keys', 'ledge-a', 'Enter']]);
      expect(current()).toMatchObject({ status: 'sent' });
      c.close(); other.close(); await srv2.close();
    });

    it('queues for a busy session, then cancel; refusals reach the requester as errors', async () => {
      const { chat, current } = relayChat({ id: 'a', name: 'Otto', tool: 'claude', text: 'x' });
      const srv2 = await startServer({ store, tmux, port: 0, chat });
      store.upsert(mk('a', { state: 'working' }));
      const c = await connect({ port: srv2.port }); await c.next('snapshot'); await c.next('chat.history');
      c.send({ type: 'session.relay', qid: 'q1' }); await c.next('chat.history');
      expect(current()!.status).toBe('queued');
      c.send({ type: 'session.relay', qid: 'q1' });
      expect(await c.next('error')).toEqual({ type: 'error', message: 'already queued', request: 'session.relay' });
      c.send({ type: 'session.relay.cancel', qid: 'q1' }); await c.next('chat.history');
      expect(current()).not.toHaveProperty('status');
      c.send({ type: 'session.relay.cancel', qid: 'q1' });
      expect(await c.next('error')).toEqual({ type: 'error', message: 'nothing queued', request: 'session.relay.cancel' });
      c.send({ type: 'session.relay', qid: 'q9' });
      expect(await c.next('error')).toEqual({ type: 'error', message: 'unknown relay', request: 'session.relay' });
      expect(tmux.sent).toEqual([]);
      c.close(); await srv2.close();
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
    it('Claude Code gets its session id from the launch, so its transcript is known without hooks; a resume keeps its own', async () => {
      mkdirSync(join(home(), 'my_app.v2'));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.launch', tool: 'claude', cwd: join(home(), 'my_app.v2'), prompt: 'plan it' });
      const launched = await c.next('session.launched');
      const cmd = tmux.created[0]!.command;
      expect(cmd[0]).toBe('claude'); expect(cmd[1]).toBe('--session-id');
      const uuid = cmd[2]!;
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(cmd.slice(3)).toEqual(['plan it']);
      const s = store.get(launched.id)!;
      expect(s.agentSessionId).toBe(uuid);
      const dir = join(home(), 'my_app.v2').replace(/[^a-zA-Z0-9]/g, '-');
      expect(s.transcriptPath).toMatch(new RegExp(`/projects/${dir}/${uuid}\\.jsonl$`));
      c.send({ type: 'session.launch', tool: 'claude', cwd: join(home(), 'my_app.v2'), continue: true });
      const resumed = await c.next('session.launched');
      expect(tmux.created[1]!.command).toEqual(['claude', '--continue']);
      expect(store.get(resumed.id)!.transcriptPath).toBeUndefined();
      c.close();
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
      // Its key goes the same way (#93): the daemon checks the `by` of its commands against it.
      const key = sessionKey(first.id)!;
      expect(tmux.created[0]!.command).toEqual(['codex', '-c', `shell_environment_policy.set.LEDGE_CODEX_HOOK_SESSION="${first.id}"`, '-c', `shell_environment_policy.set.LEDGE_SESSION_KEY="${key}"`]);
      expect(tmux.created[0]!.env).toMatchObject({ LEDGE_SESSION: first.id, LEDGE_SESSION_KEY: key, LEDGE_CODEX_SESSION: first.id });
      expect(tmux.created[1]!.env.LEDGE_SESSION_KEY).toBe(sessionKey(second.id));
      expect(tmux.created[1]!.env.LEDGE_CODEX_SESSION).toBeUndefined();
      c.close();
    });
    it('skips a base name a numbered session holds, and reuses a name once that session is archived', async () => {
      mkdirSync(join(home(), 'q'));
      store.upsert(mk('a', { name: 'Otto-2' }));
      store.upsert(mk('old', { name: 'Pim', state: 'idle', archivedAt: T0 }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.launch', tool: 'cursor', cwd: join(home(), 'q'), name: 'Otto' });
      const launched = await c.next('session.launched');
      expect(store.get(launched.id)!.name).toBe('Pim');
      c.close();
    });
    it('expands ~ and refuses a missing folder or a file with an error for the requester', async () => {
      mkdirSync(join(home(), 'tilde')); writeFileSync(join(home(), 'file.txt'), 'x');
      const srv2 = await startServer({ store, tmux, port: 0, home: home() });
      const c = await connect({ port: srv2.port }); await c.next('snapshot');
      c.send({ type: 'session.launch', tool: 'claude', cwd: '~/tilde' });
      expect(store.get((await c.next('session.launched')).id)!.cwd).toBe(join(home(), 'tilde'));
      c.send({ type: 'session.launch', tool: 'claude', cwd: '~/nope' });
      expect(await c.next('error')).toEqual({ type: 'error', message: `no such folder: ${join(home(), 'nope')}`, request: 'session.launch' });
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
      c.send({ type: 'folder.list', requestId: 'r-9' });
      expect(await c.next('folder.listing')).toMatchObject({ requestId: 'r-9', path: home() });
      c.send({ type: 'folder.create', parent: '~', name: 'new-project' });
      expect(await c.next('folder.listing')).toEqual({ type: 'folder.listing', path: join(home(), 'new-project'), parent: home(), entries: [], repos: [] });
      c.send({ type: 'folder.create', parent: '~', name: 'new-project' });
      expect(await c.next('folder.listing')).toMatchObject({ path: home(), error: 'already exists: new-project' });
      c.send({ type: 'folder.create', parent: '~', name: 'tagged', requestId: 'c-1' });
      expect(await c.next('folder.listing')).toMatchObject({ requestId: 'c-1', path: join(home(), 'tagged'), parent: home() });
      c.send({ type: 'folder.create', parent: '~', name: 'tagged', requestId: 'c-2' });
      expect(await c.next('folder.listing')).toMatchObject({ requestId: 'c-2', path: home(), error: 'already exists: tagged' });
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
    tmux = fakeTmux({ 'ledge-a': [QUESTION, QUESTION, 'Running…'] }); await srv.close();
    srv = await startServer({ store, tmux, port: 0 });
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
      expect(err).toEqual({ type: 'error', id: 'h', message: 'session started without ledge, read only', request: m.type, code: 'read_only' });
    }
    expect(store.get('h')).toEqual(ro);
    expect(tmux.sent).toEqual([]);
    await expect(c.next('session.updated', 200)).rejects.toThrow(/timeout/);
    c.close();
  });

  describe('refusal codes', () => {
    it('a decision whose expected key is not the current one is refused as stale, its text unchanged', async () => {
      store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.decide', id: 'a', decision: 'accept', expect: { kind: 'permission', text: 'npm test', key: 'not-the-key' } });
      expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: 'the request changed, look again', request: 'session.decide', code: 'stale' });
      expect(tmux.sent).toEqual([]);
      c.close();
    });
    it('a reply to a hook_only session is refused as read_only', async () => {
      store.upsert(mk('h', { tmuxSession: null, source: 'hook_only' }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.reply', id: 'h', text: 'hello' });
      expect(await c.next('error')).toEqual({ type: 'error', id: 'h', message: 'session started without ledge, read only', request: 'session.reply', code: 'read_only' });
      c.close();
    });
    it('a decision with no request is nothing_to_decide; one for an unknown id is unknown_session', async () => {
      store.upsert(mk('a'));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
      expect(await c.next('error')).toEqual({ type: 'error', id: 'a', message: 'nothing to decide', request: 'session.decide', code: 'nothing_to_decide' });
      c.send({ type: 'session.decide', id: 'nope', decision: 'accept' });
      expect(await c.next('error')).toEqual({ type: 'error', id: 'nope', message: 'unknown session', request: 'session.decide', code: 'unknown_session' });
      expect(tmux.sent).toEqual([]);
      c.close();
    });
  });

  it('answers bad input with an error message and keeps serving', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'zzz', decision: 'maybe' } as never);
    const err = await c.next('error');
    expect(err.message).toMatch(/invalid/i);
    expect(err.request).toBe('session.decide'); // the type it carried, though the message did not parse
    expect(err.id).toBe('zzz'); // and its id: the front refuses that very send at once
    c.send({ type: 'session.reply', id: 'y'.repeat(201), text: 42 } as never);
    expect(await c.next('error')).toEqual({ type: 'error', message: 'invalid message', request: 'session.reply', code: 'invalid' }); // too long an id is not echoed
    c.send({ type: 'session.reply', id: 7, text: 'x' } as never);
    expect(await c.next('error')).toEqual({ type: 'error', message: 'invalid message', request: 'session.reply', code: 'invalid' }); // nor one that is not a string
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
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`, { headers: authHeaders() });
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

describe('snapshot capability', () => {
  it('the snapshot announces archive: true', async () => {
    await srv.close();
    srv = await startServer({ store, tmux, port: 0, agentEnv: async () => ({ ...process.env }), daemon: { version: '0.2.2', install: 'npm', systemd: true } });
    const c = await connect({ port: srv.port });
    expect((await c.next('snapshot')).daemon?.archive).toBe(true);
    c.close();
  });
});

describe('update.daemon', () => {
  it('sends the daemon info in the snapshot and routes update.daemon to the updater', async () => {
    await srv.close();
    const seen: string[] = [];
    srv = await startServer({ store, tmux, port: 0, agentEnv: async () => ({ ...process.env }), daemon: { version: '0.2.2', install: 'npm', systemd: true },
      updater: { running: () => false, update: async (v, send) => { seen.push(v); send({ type: 'update.progress', version: v, step: 'installing' }); }, restart: async () => {} } });
    const c = await connect({ port: srv.port });
    const snap = await c.next('snapshot');
    expect(snap.daemon).toEqual({ version: '0.2.2', install: 'npm', systemd: true, routing: true, archive: true, freeShell: true, models: true, modelSwitch: true, commands: true, omp: true, ompApproval: true, openrig: true, openrigRoles: true, openrigRig: true, openrigPolicy: true, openrigFresh: true, ping: true, openrigRows: true, broadcast: true, openrigAsks: true, openrigGoals: true, browserLive: true });
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

describe('session thread (spec 2026-10-13 §5)', () => {
  it('answers a thread request, broadcasts each item, syncs the transcript, records the decision and forgets a removed session', async () => {
    const dir = process.env.LEDGE_HOME!;
    const store = new Store(); const history = new History({ dir: join(dir, 'history') });
    const transcript = join(dir, 'c.jsonl');
    writeFileSync(transcript, JSON.stringify({ uuid: 'u1', timestamp: '2026-10-09T18:00:30.000Z', type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Je lance les tests.' }] } }) + '\n');
    store.upsert(mk('a'));
    const server = await startServer({ store, tmux: fakeTmux({ 'ledge-a': [bashPrompt('pnpm test'), ''] }), port: 0, history });
    const c = await connect({ port: server.port, host: '127.0.0.1', timeoutMs: 2000 });
    await c.next('snapshot', 2000);
    c.send({ type: 'session.thread', id: 'a' });
    expect(await c.next('session.thread', 2000)).toEqual({ type: 'session.thread', id: 'a', items: [] });
    c.send({ type: 'session.event', id: 'a', event: { name: 'UserPromptSubmit', at: T0, source: 'hook', text: 'Lance les tests', transcriptPath: transcript } });
    expect(await c.next('session.thread.item', 2000)).toMatchObject({ id: 'a', item: { kind: 'prompt', text: 'Lance les tests' } });
    c.send({ type: 'session.event', id: 'a', event: { name: 'PreToolUse', at: '2026-10-09T18:01:00.000Z', source: 'hook', tool: 'Bash', text: 'Bash · pnpm test', toolUseId: 'toolu_1', transcriptPath: transcript } });
    expect(await c.next('session.thread.item', 2000)).toMatchObject({ item: { kind: 'message', id: 'msg-u1' } }); // synced before the row
    expect(await c.next('session.thread.item', 2000)).toMatchObject({ item: { kind: 'tool', id: 'toolu_1', status: 'running' } });
    c.send({ type: 'session.event', id: 'a', event: { name: 'PermissionRequest', at: '2026-10-09T18:02:00.000Z', source: 'hook', tool: 'Bash', text: 'pnpm test' } });
    expect(await c.next('session.thread.item', 2000)).toMatchObject({ item: { kind: 'permission', text: 'pnpm test' } });
    await until(() => store.get('a')?.state === 'waiting_permission', 2000);
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    await until(() => history.items('a').some(i => i.kind === 'permission' && i.decision === 'accept'), 2000);
    store.remove('a');
    await until(() => history.items('a').length === 0, 1000);
    c.close(); await server.close();
  });
  it('records no decision when a newer prompt replaced the one decided while the keys were typed', async () => {
    const store = new Store(); const history = new History({ dir: join(process.env.LEDGE_HOME!, 'history') });
    const tmux = fakeTmux({ 'ledge-a': [bashPrompt('pnpm test'), bashPrompt('rm -rf dist')] });
    store.upsert(mk('a'));
    const server = await startServer({ store, tmux, port: 0, history, verify: { attempts: 2, intervalMs: 20 } });
    const c = await connect({ port: server.port, host: '127.0.0.1', timeoutMs: 2000 });
    await c.next('snapshot', 2000);
    c.send({ type: 'session.event', id: 'a', event: { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'pnpm test' } });
    await until(() => store.get('a')?.state === 'waiting_permission', 2000);
    // The agent asks again while the answer is typed: the pane and the pending now show the newer prompt.
    const typed = tmux.sendText.bind(tmux);
    tmux.sendText = async (n, t) => {
      await typed(n, t);
      store.upsert({ ...store.get('a')!, pending: { kind: 'permission', text: 'rm -rf dist', tool: 'Bash', source: 'hook' } });
      history.record('a', { name: 'PermissionRequest', at: '2026-10-09T18:00:05.000Z', source: 'hook', tool: 'Bash', text: 'rm -rf dist' });
    };
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    await until(() => tmux.sent.length === 1, 2000);
    await new Promise(r => setTimeout(r, 200)); // past the verification
    expect(store.get('a')?.pending?.text).toBe('rm -rf dist');
    expect(history.items('a').filter(i => i.kind === 'permission').map(i => i.kind === 'permission' && [i.text, i.decision])).toEqual([['pnpm test', undefined], ['rm -rf dist', undefined]]);
    c.close(); await server.close();
  });
  it('answers an unknown session with an empty thread and works without a history', async () => {
    const store = new Store();
    const server = await startServer({ store, tmux: fakeTmux({}), port: 0 });
    const c = await connect({ port: server.port, host: '127.0.0.1', timeoutMs: 2000 });
    await c.next('snapshot', 2000);
    c.send({ type: 'session.thread', id: 'nope' });
    expect(await c.next('session.thread', 2000)).toEqual({ type: 'session.thread', id: 'nope', items: [] });
    c.close(); await server.close();
  });
});

// Messages are recorded from the moment the socket is created: a snapshot can land while the test awaits a second connection.
const inbox = new WeakMap<WebSocket, ServerMessage[]>();
const open = (port: number, path = '') => new Promise<WebSocket>(r => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { origin: 'tauri://localhost', ...authHeaders() } });
  const got: ServerMessage[] = []; inbox.set(ws, got); ws.on('message', d => got.push(JSON.parse(String(d))));
  ws.on('open', () => r(ws));
});
const collect = (ws: WebSocket) => inbox.get(ws)!;
const dev = { id: 'dev', label: 'Devbox', ssh: 'dev-server' };

const projectsState = {
  projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] }],
  rules: [{ machine: 'dev', path: '/srv/x', project: 'ledge' }]
};

describe('projects', () => {
  it('sends the stored projects right after the machines list', async () => {
    writeProjects(projectsState as Projects);
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0 });
    const ws = await open(s.port); const got = collect(ws);
    await until(() => got.some(m => m.type === 'projects'));
    expect(got.map(m => m.type).slice(0, 3)).toEqual(['snapshot', 'machines', 'projects']);
    expect(got.find(m => m.type === 'projects')).toEqual({ type: 'projects', projects: projectsState });
    ws.close(); await s.close();
  });
  it('projects.set is validated, written first, and broadcast to every local client', async () => {
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0 });
    const a = await open(s.port), b = await open(s.port); const gotA = collect(a), gotB = collect(b);
    await until(() => gotB.some(m => m.type === 'projects'));
    expect(gotB.find(m => m.type === 'projects')).toEqual({ type: 'projects', projects: { projects: [], rules: [] } });
    a.send(JSON.stringify({ type: 'projects.set', projects: projectsState }));
    await until(() => gotB.filter(m => m.type === 'projects').length === 2);
    expect(gotB.filter(m => m.type === 'projects').at(-1)).toEqual({ type: 'projects', projects: projectsState });
    await until(() => gotA.filter(m => m.type === 'projects').length === 2);
    expect(JSON.parse(readFileSync(paths().projects, 'utf8'))).toEqual(projectsState);
    a.close(); b.close(); await s.close();
  });
  it('refuses an invalid projects.set: nothing written, nothing broadcast, an error to the sender', async () => {
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0 });
    const a = await open(s.port), b = await open(s.port); const gotA = collect(a), gotB = collect(b);
    await until(() => gotB.some(m => m.type === 'projects'));
    a.send(JSON.stringify({ type: 'projects.set', projects: { projects: [{ id: 'a', name: 'A', color: 'blue', repos: [] }, { id: 'b', name: 'a', color: 'blue', repos: [] }], rules: [] } }));
    await until(() => gotA.some(m => m.type === 'error'));
    expect(gotB.filter(m => m.type === 'projects')).toHaveLength(1);
    expect(existsSync(paths().projects)).toBe(false);
    a.close(); b.close(); await s.close();
  });
  it('the chat reads the projects the daemon holds at each question: a later projects.set is in the next context', async () => {
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0, agentEnv: async () => ({ ...process.env, FAKE_CLAUDE_MODE: 'projects' }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
    const ws = await open(s.port); const got = collect(ws);
    await until(() => got.some(m => m.type === 'projects'));
    const answer = async (qid: string) => {
      ws.send(JSON.stringify({ type: 'chat.ask', qid, text: 'Which projects?', tool: 'claude' }));
      await until(() => got.some(m => m.type === 'chat.done' && m.qid === qid));
      return (got.find(m => m.type === 'chat.done' && m.qid === qid) as Extract<ServerMessage, { type: 'chat.done' }>).text;
    };
    expect(await answer('q1')).toBe('(no projects.md)');
    ws.send(JSON.stringify({ type: 'projects.set', projects: projectsState }));
    await until(() => got.filter(m => m.type === 'projects').length === 2);
    expect(await answer('q2')).toContain('## Ledge');
    ws.close(); await s.close();
  });
  it('honours a projects file given at start', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'ledge-projects-srv-')), 'projects.json');
    writeProjects(projectsState as Projects, f);
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0, projectsFile: f });
    const ws = await open(s.port); const got = collect(ws);
    await until(() => got.some(m => m.type === 'projects'));
    expect(got.find(m => m.type === 'projects')).toEqual({ type: 'projects', projects: projectsState });
    ws.close(); await s.close();
  });
});

describe('machines list', () => {
  it('follows the snapshot, defaulting to local', async () => {
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0 });
    const ws = await open(s.port); const got = collect(ws);
    await until(() => got.some(m => m.type === 'machines'));
    expect(got.map(m => m.type).slice(0, 2)).toEqual(['snapshot', 'machines']);
    expect(got.find(m => m.type === 'machines')).toEqual({ type: 'machines', machines: [{ id: 'local', label: 'Local' }] });
    ws.close(); await s.close();
  });
  it('machines.set is validated, written, and broadcast to every local client', async () => {
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0 });
    const a = await open(s.port), b = await open(s.port); const gotA = collect(a), gotB = collect(b);
    await until(() => gotB.some(m => m.type === 'machines'));
    a.send(JSON.stringify({ type: 'machines.set', machines: [{ id: 'local', label: 'Local' }, dev] }));
    await until(() => gotB.filter(m => m.type === 'machines').length === 2);
    expect(gotB.at(-1)).toEqual({ type: 'machines', machines: [{ id: 'local', label: 'Local' }, dev] });
    expect(gotA.at(-1)).toEqual(gotB.at(-1));
    expect(JSON.parse(readFileSync(paths().machines, 'utf8'))).toEqual([{ id: 'local', label: 'Local' }, dev]);
    a.close(); b.close(); await s.close();
  });
  it('an invalid list is refused with an error, nothing written nor broadcast', async () => {
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0 });
    const a = await open(s.port), b = await open(s.port); const gotA = collect(a), gotB = collect(b);
    await until(() => gotB.some(m => m.type === 'machines'));
    a.send(JSON.stringify({ type: 'machines.set', machines: [dev, { id: 'local', label: 'Local' }] }));
    a.send(JSON.stringify({ type: 'machines.set', machines: [{ id: 'local', label: 'Local' }, dev, { ...dev, id: 'dev2' }] }));
    await until(() => gotA.filter(m => m.type === 'error').length === 2);
    expect(gotB.filter(m => m.type === 'machines')).toHaveLength(1);
    expect(existsSync(paths().machines)).toBe(false);
    a.close(); b.close(); await s.close();
  });
  it('a second front connecting after a set sees the daemon list, not its own', async () => {
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0 });
    const a = await open(s.port); collect(a);
    a.send(JSON.stringify({ type: 'machines.set', machines: [{ id: 'local', label: 'Local' }, dev] }));
    await until(() => existsSync(paths().machines));
    const b = await open(s.port); const gotB = collect(b);
    await until(() => gotB.some(m => m.type === 'machines'));
    expect(gotB.find(m => m.type === 'machines')).toEqual({ type: 'machines', machines: [{ id: 'local', label: 'Local' }, dev] });
    a.close(); b.close(); await s.close();
  });
  it('is read back from the file at start', async () => {
    writeMachines([{ id: 'local', label: 'Local' }, dev]);
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0 });
    const ws = await open(s.port); const got = collect(ws);
    await until(() => got.some(m => m.type === 'machines'));
    expect(got.find(m => m.type === 'machines')).toEqual({ type: 'machines', machines: [{ id: 'local', label: 'Local' }, dev] });
    ws.close(); await s.close();
  });
  it('a failing write leaves the list unchanged, nothing broadcast, and reports the error to the sender', async () => {
    const bad = join(process.env.LEDGE_HOME!, 'missing-dir', 'machines.json');
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0, machinesFile: bad });
    const a = await open(s.port), b = await open(s.port); const gotA = collect(a), gotB = collect(b);
    await until(() => gotB.some(m => m.type === 'machines'));
    a.send(JSON.stringify({ type: 'machines.set', machines: [{ id: 'local', label: 'Local' }, dev] }));
    await until(() => gotA.some(m => m.type === 'error'));
    expect(gotB.filter(m => m.type === 'machines')).toHaveLength(1);
    const c = await open(s.port); const gotC = collect(c);
    await until(() => gotC.some(m => m.type === 'machines'));
    expect(gotC.find(m => m.type === 'machines')).toEqual({ type: 'machines', machines: [{ id: 'local', label: 'Local' }] });
    a.close(); b.close(); c.close(); await s.close();
  });
  it('refuses a /ssh/ client with an invalid alias at the upgrade and keeps serving', async () => {
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0, ssh: async () => {} });
    const bad = new WebSocket(`ws://127.0.0.1:${s.port}/ssh/bad%20alias!`, { headers: { origin: 'tauri://localhost', ...authHeaders() } });
    const err = await new Promise<Error>(r => bad.on('error', r));
    expect(err.message).toContain('401'); // verifyClient already rejects it, so the handler's 1008 branch is a defensive backstop
    const a = await open(s.port); const gotA = collect(a);
    await until(() => gotA.some(m => m.type === 'snapshot'));
    a.close(); await s.close();
  });
  it('routes /ssh/<alias>?q=1 like /ssh/<alias>', async () => {
    const aliases: string[] = [];
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0, ssh: async (_ws, alias) => { aliases.push(alias); } });
    const r = await open(s.port, '/ssh/dev-server?q=1');
    await until(() => aliases.length === 1);
    expect(aliases).toEqual(['dev-server']);
    r.close(); await s.close();
  });
  it('logs once when machines.json exists but is invalid', async () => {
    const f = join(process.env.LEDGE_HOME!, 'machines.json'); writeFileSync(f, '{"trunc');
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0, machinesFile: f });
    await s.close();
    const text = readFileSync(join(process.env.LEDGE_HOME!, 'daemon.log'), 'utf8');
    expect(text.match(/machines\.json is invalid/g)).toHaveLength(1);
  });
  it('ssh clients neither receive machines nor may set them', async () => {
    // The real chain (serveSsh/bridge) drops machines frames: see ssh-transport.test.ts. Here the daemon side only.
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0, ssh: async () => {} });
    const r = await open(s.port, '/ssh/dev-server'); const gotR = collect(r);
    const a = await open(s.port); const gotA = collect(a);
    await until(() => gotA.some(m => m.type === 'machines'));
    r.send(JSON.stringify({ type: 'machines.set', machines: [{ id: 'local', label: 'Local' }, dev] }));
    a.send(JSON.stringify({ type: 'snapshot.request' }));
    await until(() => gotA.filter(m => m.type === 'machines').length === 2);
    expect(gotR.some(m => m.type === 'machines')).toBe(false);
    expect(existsSync(paths().machines)).toBe(false);
    r.close(); a.close(); await s.close();
  });
});

describe('island settings', () => {
  const prefs = { ...DEFAULT_ISLAND_PREFS, position: 'left' as const, shows: { ...DEFAULT_ISLAND_PREFS.shows, say: false } };
  it('sends null after the projects while none was set', async () => {
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0 });
    const ws = await open(s.port); const got = collect(ws);
    await until(() => got.some(m => m.type === 'island'));
    expect(got.map(m => m.type).slice(0, 4)).toEqual(['snapshot', 'machines', 'projects', 'island']);
    expect(got.find(m => m.type === 'island')).toEqual({ type: 'island', prefs: null });
    ws.close(); await s.close();
  });
  it('island.set is written first, broadcast to every local client and read back on the next start', async () => {
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0 });
    const a = await open(s.port), b = await open(s.port); const gotB = collect(b);
    await until(() => gotB.some(m => m.type === 'island'));
    a.send(JSON.stringify({ type: 'island.set', prefs }));
    await until(() => gotB.filter(m => m.type === 'island').length === 2);
    expect(gotB.filter(m => m.type === 'island').at(-1)).toEqual({ type: 'island', prefs });
    expect(JSON.parse(readFileSync(paths().island, 'utf8'))).toEqual(prefs);
    a.close(); b.close(); await s.close();
    const again = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0 });
    const c = await open(again.port); const gotC = collect(c);
    await until(() => gotC.some(m => m.type === 'island'));
    expect(gotC.find(m => m.type === 'island')).toEqual({ type: 'island', prefs });
    c.close(); await again.close();
  });
  it('refuses an invalid island.set: nothing written, nothing broadcast', async () => {
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0 });
    const a = await open(s.port), b = await open(s.port); const gotA = collect(a), gotB = collect(b);
    await until(() => gotB.some(m => m.type === 'island'));
    a.send(JSON.stringify({ type: 'island.set', prefs: { ...prefs, islandScale: 3 } }));
    await until(() => gotA.some(m => m.type === 'error'));
    expect(gotB.filter(m => m.type === 'island')).toHaveLength(1);
    expect(existsSync(paths().island)).toBe(false);
    a.close(); b.close(); await s.close();
  });
});

describe('mobile access', () => {
  const withMobile = async () => {
    const mobile = await createMobileService();
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0, mobile, daemon: { version: '0.2.2', install: 'npm', systemd: true } });
    return { s, mobile, close: async () => { await s.close(); await mobile.stop(); } };
  };
  it('a local client gets the mobile state right after the island, and the daemon info says mobile: true', async () => {
    const m = await withMobile();
    const ws = await open(m.s.port); const got = collect(ws);
    await until(() => got.some(x => x.type === 'mobile'));
    expect(got.map(x => x.type).slice(0, 5)).toEqual(['snapshot', 'machines', 'projects', 'island', 'mobile']);
    expect(got.find(x => x.type === 'mobile')).toMatchObject({ type: 'mobile', state: { enabled: false, account: null, link: { state: 'off' }, devices: [], pairings: [] } });
    const snap = got.find(x => x.type === 'snapshot');
    expect(snap?.type === 'snapshot' && snap.daemon?.mobile).toBe(true);
    ws.close(); await m.close();
  });
  it('a mobile service that failed to start shows as unavailable, and its commands are refused with code unavailable and no id', async () => {
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0, mobileUnavailable: 'EACCES', daemon: { version: '0.2.2', install: 'npm', systemd: true } });
    const ws = await open(s.port); const got = collect(ws);
    await until(() => got.some(x => x.type === 'mobile'));
    expect(got.find(x => x.type === 'mobile')).toMatchObject({ state: { enabled: false, link: { state: 'unavailable', error: 'EACCES' }, devices: [], pairings: [] } });
    const snap = got.find(x => x.type === 'snapshot');
    expect(snap?.type === 'snapshot' && snap.daemon?.mobile).toBe(true);
    ws.send(JSON.stringify({ type: 'mobile.signin' }));
    await until(() => got.some(x => x.type === 'error'));
    const err = got.find(x => x.type === 'error');
    expect(err).toMatchObject({ type: 'error', request: 'mobile.signin', code: 'unavailable' });
    expect(err).not.toHaveProperty('id');
    ws.close(); await s.close();
  });
  it('mobile.pairing.approve on an unknown id is refused with request: mobile.pairing.approve', async () => {
    const m = await withMobile();
    const ws = await open(m.s.port); const got = collect(ws);
    await until(() => got.some(x => x.type === 'mobile'));
    ws.send(JSON.stringify({ type: 'mobile.pairing.approve', id: 'nope' }));
    await until(() => got.some(x => x.type === 'error'));
    const err = got.find(x => x.type === 'error');
    expect(err).toMatchObject({ type: 'error', request: 'mobile.pairing.approve' });
    expect(err).not.toHaveProperty('id'); // a pairing id is not a session's: a front must not fail a session with it
    ws.close(); await m.close();
  });
  it('a change is broadcast to local clients, never to a /ssh/ client', async () => {
    const mobile = await createMobileService();
    const s = await startServer({ store: new Store(), tmux: fakeTmux({}), port: 0, mobile, ssh: async () => {} });
    const r = await open(s.port, '/ssh/dev-server'); const gotR = collect(r);
    const a = await open(s.port); const gotA = collect(a);
    await until(() => gotA.some(x => x.type === 'mobile'));
    a.send(JSON.stringify({ type: 'mobile.set', enabled: false, relayUrl: 'http://localhost:1' }));
    await until(() => gotA.filter(x => x.type === 'mobile').length >= 2);
    expect(gotA.filter(x => x.type === 'mobile').at(-1)).toMatchObject({ state: { relayUrl: 'http://localhost:1' } });
    await new Promise(res => setTimeout(res, 100));
    expect(gotR.some(x => x.type === 'mobile')).toBe(false);
    r.close(); a.close(); await s.close(); await mobile.stop();
  });
  it('a request on a session pushes a hidden phone and not a visible one (store.onApply -> notifier -> gateway.visible)', async () => {
    const { createECDH, randomBytes } = await import('node:crypto');
    const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url'), key: 'K1' };
    const messageFns = new Set<(d: string, t: string) => void>();
    const sends: unknown[] = [];
    const state = { enabled: true, relayUrl: 'https://relay.test', account: null, signin: null, signinError: null, link: { state: 'online' }, devices: [{ id: 'dev1', label: 'dev1', approvedAt: T0, online: true }], pairings: [] };
    const mobile = {
      state: () => state, onChange: () => () => {}, onRecovery: () => () => {}, handle: async () => {}, send: async () => true, revoke: async () => {},
      credential: () => null, setCredential: () => {}, pushOf: (id: string) => (id === 'dev1' ? sub : null), setPush: () => {}, relayPushKey: () => 'K1',
      sendPush: async (m: unknown) => { sends.push(m); return { result: 'sent' as const }; },
      onMessage: (fn: (d: string, t: string) => void) => { messageFns.add(fn); return () => { messageFns.delete(fn); }; },
      stop: async () => {}
    } as unknown as Parameters<typeof startServer>[0]['mobile'];
    const store = new Store();
    store.upsert(mk('s1'));
    const s = await startServer({ store, tmux: fakeTmux({}), port: 0, mobile, daemon: { version: '0.2.2', install: 'npm', systemd: true } });
    const ask = (n: number) => {
      store.apply('s1', { name: 'PermissionRequest', at: `2026-10-09T18:0${n}:00.000Z`, source: 'hook', tool: 'Bash', toolInput: { command: `ls ${n}` } } as never);
    };
    const clear = (n: number) => { store.apply('s1', { name: 'Stop', at: `2026-10-09T18:0${n}:30.000Z`, source: 'hook' }); };
    const presence = (visible: boolean) => { for (const fn of messageFns) fn('dev1', JSON.stringify({ type: 'presence', visible })); };
    expect(store.get('s1')?.pending).toBeUndefined();
    ask(1);
    expect(store.get('s1')?.pending).toBeDefined();
    await until(() => sends.length === 1);
    clear(1);
    presence(true);
    ask(2);
    await new Promise(res => setTimeout(res, 100));
    expect(sends).toHaveLength(1); // the visible phone heard nothing
    clear(2);
    presence(false);
    ask(3);
    await until(() => sends.length === 2);
    await s.close();
    clear(3);
    ask(4);
    await new Promise(res => setTimeout(res, 100));
    expect(sends).toHaveLength(2); // closing removed the listener
  });
  it('the phone\'s Atelier: the daemon\'s projects in the snapshot, and a projects.set from the desktop reaches the phone placed', async () => {
    const messageFns = new Set<(d: string, t: string) => void>();
    const phone: Array<{ type: string; [k: string]: unknown }> = [];
    const raw: string[] = [];
    const state = { enabled: true, relayUrl: 'https://relay.test', account: null, signin: null, signinError: null, link: { state: 'online' }, devices: [{ id: 'dev1', label: 'dev1', approvedAt: T0, online: true }], pairings: [] };
    const mobile = {
      state: () => state, onChange: () => () => {}, onRecovery: () => () => {}, handle: async () => {}, revoke: async () => {},
      send: async (_d: string, t: string) => { raw.push(t); phone.push(JSON.parse(t)); return true; },
      credential: () => null, setCredential: () => {}, pushOf: () => null, setPush: () => {}, relayPushKey: () => 'K1',
      sendPush: async () => ({ result: 'sent' as const }),
      onMessage: (fn: (d: string, t: string) => void) => { messageFns.add(fn); return () => { messageFns.delete(fn); }; },
      stop: async () => {}
    } as unknown as Parameters<typeof startServer>[0]['mobile'];
    const store = new Store();
    store.upsert(mk('s1', { cwd: '/w/ledge/app' }));
    const s = await startServer({ store, tmux: fakeTmux({}), port: 0, mobile, daemon: { version: '0.2.2', install: 'npm', systemd: true } });
    for (const fn of messageFns) fn('dev1', JSON.stringify({ type: 'snapshot.request' }));
    await until(() => phone.some(m => m.type === 'snapshot'));
    expect(phone.find(m => m.type === 'snapshot')).toMatchObject({ daemon: { atelier: true }, projects: [] });
    expect((phone.find(m => m.type === 'snapshot')!.sessions as Array<object>)[0]).not.toHaveProperty('projectId');
    const ws = await open(s.port);
    ws.send(JSON.stringify({ type: 'projects.set', projects: projectsState }));
    await until(() => phone.some(m => m.type === 'session.updated'));
    const after = phone.slice(phone.findIndex(m => m.type === 'snapshot') + 1).filter(m => m.type !== 'tasks');
    expect(after.map(m => m.type)).toEqual(['projects', 'session.updated']);
    expect(after[0]).toEqual({ type: 'projects', projects: [{ id: 'ledge', name: 'Ledge', color: 'blue' }] });
    expect(after[1]).toMatchObject({ session: { id: 's1', projectId: 'ledge' } });
    for (const t of raw) for (const secret of ['/w/', '/srv/', '"rules"', '"repos"']) expect(t).not.toContain(secret);
    ws.close(); await s.close();
  });
  it('without the service, mobile messages are refused as not available', async () => {
    const ws = await open(srv.port); const got = collect(ws);
    await until(() => got.some(x => x.type === 'island'));
    ws.send(JSON.stringify({ type: 'mobile.signin' }));
    await until(() => got.some(x => x.type === 'error'));
    expect(got.find(x => x.type === 'error')).toMatchObject({ message: 'mobile access is not available', request: 'mobile.signin' });
    expect(got.some(x => x.type === 'mobile')).toBe(false);
    ws.close();
  });
});

describe('server: models.list (#58)', () => {
  it('answers with the machine\'s catalog, or its error, under the requestId; the snapshot says the daemon knows models', async () => {
    const asked: string[] = [];
    const srv2 = await startServer({ store, tmux, port: 0, daemon: { version: '1.0.0', install: 'npm', systemd: false }, models: { async list(tool) { asked.push(tool); return tool === 'codex' ? { models: [], error: 'not installed' } : { models: [{ id: 'opus', label: 'Opus', isDefault: true }] }; } } });
    const c = await connect({ port: srv2.port });
    expect((await c.next('snapshot')).daemon).toMatchObject({ models: true });
    c.send({ type: 'models.list', requestId: 'r1', tool: 'claude' });
    expect(await c.next('models.listing')).toEqual({ type: 'models.listing', requestId: 'r1', tool: 'claude', models: [{ id: 'opus', label: 'Opus', isDefault: true }] });
    c.send({ type: 'models.list', requestId: 'r2', tool: 'codex' });
    expect(await c.next('models.listing')).toEqual({ type: 'models.listing', requestId: 'r2', tool: 'codex', models: [], error: 'not installed' });
    expect(asked).toEqual(['claude', 'codex']);
    c.close(); await srv2.close();
  });
});

/** An OpenRig fake's roles, when a test does not look at them. */
const NO_ROLES = { async roles() { return { roles: [] }; }, async role() { return { error: 'role_not_found' }; }, async roleFile() { return { error: 'not_allowed' }; }, async duplicateRole() { return { ok: false, error: 'x' }; }, async graph() { return { error: 'unknown_rig' }; }, async snapshots() { return { error: 'unknown_rig' }; }, async permissions() { return { error: 'unknown_rig' }; }, async queue() { return { rows: [], truncated: false, error: 'unknown_rig' }; } };

describe('server: OpenRig', () => {
  it('answers a status under its requestId; an action answers its sender, then every front gets the fresh state', async () => {
    const acts: unknown[] = []; let fresh = 0;
    const state = (s: 'running' | 'stopped') => ({ installed: true, daemon: { state: s }, kernel: { state: 'stopped' as const }, rigs: [], at: '2026-11-02T09:00:00.000Z' });
    const srv2 = await startServer({ store, tmux, port: 0, daemon: { version: '1.0.0', install: 'npm', systemd: false }, openrig: { row: async () => ({ error: 'not_found' }),
      async state(f) { if (f) fresh++; return state(f ? 'stopped' : 'running'); },
      async act(a) { acts.push(a); return { ok: true, commands: ['rig daemon stop'] }; },
      async specs() { return { specs: [] }; },
      async launch() { return { ok: true, plan: true, commands: [] }; },
      async reseat() { return { ok: true, commands: [], added: [], removed: [] }; }, ...NO_ROLES
    } });
    const c = await connect({ port: srv2.port }), other = await connect({ port: srv2.port });
    expect((await c.next('snapshot')).daemon).toMatchObject({ openrig: true });
    await other.next('snapshot');
    c.send({ type: 'openrig.status', requestId: 'r1' });
    expect(await c.next('openrig.state')).toEqual({ type: 'openrig.state', requestId: 'r1', state: state('running') });
    c.send({ type: 'openrig.act', requestId: 'r2', action: { kind: 'daemon.stop' } });
    expect(await c.next('openrig.done')).toEqual({ type: 'openrig.done', requestId: 'r2', ok: true, commands: ['rig daemon stop'] });
    expect(await other.next('openrig.state')).toEqual({ type: 'openrig.state', state: state('stopped') });
    expect(acts).toEqual([{ kind: 'daemon.stop' }]);
    expect(fresh).toBe(1);
    c.close(); other.close(); await srv2.close();
  });
  it('a ping answers a pong with the same requestId, to its sender only', async () => {
    const c = await connect({ port: srv.port }), other = await connect({ port: srv.port });
    await c.next('snapshot'); await other.next('snapshot');
    c.send({ type: 'ping', requestId: 'p1', machineId: 'server' } as never);
    expect(await c.next('pong')).toEqual({ type: 'pong', requestId: 'p1' });
    c.close(); other.close();
  });
  it('roles, a role and a role file answer their asker only, under its requestId, with the id and path asked', async () => {
    const asked: string[] = [];
    const summary = { id: 'f95e', name: 'ledge-lead', source: 'user' as const, path: '/s/lead/agent.yaml', importOnly: false, seats: 1, running: 1, skills: [], startupFiles: ['guidance/role.md'], seatRefs: [{ rig: 'ledge-dev', logicalId: 'pilot.lead', session: 'pilot-lead@ledge-dev' }] };
    const srv2 = await startServer({ store, tmux, port: 0, daemon: { version: '1.0.0', install: 'npm', systemd: false }, openrig: { async graph() { return { error: 'unknown_rig' }; }, async snapshots() { return { error: 'unknown_rig' }; }, async permissions() { return { error: 'unknown_rig' }; }, async queue() { return { rows: [], truncated: false, error: 'unknown_rig' }; }, row: async () => ({ error: 'not_found' }),
      async state() { return { installed: true, daemon: { state: 'running' as const }, kernel: { state: 'ready' as const }, rigs: [], at: '2026-11-02T09:00:00.000Z' }; },
      async act() { return { ok: true, commands: [] }; }, async specs() { return { specs: [] }; },
      async launch() { return { ok: true, plan: true, commands: [] }; }, async reseat() { return { ok: true, commands: [], added: [], removed: [] }; },
      async roles() { asked.push('roles'); return { roles: [summary], openrigVersion: '0.7.7' }; },
      async role(id) { asked.push(`role ${id}`); return { error: 'role_not_found' }; },
      async roleFile(id, path) { asked.push(`file ${id} ${path}`); return { content: '# Rôle', size: 7 }; },
      async duplicateRole(id, name) { asked.push(`dup ${id} ${name}`); return { ok: true, roleId: 'abc1', path: '/p/mine' }; }
    } });
    const c = await connect({ port: srv2.port }), other = await connect({ port: srv2.port });
    expect((await c.next('snapshot')).daemon).toMatchObject({ openrig: true, openrigRoles: true });
    await other.next('snapshot');
    c.send({ type: 'openrig.roles', requestId: 'r1' });
    expect(await c.next('openrig.roleList')).toEqual({ type: 'openrig.roleList', requestId: 'r1', roles: [summary], openrigVersion: '0.7.7' });
    c.send({ type: 'openrig.role.duplicate', requestId: 'r9', roleId: 'f95e', name: 'mine' });
    expect(await c.next('openrig.roleDuplicated')).toEqual({ type: 'openrig.roleDuplicated', requestId: 'r9', ok: true, roleId: 'abc1', path: '/p/mine' });
    expect(asked).toContain('dup f95e mine');
    await expect(other.next('openrig.roleDuplicated', 150)).rejects.toThrow();
    c.send({ type: 'openrig.role', requestId: 'r2', roleId: 'nope' });
    expect(await c.next('openrig.roleDetail')).toEqual({ type: 'openrig.roleDetail', requestId: 'r2', roleId: 'nope', error: 'role_not_found' });
    c.send({ type: 'openrig.roleFile', requestId: 'r3', roleId: 'f95e', path: '/s/lead/guidance/role.md' });
    expect(await c.next('openrig.roleFileContent')).toEqual({ type: 'openrig.roleFileContent', requestId: 'r3', roleId: 'f95e', path: '/s/lead/guidance/role.md', content: '# Rôle', size: 7 });
    expect(asked).toEqual(['roles', 'dup f95e mine', 'role nope', 'file f95e /s/lead/guidance/role.md']);
    await expect(other.next('openrig.roleList', 150)).rejects.toThrow();
    c.close(); other.close(); await srv2.close();
  });
  it('a queue row answers its asker only, under its requestId', async () => {
    const asked: string[] = [];
    const row = { id: 'qitem-20261102205801-ae61eb9d7f1f4b49', state: 'in-progress', from: 'pilot-lead@ledge-dev-2', to: 'dev-back@ledge-dev-2', createdAt: 'a', updatedAt: 'b', at: 'c' };
    const srv2 = await startServer({ store, tmux, port: 0, daemon: { version: '1.0.0', install: 'npm', systemd: false }, openrig: { async graph() { return { error: 'unknown_rig' }; }, async snapshots() { return { error: 'unknown_rig' }; }, async permissions() { return { error: 'unknown_rig' }; }, async queue() { return { rows: [], truncated: false, error: 'unknown_rig' }; },
      async row(q) { asked.push(q); return q === row.id ? { row } : { error: 'not_found' }; },
      async state() { return { installed: true, daemon: { state: 'running' as const }, kernel: { state: 'ready' as const }, rigs: [], at: '2026-11-02T09:00:00.000Z' }; },
      async act() { return { ok: true, commands: [] }; }, async specs() { return { specs: [] }; },
      async launch() { return { ok: true, plan: true, commands: [] }; }, async reseat() { return { ok: true, commands: [], added: [], removed: [] }; },
      async roles() { return { roles: [] }; }, async role() { return { error: 'x' }; }, async roleFile() { return { error: 'x' }; }, async duplicateRole() { return { ok: false, error: 'x' }; }
    } });
    const c = await connect({ port: srv2.port }), other = await connect({ port: srv2.port });
    expect((await c.next('snapshot')).daemon).toMatchObject({ openrigRows: true });
    await other.next('snapshot');
    c.send({ type: 'openrig.row', requestId: 'w1', qitem: row.id });
    expect(await c.next('openrig.rowState')).toEqual({ type: 'openrig.rowState', requestId: 'w1', qitem: row.id, row });
    c.send({ type: 'openrig.row', requestId: 'w2', qitem: 'qitem-gone' });
    expect(await c.next('openrig.rowState')).toEqual({ type: 'openrig.rowState', requestId: 'w2', qitem: 'qitem-gone', error: 'not_found' });
    expect(asked).toEqual([row.id, 'qitem-gone']);
    await expect(other.next('openrig.rowState', 150)).rejects.toThrow();
    c.close(); other.close(); await srv2.close();
  });
});

describe('server: OpenRig queue', () => {
  it('a rig\'s queue answers its asker only, under its requestId, with the rig asked', async () => {
    const asked: string[] = [];
    const row = { id: 'qitem-20261108150012-1a2b3c4d5e6f7a8b', state: 'pending', from: 'a@kernel', to: 'dev-build@x', createdAt: 'a', updatedAt: 'b', at: 'c', needsInput: { count: 1, reason: 'permission_prompt' } };
    const srv2 = await startServer({ store, tmux, port: 0, daemon: { version: '1.0.0', install: 'npm', systemd: false }, openrig: { ...NO_ROLES, row: async () => ({ error: 'not_found' }),
      async queue(rig: string) { asked.push(rig); return { rows: [row], truncated: true }; },
      async state() { return { installed: true, daemon: { state: 'running' as const }, kernel: { state: 'ready' as const }, rigs: [], at: '2026-11-02T09:00:00.000Z' }; },
      async act() { return { ok: true, commands: [] }; }, async specs() { return { specs: [] }; },
      async launch() { return { ok: true, plan: true, commands: [] }; }, async reseat() { return { ok: true, commands: [], added: [], removed: [] }; }
    } });
    const c = await connect({ port: srv2.port }), other = await connect({ port: srv2.port });
    await c.next('snapshot'); await other.next('snapshot');
    c.send({ type: 'openrig.queue', requestId: 'q1', rig: 'x' });
    expect(await c.next('openrig.queueState')).toEqual({ type: 'openrig.queueState', requestId: 'q1', rig: 'x', rows: [row], truncated: true });
    expect(asked).toEqual(['x']);
    await expect(other.next('openrig.queueState', 150)).rejects.toThrow();
    c.close(); other.close(); await srv2.close();
  });
});

describe('server: « À toi »', () => {
  it('openrig.asks answers its asker and starts following; a change goes to every front; openrig.answer answers its asker', async () => {
    const list = { channel: { state: 'ready' as const, person: { address: 'ledge@external', name: 'Ledge' }, slack: false }, asks: [] };
    let push: ((l: typeof list) => void) | null = null;
    const answered: string[] = [];
    const srv2 = await startServer({ store, tmux, port: 0, human: {
      async list() { return list; },
      async answer(qitemId, a) { answered.push(`${qitemId} ${a.kind}`); return { qitemId, ok: true, outcome: 'answered' as const, replyId: 'qitem-reply' }; },
      start(fn) { push = fn; }, stop() {}
    } });
    const c = await connect({ port: srv2.port }), other = await connect({ port: srv2.port });
    await c.next('snapshot'); await other.next('snapshot');
    expect(push).toBeNull();
    c.send({ type: 'openrig.asks', requestId: 'r1' });
    expect(await c.next('openrig.asksChanged')).toEqual({ type: 'openrig.asksChanged', requestId: 'r1', ...list });
    expect(push).not.toBeNull();
    push!({ ...list, channel: { ...list.channel, slack: true } });
    expect((await other.next('openrig.asksChanged')).channel?.slack).toBe(true);
    c.send({ type: 'openrig.answer', requestId: 'r2', qitemId: 'qitem-1', answer: { kind: 'words', text: 'Oui' } });
    expect(await c.next('openrig.answered')).toEqual({ type: 'openrig.answered', requestId: 'r2', qitemId: 'qitem-1', ok: true, outcome: 'answered', replyId: 'qitem-reply' });
    expect(answered).toEqual(['qitem-1 words']);
    c.close(); other.close(); await srv2.close();
  });
});

describe('server: goals to Max', () => {
  it('openrig.goals answers its asker and is pushed after a send; goal.send and goal.reply answer their asker', async () => {
    const goal = (goalId: string) => ({ goalId, qitemId: `qitem-ledge-goal-${goalId}`, text: 'La pochette', folder: null, sentAt: 't', to: 'operator-agent@kernel',
      state: 'sent' as const, proposal: null, question: null, trail: [], current: null });
    let goals: Array<ReturnType<typeof goal>> = [];
    const sent: string[] = [];
    const srv2 = await startServer({ store, tmux, port: 0,
      human: { async list() { return { channel: { state: 'ready' as const, person: null, slack: false }, asks: [] }; }, async answer(q) { return { qitemId: q, ok: true }; }, start() {}, stop() {} },
      goals: {
        async send(goalId, text) { sent.push(`send ${goalId} ${text}`); goals = [goal(goalId)]; return { ok: true, qitemId: `qitem-ledge-goal-${goalId}` }; },
        async reply(goalId, replyId) { sent.push(`reply ${goalId} ${replyId}`); return { ok: false, error: 'uncertain' as const, message: 'lost' }; },
        async list() { return { goals }; }
      } });
    const c = await connect({ port: srv2.port }), other = await connect({ port: srv2.port });
    expect((await c.next('snapshot')).daemon).toBeUndefined();
    await other.next('snapshot');
    c.send({ type: 'openrig.goals', requestId: 'g1' });
    expect(await c.next('openrig.goalsChanged')).toEqual({ type: 'openrig.goalsChanged', requestId: 'g1', goals: [] });
    c.send({ type: 'openrig.goal.send', requestId: 'g2', goalId: 'abcdef12-0000', text: 'La pochette' });
    expect(await c.next('openrig.goal.sent')).toEqual({ type: 'openrig.goal.sent', requestId: 'g2', goalId: 'abcdef12-0000', ok: true, qitemId: 'qitem-ledge-goal-abcdef12-0000' });
    expect((await other.next('openrig.goalsChanged', 3000)).goals).toEqual([goal('abcdef12-0000')]);
    c.send({ type: 'openrig.goal.reply', requestId: 'g3', goalId: 'abcdef12-0000', replyId: 'fedcba98-0000', text: 'Prends Ida' });
    expect(await c.next('openrig.goal.replied')).toEqual({ type: 'openrig.goal.replied', requestId: 'g3', goalId: 'abcdef12-0000', replyId: 'fedcba98-0000', ok: false, error: 'uncertain', message: 'lost' });
    expect(sent).toEqual(['send abcdef12-0000 La pochette', 'reply abcdef12-0000 fedcba98-0000']);
    c.close(); other.close(); await srv2.close();
  });
});

describe('server: OpenRig seats as sessions', () => {
  it('a hook from an OpenRig seat tags its session with the rig, then the role OpenRig gives it', async () => {
    const node = { logicalId: 'dev.build', session: 'dev-build@first-factory', runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'running', stopped: false, work: 0 };
    const srv2 = await startServer({ store, tmux, port: 0, openrig: { row: async () => ({ error: 'not_found' }),
      async state() { return { installed: true, daemon: { state: 'running' }, kernel: { state: 'ready' }, at: '2026-11-02T09:00:00.000Z', rigs: [{ id: 'R', name: 'first-factory', status: 'running', lifecycleState: 'running', seats: 1, running: 1, attention: 0, uptime: null, snapshot: null, nodes: [node] }] }; },
      async act() { return { ok: true, commands: [] }; }, async specs() { return { specs: [] }; },
      async launch() { return { ok: true, plan: true, commands: [] }; }, async reseat() { return { ok: true, commands: [], added: [], removed: [] }; }, ...NO_ROLES
    } });
    const c = await connect({ port: srv2.port });
    await c.next('snapshot');
    c.send({ type: 'session.event', id: 'seat-1', agent: 'claude', cwd: '/w/ledge', rigSeat: 'dev-build@first-factory', event: { name: 'UserPromptSubmit', at: '2026-11-02T10:57:00.000Z', source: 'hook', text: 'go' } });
    await vi.waitFor(() => expect(store.get('seat-1')?.rig).toEqual({ seat: 'dev-build@first-factory', name: 'first-factory', role: 'dev.build' }));
    expect(store.get('seat-1')?.source).toBe('hook_only');
    // A seat name rig could not have made is not taken.
    c.send({ type: 'session.event', id: 'seat-2', agent: 'claude', cwd: '/w', rigSeat: '--x', event: { name: 'UserPromptSubmit', at: '2026-11-02T10:57:00.000Z', source: 'hook', text: 'go' } } as never);
    await new Promise(r => setTimeout(r, 50));
    expect(store.get('seat-2')).toBeUndefined();
    c.close(); await srv2.close();
  });
});

describe('server: an OpenRig seat answered through its pane', () => {
  it('becomes a rig session on its pane: written to like Ledge\'s own, never killed, closed nor resumed by Ledge', async () => {
    const seatTmux = fakeTmux({ 'dev-build@first-factory': ['❯ '] });
    const srv2 = await startServer({ store, tmux: seatTmux, port: 0, openrig: { row: async () => ({ error: 'not_found' }),
      async state() { return { installed: true, daemon: { state: 'running' }, kernel: { state: 'ready' }, at: '2026-11-02T09:00:00.000Z', rigs: [] }; },
      async act() { return { ok: true, commands: [] }; }, async specs() { return { specs: [] }; },
      async launch() { return { ok: true, plan: true, commands: [] }; }, async reseat() { return { ok: true, commands: [], added: [], removed: [] }; }, ...NO_ROLES
    } });
    const c = await connect({ port: srv2.port });
    await c.next('snapshot');
    c.send({ type: 'session.event', id: 'seat-1', agent: 'claude', cwd: '/w/ledge', rigSeat: 'dev-build@first-factory', event: { name: 'UserPromptSubmit', at: '2026-11-02T10:57:00.000Z', source: 'hook', text: 'go' } });
    await vi.waitFor(() => expect(store.get('seat-1')).toMatchObject({ source: 'rig', tmuxSession: 'dev-build@first-factory' }));
    c.send({ type: 'session.kill', id: 'seat-1' });
    expect(await c.next('error')).toMatchObject({ id: 'seat-1', code: 'read_only' });
    expect(seatTmux.sent.some(x => x[0] === 'kill')).toBe(false);
    c.send({ type: 'session.reply', id: 'seat-1', text: 'continue' });
    await vi.waitFor(() => expect(seatTmux.sent.some(x => x[1] === 'dev-build@first-factory' && x.includes('continue'))).toBe(true));
    c.close(); await srv2.close();
  });
});

describe('server: an idle seat recognised before', () => {
  it('is put on its pane at start, without waiting for a hook', async () => {
    store.upsert({ id: 'seat-9', name: 'Otto-49', tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: 'untracked session', tmuxSession: null, state: 'idle', helpers: [],
      startedAt: '2026-11-02T10:00:00.000Z', lastActivityAt: '2026-11-02T10:00:00.000Z', source: 'hook_only', rig: { seat: 'dev-build@first-factory', name: 'first-factory', role: 'dev.build' } });
    const srv2 = await startServer({ store, tmux: fakeTmux({ 'dev-build@first-factory': ['❯ '] }), port: 0 });
    await vi.waitFor(() => expect(store.get('seat-9')).toMatchObject({ source: 'rig', tmuxSession: 'dev-build@first-factory' }));
    await srv2.close();
  });
});

describe('server: a seat found again after its rig restarted', () => {
  it('comes back as the session it had, not a new one under a new name', async () => {
    store.upsert({ id: 'claude-conv-old', name: 'Bix', tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: 'Bix', tmuxSession: 'dev-build@first-factory', state: 'exited', helpers: [],
      startedAt: '2026-11-02T10:00:00.000Z', lastActivityAt: '2026-11-02T10:30:00.000Z', exitedAt: '2026-11-02T10:30:00.000Z', source: 'rig', rig: { seat: 'dev-build@first-factory', name: 'first-factory', role: 'dev.build' } });
    const node = { logicalId: 'dev.build', session: 'dev-build@first-factory', runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0 };
    const state = { installed: true, daemon: { state: 'running' as const }, kernel: { state: 'ready' as const }, at: '2026-11-02T11:00:00.000Z', rigs: [{ id: 'F', name: 'first-factory', status: 'running', lifecycleState: 'running', seats: 1, running: 1, attention: 0, uptime: null, snapshot: null, nodes: [node] }] };
    const srv2 = await startServer({ store, tmux: fakeTmux({ 'dev-build@first-factory': ['❯ '] }), port: 0, openrig: { row: async () => ({ error: 'not_found' }),
      async state() { return state; }, async act() { return { ok: true, commands: [] }; }, async specs() { return { specs: [] }; },
      async launch() { return { ok: true, plan: true, commands: [] }; }, async reseat() { return { ok: true, commands: [], added: [], removed: [] }; }, ...NO_ROLES
    } });
    const c = await connect({ port: srv2.port });
    await c.next('snapshot');
    c.send({ type: 'openrig.status', requestId: 'r' });
    await c.next('openrig.state');
    await vi.waitFor(() => expect(store.get('claude-conv-old')).toMatchObject({ name: 'Bix', state: 'idle', source: 'rig' }));
    expect(store.get('rig-dev-build-first-factory')).toBeUndefined();
    c.close(); await srv2.close();
  });
});

describe('server: OpenRig seats found by Ledge itself', () => {
  it('follows each running Claude Code and Codex seat on its pane; a later hook of that seat is the same session', async () => {
    const node = (logicalId: string, session: string, runtime: string, sessionStatus = 'running') => ({ logicalId, session, runtime, model: null, sessionStatus, lifecycleState: 'running', activity: 'idle', stopped: false, work: 0 });
    const state = { installed: true, daemon: { state: 'running' as const }, kernel: { state: 'ready' as const }, at: '2026-11-02T09:00:00.000Z', rigs: [
      { id: 'K', name: 'kernel', status: 'running', lifecycleState: 'running', seats: 3, running: 3, attention: 0, uptime: null, snapshot: null,
        nodes: [node('operator.agent', 'operator-agent@kernel', 'codex'), node('operator.human', 'operator-human@kernel', 'terminal'), node('advisor.lead', 'advisor-lead@kernel', 'claude-code', 'detached')] },
      { id: 'F', name: 'first-factory', status: 'running', lifecycleState: 'running', seats: 1, running: 1, attention: 0, uptime: null, snapshot: null, nodes: [node('dev.build', 'dev-build@first-factory', 'claude-code')] }
    ] };
    const seatTmux = fakeTmux({ 'operator-agent@kernel': ['› '], 'operator-human@kernel': ['$ '], 'dev-build@first-factory': ['❯ '] });
    const srv2 = await startServer({ store, tmux: seatTmux, port: 0, openrig: { row: async () => ({ error: 'not_found' }),
      async state() { return state; }, async act() { return { ok: true, commands: [] }; }, async specs() { return { specs: [] }; },
      async launch() { return { ok: true, plan: true, commands: [] }; }, async reseat() { return { ok: true, commands: [], added: [], removed: [] }; }, ...NO_ROLES
    } });
    const c = await connect({ port: srv2.port });
    await c.next('snapshot');
    c.send({ type: 'openrig.status', requestId: 'r' });
    await c.next('openrig.state');
    await vi.waitFor(() => expect(store.get('rig-operator-agent-kernel')).toMatchObject({ tool: 'codex', source: 'rig', tmuxSession: 'operator-agent@kernel', rig: { seat: 'operator-agent@kernel', name: 'kernel', role: 'operator.agent' } }));
    await vi.waitFor(() => expect(store.get('rig-dev-build-first-factory')).toMatchObject({ tool: 'claude', source: 'rig' }));
    // A terminal seat and a detached one are not agents Ledge can answer.
    expect(store.get('rig-operator-human-kernel')).toBeUndefined();
    expect(store.get('rig-advisor-lead-kernel')).toBeUndefined();
    // The Claude seat's hook, under its own conversation id, lands on the seat's session.
    c.send({ type: 'session.event', id: 'claude-conv-1', agent: 'claude', cwd: '/w/ledge', rigSeat: 'dev-build@first-factory', event: { name: 'UserPromptSubmit', at: '2026-11-02T10:57:00.000Z', source: 'hook', text: 'go' } });
    await vi.waitFor(() => expect(store.get('rig-dev-build-first-factory')?.state).toBe('working'));
    expect(store.get('claude-conv-1')).toBeUndefined();
    c.close(); await srv2.close();
  });
});

describe('server: an OMP seat of OpenRig', () => {
  it('is followed as an OMP session under its rig, for its state only: nothing typed into its pane, nothing of its screen sent', async () => {
    const node = { logicalId: 'dev.agent', session: 'dev-agent@dev-omp', runtime: 'omp', model: 'anthropic/claude-sonnet-5-5', sessionStatus: 'running', lifecycleState: 'running', activity: 'unknown', stopped: false, work: 1 };
    const state = { installed: true, daemon: { state: 'running' as const }, kernel: { state: 'ready' as const }, at: '2026-11-03T09:00:00.000Z', rigs: [
      { id: 'D', name: 'dev-omp', status: 'running', lifecycleState: 'running', seats: 1, running: 1, attention: 0, uptime: null, snapshot: null, nodes: [node] }] };
    const seatTmux = fakeTmux({ 'dev-agent@dev-omp': ['you ▸ go', '  ⚙ bash …', '  ⚙ bash done'] });
    const ticks: string[] = [];
    const srv2 = await startServer({ store, tmux: seatTmux, port: 0, ompSeats: { tick: async () => {}, start: () => { ticks.push('start'); }, stop: () => { ticks.push('stop'); } }, openrig: { row: async () => ({ error: 'not_found' }),
      async state() { return state; }, async act() { return { ok: true, commands: [] }; }, async specs() { return { specs: [] }; },
      async launch() { return { ok: true, plan: true, commands: [] }; }, async reseat() { return { ok: true, commands: [], added: [], removed: [] }; }, ...NO_ROLES
    } });
    const c = await connect({ port: srv2.port });
    await c.next('snapshot');
    c.send({ type: 'openrig.status', requestId: 'r' });
    await c.next('openrig.state');
    await vi.waitFor(() => expect(store.get('rig-dev-agent-dev-omp')).toMatchObject({ tool: 'omp', source: 'rig', tmuxSession: 'dev-agent@dev-omp', state: 'idle', rig: { seat: 'dev-agent@dev-omp', name: 'dev-omp', role: 'dev.agent' } }));
    expect(store.get('rig-dev-agent-dev-omp')?.backend).toBeUndefined();
    c.send({ type: 'session.reply', id: 'rig-dev-agent-dev-omp', text: 'et les tests ?' });
    expect(await c.next('error')).toMatchObject({ id: 'rig-dev-agent-dev-omp', code: 'read_only' });
    c.send({ type: 'session.interrupt', id: 'rig-dev-agent-dev-omp' });
    expect(await c.next('error')).toMatchObject({ id: 'rig-dev-agent-dev-omp', code: 'read_only' });
    c.send({ type: 'session.kill', id: 'rig-dev-agent-dev-omp' });
    expect(await c.next('error')).toMatchObject({ code: 'read_only' });
    expect(seatTmux.sent.filter(x => x[1] === 'dev-agent@dev-omp')).toEqual([]);
    c.close(); await srv2.close();
    expect(ticks).toEqual(['start', 'stop']);
  });
});

describe('server: a seat known from its hooks only that now runs OMP', () => {
  it('waits for its pane, then becomes the OMP seat on it: followed, never typed into', async () => {
    const SEAT = 'dev-agent@dev-omp';
    store.upsert({ id: 'claude-conv', name: 'Bix', tool: 'claude', cwd: '/w', project: 'w', title: 'Bix', tmuxSession: null, state: 'idle', helpers: [],
      startedAt: '2026-11-03T09:00:00.000Z', lastActivityAt: '2026-11-03T09:00:00.000Z', source: 'hook_only', rig: { seat: SEAT, name: 'dev-omp', role: 'dev.agent' } });
    const node = { logicalId: 'dev.agent', session: SEAT, runtime: 'omp', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'unknown', stopped: false, work: 0 };
    const state = { installed: true, daemon: { state: 'running' as const }, kernel: { state: 'ready' as const }, at: '2026-11-03T09:00:00.000Z', rigs: [
      { id: 'D', name: 'dev-omp', status: 'running', lifecycleState: 'running', seats: 1, running: 1, attention: 0, uptime: null, snapshot: null, nodes: [node] }] };
    const panes: Record<string, string[]> = {};
    const seatTmux = fakeTmux(panes);
    const srv2 = await startServer({ store, tmux: seatTmux, port: 0, ompSeats: { tick: async () => {}, start: () => {}, stop: () => {} }, openrig: { row: async () => ({ error: 'not_found' }),
      async state() { return state; }, async act() { return { ok: true, commands: [] }; }, async specs() { return { specs: [] }; },
      async launch() { return { ok: true, plan: true, commands: [] }; }, async reseat() { return { ok: true, commands: [], added: [], removed: [] }; }, ...NO_ROLES
    } });
    const c = await connect({ port: srv2.port });
    await c.next('snapshot');
    const discover = async () => { c.send({ type: 'openrig.status', requestId: 'r' }); await c.next('openrig.state'); await new Promise(r => setTimeout(r, 50)); };
    await discover();
    expect(store.get('claude-conv')).toMatchObject({ tool: 'claude', source: 'hook_only', tmuxSession: null });
    panes[SEAT] = ['you ▸ go'];
    await discover();
    await vi.waitFor(() => expect(store.get('claude-conv')).toMatchObject({ tool: 'omp', source: 'rig', tmuxSession: SEAT, state: 'idle' }));
    c.send({ type: 'session.reply', id: 'claude-conv', text: 'go' });
    expect(await c.next('error')).toMatchObject({ id: 'claude-conv', code: 'read_only' });
    expect(seatTmux.sent.filter(x => x[1] === SEAT)).toEqual([]);
    c.close(); await srv2.close();
  });
});

describe('server: a stopped OMP seat', () => {
  it('stays under its rig while OpenRig lists it, its rig stopped too, and goes once the seat is gone from it; a failed reading removes nothing', async () => {
    const seatNode = (session: string, logicalId: string, runtime = 'omp', sessionStatus = 'stopped') => ({ logicalId, session, runtime, model: null, sessionStatus, lifecycleState: 'stopped', activity: 'unknown', stopped: true, work: 0 });
    const rigOf = (name: string, nodes: ReturnType<typeof seatNode>[], seats = nodes.length) => ({ id: name, name, status: 'stopped', lifecycleState: 'stopped', seats, running: 0, attention: 0, uptime: null, snapshot: null, nodes });
    let rigs = [rigOf('split-omp', [seatNode('split-splitter@split-omp', 'split.splitter'), seatNode('review-reviewer@split-omp', 'review.reviewer')])];
    const seat = (id: string, s: string, o: Partial<Session> = {}): Session => ({ id, name: id, tool: 'omp', cwd: '/w', project: 'w', title: id, tmuxSession: s, state: 'exited', exitedAt: '2026-11-03T09:00:00.000Z', helpers: [],
      startedAt: '2026-11-03T08:00:00.000Z', lastActivityAt: '2026-11-03T09:00:00.000Z', source: 'rig', rig: { seat: s, name: s.split('@')[1]!, role: 'x.y' }, ...o });
    store.upsert(seat('splitter', 'split-splitter@split-omp'));
    store.upsert(seat('reviewer', 'review-reviewer@split-omp'));
    store.upsert(seat('claude-gone', 'dev-build@old', { tool: 'claude' }));
    const srv2 = await startServer({ store, tmux: fakeTmux({}), port: 0, ompSeats: { tick: async () => {}, start: () => {}, stop: () => {} }, openrig: { row: async () => ({ error: 'not_found' }),
      async state() { return { installed: true, daemon: { state: 'running' as const }, kernel: { state: 'ready' as const }, at: '2026-11-03T10:00:00.000Z', rigs }; },
      async act() { return { ok: true, commands: [] }; }, async specs() { return { specs: [] }; },
      async launch() { return { ok: true, plan: true, commands: [] }; }, async reseat() { return { ok: true, commands: [], added: [], removed: [] }; }, ...NO_ROLES
    } });
    const c = await connect({ port: srv2.port });
    await c.next('snapshot');
    const discover = async () => { c.send({ type: 'openrig.status', requestId: 'r' }); await c.next('openrig.state'); await new Promise(r => setTimeout(r, 50)); };
    await discover();
    for (const id of ['splitter', 'reviewer']) expect(store.get(id)).toMatchObject({ state: 'exited' });
    expect(store.get('splitter')?.archivedAt).toBeUndefined();
    // A failed `rig ps` (no rig), or a failed `rig ps --nodes` (a rig counting seats but listing none): nothing goes.
    rigs = []; await discover();
    rigs = [rigOf('split-omp', [], 2)]; await discover();
    expect(store.get('splitter')?.archivedAt).toBeUndefined();
    expect(store.get('reviewer')?.archivedAt).toBeUndefined();
    // The reviewer seat is removed from its rig: it goes; the other stays; a Claude seat is left to the retirement clock.
    rigs = [rigOf('split-omp', [seatNode('split-splitter@split-omp', 'split.splitter')])]; await discover();
    await vi.waitFor(() => expect(store.get('reviewer')?.archivedAt).toBeDefined());
    expect(store.get('splitter')?.archivedAt).toBeUndefined();
    expect(store.get('claude-gone')?.archivedAt).toBeUndefined();
    c.close(); await srv2.close();
  });
});

describe('server: a seat that changes harness under the same name', () => {
  it('follows it: Claude → OMP (read-only, never typed into), OMP → Codex (typed into again), and back from the archive as OMP', async () => {
    const SEAT = 'dev-agent@dev-omp';
    const node = { logicalId: 'dev.agent', session: SEAT, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0 };
    const state = { installed: true, daemon: { state: 'running' as const }, kernel: { state: 'ready' as const }, at: '2026-11-03T09:00:00.000Z', rigs: [
      { id: 'D', name: 'dev-omp', status: 'running', lifecycleState: 'running', seats: 1, running: 1, attention: 0, uptime: null, snapshot: null, nodes: [node] }] };
    const panes: Record<string, string[]> = { [SEAT]: ['❯ '] };
    const seatTmux = fakeTmux(panes);
    const srv2 = await startServer({ store, tmux: seatTmux, port: 0, ompSeats: { tick: async () => {}, start: () => {}, stop: () => {} }, openrig: { row: async () => ({ error: 'not_found' }),
      async state() { return state; }, async act() { return { ok: true, commands: [] }; }, async specs() { return { specs: [] }; },
      async launch() { return { ok: true, plan: true, commands: [] }; }, async reseat() { return { ok: true, commands: [], added: [], removed: [] }; }, ...NO_ROLES
    } });
    const c = await connect({ port: srv2.port });
    await c.next('snapshot');
    const discover = async () => { c.send({ type: 'openrig.status', requestId: 'r' }); await c.next('openrig.state'); };
    const ID = 'rig-dev-agent-dev-omp';
    await discover();
    await vi.waitFor(() => expect(store.get(ID)).toMatchObject({ tool: 'claude', source: 'rig' }));
    store.upsert({ ...store.get(ID)!, model: 'opus', lastReply: { text: 'fini', at: '2026-11-03T09:00:00.000Z' }, transcriptPath: '/t.jsonl' });
    // Relaunched as an OMP seat under the same name.
    node.runtime = 'omp';
    await discover();
    await vi.waitFor(() => expect(store.get(ID)).toMatchObject({ tool: 'omp', state: 'idle', source: 'rig' }));
    for (const k of ['model', 'lastReply', 'transcriptPath']) expect(store.get(ID)).not.toHaveProperty(k);
    c.send({ type: 'session.reply', id: ID, text: 'go' });
    expect(await c.next('error')).toMatchObject({ id: ID, code: 'read_only' });
    expect(seatTmux.sent.filter(x => x[1] === SEAT)).toEqual([]);
    // And again as a Codex seat.
    node.runtime = 'codex';
    await discover();
    await vi.waitFor(() => expect(store.get(ID)?.tool).toBe('codex'));
    c.send({ type: 'session.reply', id: ID, text: 'go' });
    await vi.waitFor(() => expect(seatTmux.sent).toContainEqual(['text', SEAT, 'go']));
    // Its rig stops; it comes back from the archive running OMP.
    store.apply(ID, { name: 'PaneGone', at: '2026-11-03T09:30:00.000Z', source: 'daemon' }); store.archive(ID, '2026-11-03T09:31:00.000Z');
    node.runtime = 'omp';
    await discover();
    await vi.waitFor(() => expect(store.get(ID)).toMatchObject({ tool: 'omp', state: 'idle', source: 'rig' }));
    expect(store.get(ID)?.archivedAt).toBeUndefined();
    c.close(); await srv2.close();
  });
});

describe('close a session', () => {
  const CLOSE = { freeMs: 200, exitMs: 200 };
  /** A fake terminal whose agent leaves when the exit command is submitted (`leaves`): its pane goes, the poller sees it gone. */
  async function closing(panes: Record<string, string[]>, o: { leaves?: boolean; close?: { freeMs: number; exitMs: number }; history?: History; chat?: Chat; omp?: Parameters<typeof startServer>[0]['omp'] } = {}) {
    tmux = fakeTmux(panes);
    const keys = tmux.sendKeys.bind(tmux);
    tmux.sendKeys = async (n, k) => {
      // This pane's own last key: several sessions closing at once interleave in `sent`.
      const prev = tmux.sent.filter(x => x[1] === n).at(-1);
      await keys(n, k);
      if (o.leaves === false || !k.includes('Enter') || prev?.[0] !== 'text' || prev[2] !== '/exit') return;
      delete panes[n];
      const s = store.all().find(x => x.tmuxSession === n);
      if (s) store.apply(s.id, { name: 'PaneGone', at: new Date().toISOString(), source: 'pane' });
    };
    await srv.close();
    srv = await startServer({ store, tmux, port: 0, close: o.close ?? CLOSE, ...(o.history ? { history: o.history } : {}), ...(o.chat ? { chat: o.chat } : {}), ...(o.omp ? { omp: o.omp } : {}) });
  }
  const texts = () => tmux.sent.filter(x => x[0] === 'text');
  const logged = () => (existsSync(paths().log) ? readFileSync(paths().log, 'utf8') : '');

  it('is not taken as closed by the exit a model change\'s respawn passes through, and the session ends exited', async () => {
    await closing({ 'ledge-a': ['> '] }, { leaves: false, close: { freeMs: 700, exitMs: 200 } });
    store.upsert(mk('a', { state: 'idle', cwd: tmpdir(), project: 'p', agentSessionId: 'u-1', model: 'opus' }));
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    let killing = false; const end = tmux.killSession.bind(tmux);
    tmux.killSession = async n => { killing = true; await gate; return end(n); };
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.model', id: 'a', model: 'sonnet', effort: null });
    await until(() => killing, 3000);
    // The model change holds the session (typing) while it ends the old agent; the close starts then and the agent reads exited.
    let settled = false;
    const closed = srv.closeSession('a').then(r => { settled = true; return r; });
    store.apply('a', { name: 'PaneGone', at: new Date().toISOString(), source: 'daemon' });
    await new Promise(r => setTimeout(r, 150));
    expect(settled).toBe(false);
    release();
    await closed;
    expect(store.get('a')!.state).toBe('exited');
    c.close();
  });

  it('refuses a direct reply to a session being closed', async () => {
    await closing({ 'ledge-a': ['Running…'] }, { close: { freeMs: 400, exitMs: 200 } });
    store.upsert(mk('a', { state: 'working' }));
    const closed = srv.closeSession('a');
    await until(() => tmux.sent.length > 0, 3000);
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.reply', id: 'a', text: 'hello' });
    expect(await c.next('error')).toMatchObject({ id: 'a', message: 'the session is being closed' });
    expect(texts()).toEqual([]);
    c.close();
    await closed;
  });

  it('closes an idle session with its exit command', async () => {
    await closing({ 'ledge-a': ['> '] });
    store.upsert(mk('a', { state: 'idle' }));
    expect(await srv.closeSession('a')).toEqual({ how: 'exit' });
    expect(tmux.sent).toEqual([['keys', 'ledge-a', 'C-u'], ['text', 'ledge-a', '/exit'], ['keys', 'ledge-a', 'Enter']]);
    expect(store.get('a')).toMatchObject({ state: 'exited' });
    expect(store.get('a')!.archivedAt).toBeUndefined();
  });

  it('interrupts a working session before it types the exit command', async () => {
    await closing({ 'ledge-a': ['Running…'] });
    store.upsert(mk('a', { state: 'working' }));
    const closed = srv.closeSession('a');
    await until(() => tmux.sent.length > 0, 3000);
    expect(tmux.sent).toEqual([['keys', 'ledge-a', 'Escape']]);
    store.upsert({ ...store.get('a')!, state: 'idle' });
    expect(await closed).toEqual({ how: 'exit' });
    expect(tmux.sent).toEqual([['keys', 'ledge-a', 'Escape'], ['keys', 'ledge-a', 'C-u'], ['text', 'ledge-a', '/exit'], ['keys', 'ledge-a', 'Enter']]);
  });

  it('refuses a pending permission, records the refusal and never types into the dialog', async () => {
    const history = new History({ dir: tmpDir() });
    await closing({ 'ledge-a': [PROMPT] }, { history });
    store.upsert(mk('a', { state: 'working' }));
    store.apply('a', { name: 'PermissionRequest', at: new Date().toISOString(), source: 'hook', tool: 'Bash', text: 'npm test' });
    expect(store.get('a')!.pending).toBeDefined();
    const closed = srv.closeSession('a');
    await until(() => tmux.sent.length > 0, 3000);
    expect(tmux.sent[0]).toEqual(['keys', 'ledge-a', 'Escape']);
    await until(() => history.items('a').some(i => i.kind === 'permission' && i.decision !== undefined), 3000);
    expect(history.items('a').find(i => i.kind === 'permission')).toMatchObject({ decision: 'deny', byClose: true });
    expect(texts()).toEqual([]);
    store.upsert({ ...store.get('a')!, state: 'idle' });
    expect(await closed).toEqual({ how: 'exit' });
    expect(texts()).toEqual([['text', 'ledge-a', '/exit']]);
  });

  it('dismisses a pending question without marking an older permission refused', async () => {
    const history = new History({ dir: tmpDir() });
    await closing({ 'ledge-a': [QUESTION] }, { history });
    store.upsert(mk('a', { state: 'working' }));
    history.record('a', { name: 'PermissionRequest', at: new Date().toISOString(), source: 'hook', tool: 'Bash', text: 'ls' });
    history.record('a', { name: 'PreToolUse', at: new Date().toISOString(), source: 'hook', tool: 'AskUserQuestion', text: 'Which?', toolUseId: 'toolu_q' });
    store.upsert({ ...store.get('a')!, state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } });
    const closed = srv.closeSession('a');
    await until(() => store.get('a')!.pending === undefined, 3000);
    expect(history.items('a').find(i => i.kind === 'permission')).not.toHaveProperty('decision');
    // The question's own tool row says the close dismissed it.
    await until(() => history.items('a').some(i => i.kind === 'tool' && i.byClose === true), 3000);
    store.upsert({ ...store.get('a')!, state: 'idle' });
    expect(await closed).toEqual({ how: 'exit' });
  });

  /** The names of the events the store applied to `id` from now on. */
  const eventsOf = (id: string) => { const seen: string[] = []; store.onEvent((i, ev) => { if (i === id) seen.push(ev.name); }); return seen; };
  const hookPermission = { kind: 'permission' as const, text: 'npm test', tool: 'Bash', source: 'hook' as const };

  it('a helper\'s request is not refused for the thread: no Decided, and the close ends in a kill', async () => {
    await closing({ 'ledge-a': [PROMPT] });
    store.upsert(mk('a', { state: 'waiting_permission', pending: { ...hookPermission, helperId: 'h1' } }));
    const events = eventsOf('a');
    expect(await srv.closeSession('a')).toEqual({ how: 'killed' });
    expect(tmux.sent).toEqual([['keys', 'ledge-a', 'Escape'], ['kill', 'ledge-a']]);
    expect(events).not.toContain('Decided');
  });

  it('a request the terminal showed (no hook) gets no deny', async () => {
    await closing({ 'ledge-a': [PROMPT] });
    store.upsert(mk('a', { state: 'waiting_permission', pending: { ...hookPermission, source: 'pane' } }));
    const events = eventsOf('a');
    const closed = srv.closeSession('a');
    await until(() => tmux.sent.length > 0, 3000);
    await new Promise(r => setTimeout(r, 100));
    expect(events).not.toContain('Decided');
    store.upsert({ ...store.get('a')!, state: 'idle', pending: undefined });
    expect(await closed).toEqual({ how: 'exit' });
  });

  it('a failed interrupt refuses nothing and ends in a kill', async () => {
    await closing({ 'ledge-a': [PROMPT] });
    const keys = tmux.sendKeys;
    tmux.sendKeys = async (n, k) => { if (k.includes('Escape')) throw new Error('no server running'); return keys(n, k); };
    store.upsert(mk('a', { state: 'waiting_permission', pending: hookPermission }));
    const events = eventsOf('a');
    expect(await srv.closeSession('a')).toEqual({ how: 'killed' });
    expect(events).not.toContain('Decided');
    expect(texts()).toEqual([]);
    expect(logged()).toMatch(/close of a: the interrupt failed: no server running/);
  });

  it('a request replaced while the interrupt went is left alone', async () => {
    await closing({ 'ledge-a': [PROMPT] });
    const keys = tmux.sendKeys;
    tmux.sendKeys = async (n, k) => {
      await keys(n, k);
      if (k.includes('Escape')) store.upsert({ ...store.get('a')!, pending: { ...hookPermission, text: 'rm -rf dist' } });
    };
    store.upsert(mk('a', { state: 'waiting_permission', pending: hookPermission }));
    const events = eventsOf('a');
    expect(await srv.closeSession('a')).toEqual({ how: 'killed' });
    expect(events).not.toContain('Decided');
    expect(store.get('a')).toMatchObject({ state: 'exited' });
  });

  it('an exit command that cannot be typed ends in a kill', async () => {
    await closing({ 'ledge-a': ['> '] });
    tmux.sendText = async () => { throw new Error('no server running'); };
    store.upsert(mk('a', { state: 'idle' }));
    expect(await srv.closeSession('a')).toEqual({ how: 'killed' });
    expect(tmux.sent.at(-1)).toEqual(['kill', 'ledge-a']);
    expect(logged()).toMatch(/close of a: killed \(its exit command could not be typed\)/);
  });

  it('a reply sent while the exit command is typed is refused, never typed into it', async () => {
    await closing({ 'ledge-a': ['> '] });
    store.upsert(mk('a', { state: 'idle' }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    const closed = srv.closeSession('a');
    await until(() => texts().length > 0, 3000);
    c.send({ type: 'session.reply', id: 'a', text: 'encore une chose' });
    expect(await c.next('error', 3000)).toMatchObject({ id: 'a', request: 'session.reply', code: 'busy' });
    expect(await closed).toEqual({ how: 'exit' });
    expect(tmux.sent).toEqual([['keys', 'ledge-a', 'C-u'], ['text', 'ledge-a', '/exit'], ['keys', 'ledge-a', 'Enter']]);
    c.close();
  });

  it('kills the session when the agent does not leave', async () => {
    await closing({ 'ledge-a': ['> '] }, { leaves: false });
    store.upsert(mk('a', { state: 'idle' }));
    expect(await srv.closeSession('a')).toEqual({ how: 'killed' });
    expect(texts()).toEqual([['text', 'ledge-a', '/exit']]);
    expect(tmux.sent.at(-1)).toEqual(['kill', 'ledge-a']);
    // Kept on the session: a front that did not close it can still say « Fermée de force ».
    expect(store.get('a')).toMatchObject({ state: 'exited', closedHow: 'killed' });
    expect(logged()).toMatch(/close of a: killed \(.+\)/);
  });

  it('a close the agent leaves on its own marks nothing', async () => {
    await closing({ 'ledge-a': ['> '] });
    store.upsert(mk('a', { state: 'idle' }));
    expect(await srv.closeSession('a')).toEqual({ how: 'exit' });
    expect(store.get('a')!.state).toBe('exited');
    expect(store.get('a')).not.toHaveProperty('closedHow');
  });

  it('a session its close had to kill resumes on its own conversation', async () => {
    await closing({ 'ledge-a': ['> '] }, { leaves: false });
    store.upsert(mk('a', { state: 'idle', cwd: tmpdir(), agentSessionId: 'u-1' }));
    expect(await srv.closeSession('a')).toEqual({ how: 'killed' });
    // The kill leaves the agent's conversation id: the resume continues it, not a new one.
    expect(store.get('a')).toMatchObject({ state: 'exited', agentSessionId: 'u-1', closedHow: 'killed' });
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.resume', id: 'a' });
    await until(() => tmux.created.length > 0, 3000);
    expect(tmux.created.at(-1)!.command.slice(-2)).toEqual(['--resume', 'u-1']);
    // Started again: the forced close belongs to its previous life.
    await until(() => store.get('a')!.state !== 'exited', 3000);
    expect(store.get('a')).not.toHaveProperty('closedHow');
    c.close();
  });

  it('kills without typing when the prompt is never freed', async () => {
    await closing({ 'ledge-a': ['Running…'] });
    store.upsert(mk('a', { state: 'working' }));
    expect(await srv.closeSession('a')).toEqual({ how: 'killed' });
    expect(texts()).toEqual([]);
    expect(tmux.sent).toEqual([['keys', 'ledge-a', 'Escape'], ['kill', 'ledge-a']]);
    expect(store.get('a')).toMatchObject({ state: 'exited' });
  });

  it('a session that exits by itself during the close is closed, not killed', async () => {
    await closing({ 'ledge-a': ['Running…'] });
    store.upsert(mk('a', { state: 'working' }));
    const closed = srv.closeSession('a');
    await until(() => tmux.sent.length > 0, 3000);
    store.apply('a', { name: 'PaneGone', at: new Date().toISOString(), source: 'pane' });
    expect(await closed).toEqual({ how: 'exit' });
    expect(tmux.sent).toEqual([['keys', 'ledge-a', 'Escape']]);
  });

  it('closes an OMP session through omp.close', async () => {
    const closed: string[] = [];
    const omp = { close: async (id: string) => { closed.push(id); }, closeAll: async () => {}, catalog: async () => ({}) } as unknown as NonNullable<Parameters<typeof startServer>[0]['omp']>;
    await closing({}, { omp });
    store.upsert(mk('o', { tool: 'omp', backend: 'omp-rpc', tmuxSession: undefined, state: 'working' }));
    expect(await srv.closeSession('o')).toEqual({ how: 'exit' });
    expect(closed).toEqual(['o']);
    expect(store.get('o')).toMatchObject({ state: 'exited' });
    expect(tmux.sent).toEqual([]);
  });

  it('refuses a read-only, an exited and an already closing session', async () => {
    await closing({ 'ledge-a': ['> '] });
    store.upsert(mk('h', { source: 'hook_only', tmuxSession: undefined }));
    store.upsert(mk('x', { state: 'exited' }));
    store.upsert(mk('a', { state: 'idle' }));
    await expect(srv.closeSession('zz')).rejects.toMatchObject({ code: 'unknown_session' });
    await expect(srv.closeSession('h')).rejects.toMatchObject({ code: 'read_only' });
    await expect(srv.closeSession('x')).rejects.toMatchObject({ code: 'busy', message: 'the session has already exited' });
    const first = srv.closeSession('a');
    await expect(srv.closeSession('a')).rejects.toMatchObject({ code: 'busy', message: 'a close is already in progress' });
    expect(await first).toEqual({ how: 'exit' });
    expect(texts()).toEqual([['text', 'ledge-a', '/exit']]);
  });

  describe('from a chat card', () => {
    /** A chat whose `q1` card closes these rows; the marks are recorded per row and broadcast as a history, like the real one. */
    function closeChat(initial: ChatClose[]) {
      const rows = [...initial]; const marks: Array<[string, number, string]> = [];
      const chat: Chat = {
        async ask() {}, attachmentIds: () => [], cancel() {}, async reset() {}, history: () => [], proposal: () => undefined, markLaunched() {}, markFailed() {},
        relay: () => undefined, markRelay() {}, queuedRelays: () => [],
        close: (qid, row) => (qid === 'q1' ? rows[row] : undefined),
        markClosed(_qid, row, how, emit) { marks.push(['closed', row, how]); rows[row] = { ...rows[row]!, closedAt: new Date().toISOString(), how }; emit({ type: 'chat.history', turns: [] }); },
        markCloseFailed(_qid, row, message, emit) { marks.push(['failed', row, message]); rows[row] = { ...rows[row]!, error: message }; emit({ type: 'chat.history', turns: [] }); },
        idle: async () => {}, task: () => undefined, markTask() {}, followTask() {}, action: () => undefined, markAction() {}, ignore: () => null, ignored: () => false
      };
      return { chat, marks };
    }
    const otto: ChatClose = { id: 'a', name: 'Otto', tool: 'claude' };
    const pim: ChatClose = { id: 'b', name: 'Pim', tool: 'claude' };
    const byRow = (a: { row: number }, b: { row: number }) => a.row - b.row;

    it('closes every row for the requester, and every client gets the history', async () => {
      const { chat, marks } = closeChat([otto, pim]);
      await closing({ 'ledge-a': ['> '], 'ledge-b': ['> '] }, { chat });
      store.upsert(mk('a', { state: 'idle' })); store.upsert(mk('b', { name: 'Pim', state: 'idle' }));
      const c = await connect({ port: srv.port }); await c.next('snapshot'); await c.next('chat.history');
      const other = await connect({ port: srv.port }); await other.next('snapshot'); await other.next('chat.history');
      c.send({ type: 'session.close', qid: 'q1' });
      const closed = [await c.next('session.closed', 3000), await c.next('session.closed', 3000)].sort(byRow);
      expect(closed).toEqual([{ type: 'session.closed', qid: 'q1', row: 0, id: 'a', how: 'exit' }, { type: 'session.closed', qid: 'q1', row: 1, id: 'b', how: 'exit' }]);
      await c.next('chat.history'); await other.next('chat.history');
      await expect(other.next('session.closed', 100)).rejects.toThrow(/timeout/);
      expect(marks.sort((x, y) => x[1] - y[1])).toEqual([['closed', 0, 'exit'], ['closed', 1, 'exit']]);
      expect(store.get('a')).toMatchObject({ state: 'exited' }); expect(store.get('b')).toMatchObject({ state: 'exited' });
      expect(texts()).toEqual(expect.arrayContaining([['text', 'ledge-a', '/exit'], ['text', 'ledge-b', '/exit']]));
      // Closed, the card refuses a second click.
      c.send({ type: 'session.close', qid: 'q1', rows: [1] });
      expect(await c.next('error')).toEqual({ type: 'error', message: 'already closed', request: 'session.close' });
      c.close(); other.close();
    });

    it('refuses an unknown card, and an unknown row, without typing anything', async () => {
      await closing({ 'ledge-a': ['> '] }, { chat: closeChat([otto]).chat });
      store.upsert(mk('a', { state: 'idle' }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.close', qid: 'q9' });
      expect(await c.next('error')).toEqual({ type: 'error', message: 'unknown close', request: 'session.close' });
      c.send({ type: 'session.close', qid: 'q1', rows: [3] });
      expect(await c.next('error')).toEqual({ type: 'error', message: 'unknown close', request: 'session.close' });
      expect(tmux.sent).toEqual([]);
      c.close();
    });

    it('two cards closing the same session share its close: both rows read closed, neither failed', async () => {
      // q1 and q2 each name session `a` (a phone's card and Desktop's, say): their rows are not the same, their session is.
      const cards: Record<string, ChatClose[]> = { q1: [otto], q2: [otto] }; const marks: Array<[string, string, number]> = [];
      const chat: Chat = {
        ...closeChat([]).chat,
        close: (qid, row) => cards[qid]?.[row],
        markClosed(qid, row, how, emit) { marks.push([how, qid, row]); cards[qid]![row] = { ...cards[qid]![row]!, closedAt: new Date().toISOString(), how }; emit({ type: 'chat.history', turns: [] }); },
        markCloseFailed(qid, row, message, emit) { marks.push([message, qid, row]); cards[qid]![row] = { ...cards[qid]![row]!, error: message }; emit({ type: 'chat.history', turns: [] }); }
      };
      await closing({ 'ledge-a': ['> '] }, { chat });
      store.upsert(mk('a', { state: 'idle' }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.close', qid: 'q1' });
      c.send({ type: 'session.close', qid: 'q2' });
      const closed = [await c.next('session.closed', 3000), await c.next('session.closed', 3000)].sort((x, y) => (x as { qid: string }).qid.localeCompare((y as { qid: string }).qid));
      expect(closed).toEqual([{ type: 'session.closed', qid: 'q1', row: 0, id: 'a', how: 'exit' }, { type: 'session.closed', qid: 'q2', row: 0, id: 'a', how: 'exit' }]);
      expect(marks.sort()).toEqual([['exit', 'q1', 0], ['exit', 'q2', 0]]);
      await expect(c.next('error', 100)).rejects.toThrow(/timeout/);
      // One close typed one exit command.
      expect(texts()).toEqual([['text', 'ledge-a', '/exit']]);
      c.close();
    });

    it('a failed row reaches the requester as one error once every row has settled', async () => {
      const { chat, marks } = closeChat([otto, { id: 'gone', name: 'Zed', tool: 'claude' }]);
      await closing({ 'ledge-a': ['> '] }, { chat });
      store.upsert(mk('a', { state: 'idle' }));
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.close', qid: 'q1' });
      const error = await c.next('error', 3000);
      expect(error).toEqual({ type: 'error', message: 'unknown session', request: 'session.close' });
      // The failure came first, but the error waited for the other row.
      expect(marks.sort((x, y) => x[1] - y[1])).toEqual([['closed', 0, 'exit'], ['failed', 1, 'unknown session']]);
      expect(await c.next('session.closed')).toEqual({ type: 'session.closed', qid: 'q1', row: 0, id: 'a', how: 'exit' });
      await expect(c.next('error', 100)).rejects.toThrow(/timeout/);
      c.close();
    });

    describe('a generic card (chat.act, spec 2026-10-26 action registry §9.2)', () => {
      /** A chat whose `q1` card holds these generic rows, marked as the real one marks them. */
      function actChat(initial: ChatAction[]) {
        const rows = [...initial]; const marks: string[] = [];
        const chat: Chat = {
          ...closeChat([]).chat,
          action: (qid, row) => (qid === 'q1' ? rows[row] : undefined),
          markAction(_qid, row, patch, emit) { marks.push(`${row}:${patch.state}`); rows[row] = { ...rows[row]!, ...patch }; emit({ type: 'chat.history', turns: [] }); }
        };
        return { chat, rows, marks };
      }
      const archiveOf = (id: string): ChatAction => ({ action: 'session.archive', args: { session: id }, summary: `Archiver ${id}`, risk: 'reversible', session: id });

      it('applies the rows through the daemon\'s handlers in order and stops at the first failure', async () => {
        const { chat, rows, marks } = actChat([archiveOf('a'), archiveOf('zz'), archiveOf('b')]);
        await closing({}, { chat });
        store.upsert(mk('a', { state: 'exited' })); store.upsert(mk('b', { state: 'exited' }));
        const c = await connect({ port: srv.port }); await c.next('snapshot');
        c.send({ type: 'chat.act', rid: 'r1', qid: 'q1' });
        expect(await c.next('chat.acted', 3000)).toEqual({ type: 'chat.acted', rid: 'r1', qid: 'q1', done: [0], failed: [{ row: 1, message: 'unknown session zz', refused: true }] });
        expect(marks).toEqual(['0:running', '0:done', '1:running', '1:refused']);
        expect(store.get('a')?.archivedAt).toBeDefined(); expect(store.get('b')?.archivedAt).toBeUndefined();
        expect(rows[2]).not.toHaveProperty('state');
        c.close();
      });
      it('a row whose handler answers nothing is done', async () => {
        const { chat, rows } = actChat([{ action: 'session.restore', args: { session: 'a' }, summary: 'x', risk: 'reversible' }]);
        await closing({}, { chat });
        store.upsert(mk('a', { state: 'idle', archivedAt: '2026-10-26T08:00:00.000Z' }));
        const c = await connect({ port: srv.port }); await c.next('snapshot');
        c.send({ type: 'chat.act', rid: 'r1', qid: 'q1' });
        expect(await c.next('chat.acted', 3000)).toMatchObject({ done: [0], failed: [] });
        expect(store.get('a')?.archivedAt).toBeUndefined();
        expect(rows[0]).toMatchObject({ state: 'done' });
        c.close();
      });
      it('« Refuser » a request row: answered with deny, unconfirmed, the row denied', async () => {
        const pending = { kind: 'permission' as const, text: 'mkdir zz-ledge-probe', tool: 'Bash', source: 'hook' as const };
        const session = mk('a', { state: 'waiting_permission', pending });
        const accept = resolveAction('session.decide', { session: 'a', decision: 'accept' }, { sessions: [session], tasks: [] });
        if ('refused' in accept) throw new Error(accept.refused);
        const { chat, marks } = actChat([accept]);
        const rest = fx('claude2-rest-after-deny');
        await closing({ 'ledge-a': [fx('claude2-permission-bash'), rest, rest] }, { chat });
        store.upsert(session);
        const c = await connect({ port: srv.port }); await c.next('snapshot');
        c.send({ type: 'chat.act', rid: 'r1', qid: 'q1', deny: true });
        expect(await c.next('chat.acted', 3000)).toEqual({ type: 'chat.acted', rid: 'r1', qid: 'q1', done: [0], failed: [] });
        expect(marks).toEqual(['0:running', '0:denied']);
        expect(tmux.sent[0]).toEqual(['keys', 'ledge-a', 'Escape']);
        // The PC's own card: the request is said answered by the PC, under its key.
        expect(store.get('a')?.lastAnswer).toMatchObject({ key: pendingKey(pending), by: { kind: 'pc' }, decision: 'deny' });
        c.close();
      });
      it('refuses an unknown card, and a destructive row without the confirmation', async () => {
        const { chat, marks } = actChat([{ action: 'task.cancel', args: { task: 't1' }, summary: 'x', risk: 'destructive' }]);
        await closing({}, { chat });
        const c = await connect({ port: srv.port }); await c.next('snapshot');
        c.send({ type: 'chat.act', rid: 'r1', qid: 'q9' });
        expect(await c.next('error')).toEqual({ type: 'error', message: 'unknown action', request: 'chat.act' });
        c.send({ type: 'chat.act', rid: 'r2', qid: 'q1' });
        expect(await c.next('error')).toMatchObject({ code: 'confirm_required', request: 'chat.act' });
        expect(marks).toEqual([]);
        c.close();
      });
      it('a card set aside (« Ignorer ») applies no more; chat.ignore reaches the chat and its refusal the requester', async () => {
        const { chat, marks } = actChat([archiveOf('a')]);
        let ignored = false; const calls: Array<[string, boolean]> = [];
        chat.ignored = qid => qid === 'q1' && ignored;
        chat.ignore = (qid, undo, emit) => { calls.push([qid, undo]); if (qid !== 'q1') return 'unknown card'; ignored = !undo; emit({ type: 'chat.history', turns: [] }); return null; };
        await closing({}, { chat });
        store.upsert(mk('a', { state: 'exited' }));
        const c = await connect({ port: srv.port }); await c.next('snapshot');
        c.send({ type: 'chat.ignore', qid: 'q1' });
        await c.next('chat.history', 3000);
        c.send({ type: 'chat.act', rid: 'r1', qid: 'q1' });
        expect(await c.next('error')).toEqual({ type: 'error', message: 'ignored card: open it again first', request: 'chat.act', code: 'ignored' });
        c.send({ type: 'session.close', qid: 'q1' });
        expect(await c.next('error')).toMatchObject({ message: 'ignored card: open it again first', request: 'session.close' });
        c.send({ type: 'chat.ignore', qid: 'q9' });
        expect(await c.next('error')).toMatchObject({ message: 'unknown card', request: 'chat.ignore' });
        c.send({ type: 'chat.ignore', qid: 'q1', undo: true });
        await c.next('chat.history', 3000);
        c.send({ type: 'chat.act', rid: 'r2', qid: 'q1' });
        expect(await c.next('chat.acted', 3000)).toMatchObject({ done: [0] });
        expect(calls).toEqual([['q1', false], ['q9', false], ['q1', true]]);
        expect(marks).toEqual(['0:running', '0:done']);
        c.close();
      });
      it('Ledge cancels or passes a task from its card only: a client naming itself ledge is refused', async () => {
        const { chat, rows } = actChat([]);
        await closing({}, { chat });
        store.upsert(mk('a')); store.upsert(mk('b', { name: 'Pim', tool: 'codex', state: 'idle' }));
        const c = await connect({ port: srv.port }); await c.next('snapshot');
        c.send({ type: 'task.cmd', rid: 't1', by: 'a', key: sessionKey('a'), op: 'give', to: 'Pim', title: 'Lance les tests' });
        const id = (await c.next('task.result', 3000)).task!.id;
        c.send({ type: 'task.cmd', rid: 't2', by: 'ledge', op: 'cancel', task: id });
        expect((await c.next('task.result', 3000)).reason).toBe('seul le chat de Ledge, ou ledge decide, agit sur une tâche au nom de Ledge');
        c.send({ type: 'task.cmd', rid: 't3', by: 'ledge', op: 'pass', task: id, to: 'a' });
        expect((await c.next('task.result', 3000)).reason).toBe('seul le chat de Ledge, ou ledge decide, agit sur une tâche au nom de Ledge');
        // The card's own row goes through: Ledge cancels it.
        rows.push({ action: 'task.cancel', args: { task: id }, summary: 'x', risk: 'destructive', session: 'b' });
        c.send({ type: 'chat.act', rid: 'r1', qid: 'q1', confirmed: true });
        expect(await c.next('chat.acted', 3000)).toMatchObject({ done: [0], failed: [] });
        c.close();
      });
      it('#142: a client naming itself ledge only reads (list, show, seen): a decision is answered through task.answer alone', async () => {
        const { chat, rows } = actChat([]);
        await closing({}, { chat });
        store.upsert(mk('a')); store.upsert(mk('b', { name: 'Pim', tool: 'codex', state: 'idle' }));
        const c = await connect({ port: srv.port }); await c.next('snapshot');
        c.send({ type: 'task.cmd', rid: 't1', by: 'a', key: sessionKey('a'), op: 'give', to: 'ledge', title: 'Merger ?', text: 'oui / non' });
        const id = (await c.next('task.result', 3000)).task!.id;
        const refused = 'seul le chat de Ledge, ou ledge decide, agit sur une tâche au nom de Ledge';
        for (const op of [
          { op: 'done', task: id, text: 'oui' }, { op: 'take', task: id }, { op: 'refuse', task: id, text: 'non' },
          { op: 'give', to: 'Pim', title: 'Relire' }
        ] as const) {
          c.send({ type: 'task.cmd', rid: `x-${op.op}`, by: 'ledge', ...op });
          expect((await c.next('task.result', 3000)).reason, op.op).toBe(refused);
        }
        c.send({ type: 'task.cmd', rid: 'l', by: 'ledge', op: 'list' });
        expect((await c.next('task.result', 3000)).tasks?.map(t => t.id)).toEqual([id]);
        c.send({ type: 'task.cmd', rid: 's', by: 'ledge', op: 'show', task: id });
        expect((await c.next('task.result', 3000)).task).toMatchObject({ id, state: 'open' });
        // The user's answer, through the card's row (task.answer), still goes.
        rows.push({ action: 'task.answer', args: { task: id, answer: 'oui' }, summary: 'x', risk: 'destructive', session: 'a' });
        c.send({ type: 'chat.act', rid: 'r1', qid: 'q1', confirmed: true });
        expect(await c.next('chat.acted', 3000)).toMatchObject({ done: [0], failed: [] });
        c.send({ type: 'task.cmd', rid: 's2', by: 'ledge', op: 'show', task: id });
        expect((await c.next('task.result', 3000)).task).toMatchObject({ id, state: 'done', result: 'oui' });
        c.close();
      });
      it('#142: `ledge task` from a session still gives, takes, passes, refuses and closes in its own name', async () => {
        const { taskOnClient } = await import('../src/cli/task.js');
        await closing({});
        store.upsert(mk('a')); store.upsert(mk('b', { name: 'Pim', tool: 'codex', state: 'idle' })); store.upsert(mk('c', { name: 'Ida', state: 'idle' }));
        const c = await connect({ port: srv.port }); await c.next('snapshot');
        const run = async (by: string, ...args: string[]) => (await taskOnClient(c, args, by, 3000, sessionKey(by))).line;
        const id = (await run('a', 'give', 'Pim', 'Lance les tests')).match(/t[0-9a-f]{6}/)![0];
        expect(await run('b', 'take', id)).toBe(`tâche ${id} prise`);
        expect(await run('b', 'pass', id, 'Ida')).toBe(`tâche ${id} passée à Ida`);
        expect(await run('c', 'refuse', id, 'pas pour moi')).toBe(`tâche ${id} refusée ; Ledge prévient Otto`);
        const again = (await run('a', 'give', 'Pim', 'Relis')).match(/t[0-9a-f]{6}/)![0];
        expect(await run('b', 'done', again, 'relu')).toBe(`tâche ${again} terminée ; Ledge prévient Otto`);
        c.close();
      });
      it('#152: a session acts on a task only with its own key; reads need none', async () => {
        await closing({});
        store.upsert(mk('a')); store.upsert(mk('b', { name: 'Pim', tool: 'codex', state: 'idle' }));
        const c = await connect({ port: srv.port }); await c.next('snapshot');
        let n = 0;
        const ask = async (m: Record<string, unknown>) => { c.send({ type: 'task.cmd', rid: `k${++n}`, ...m } as never); return c.next('task.result', 3000); };
        const id = (await ask({ by: 'a', key: sessionKey('a'), op: 'give', to: 'Pim', title: 'Lance les tests' })).task!.id;
        // Another session's key, or none: refused, and the task is untouched.
        expect((await ask({ by: 'b', key: sessionKey('a'), op: 'take', task: id })).reason).toContain('ne correspond pas');
        for (const op of [{ op: 'take', task: id }, { op: 'done', task: id, text: 'x' }, { op: 'refuse', task: id, text: 'x' }, { op: 'pass', task: id, to: 'Otto' }, { op: 'cancel', task: id }, { op: 'give', to: 'Otto', title: 'x' }])
          expect((await ask({ by: 'b', ...op })).reason, op.op).toContain('pas de clé');
        expect((await ask({ by: 'b', op: 'show', task: id })).task).toMatchObject({ id, state: 'open', owner: 'b' });
        expect((await ask({ by: 'b', op: 'list' })).tasks?.map(t => t.id)).toEqual([id]);
        // Its own key: it acts.
        expect((await ask({ by: 'b', key: sessionKey('b'), op: 'take', task: id })).task).toMatchObject({ id, state: 'taken' });
        c.close();
      });
    });
  });

  it('delivers nothing to a closing session', async () => {
    let r: ChatRelay | undefined = { id: 'a', name: 'Otto', tool: 'claude', text: 'Lance les tests', status: 'queued' };
    const chat: Chat = {
      async ask() {}, attachmentIds: () => [], cancel() {}, async reset() {}, history: () => [], proposal: () => undefined, markLaunched() {}, markFailed() {},
      relay: qid => (qid === 'q1' ? r : undefined),
      markRelay(_qid, patch, emit) { const { id, name, tool, text } = r!; r = { id, name, tool, text, ...patch }; emit({ type: 'chat.history', turns: [] }); },
      queuedRelays: () => (r?.status === 'queued' ? [{ qid: 'q1', relay: r, askedAt: '2026-10-12T08:00:00.000Z' }] : []),
      close: () => undefined, markClosed() {}, markCloseFailed() {}, idle: async () => {}, task: () => undefined, markTask() {}, followTask() {}, action: () => undefined, markAction() {}, ignore: () => null, ignored: () => false
    };
    const history = new History({ dir: tmpDir() });
    await closing({ 'ledge-a': ['Running…'] }, { history, chat });
    store.upsert(mk('a', { state: 'working' })); store.upsert(mk('b', { name: 'Pim', state: 'idle' }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.message', rid: 'r1', from: 'b', to: 'Otto', text: 'Salut' });
    expect(await c.next('message.ack', 3000)).toMatchObject({ outcome: 'queued' });
    const closed = srv.closeSession('a');
    await until(() => tmux.sent.length > 0, 3000);
    store.upsert({ ...store.get('a')!, state: 'idle' });
    expect(await closed).toEqual({ how: 'exit' });
    expect(texts().filter(t => t[1] === 'ledge-a')).toEqual([['text', 'ledge-a', '/exit']]);
    expect(r).toMatchObject({ error: 'Otto stopped before it got the instruction' });
    await until(() => history.items('b').some(i => i.kind === 'sent' && i.status === 'failed'), 3000);
    // The sender, free, is told its message never reached Otto.
    await until(() => texts().some(t => t[1] === 'ledge-b'), 3000);
    expect(texts().filter(t => t[1] === 'ledge-b')).toEqual([['text', 'ledge-b', expect.stringMatching(/^<ledge-notice to="Otto">Ledge n'a pas pu remettre ton message à Otto \(« Salut »\) : /)]]);
    c.close();
  });
});

describe('server: a seat tag its session does not carry (Atelier empty, 2026-11-05)', () => {
  const SEAT = 'advisor-lead@kernel';
  const rig = { seat: SEAT, name: 'kernel', role: 'advisor.lead' };
  /** Each Ledge tmux session's own OPENRIG_SESSION_NAME: a value, null (not set), or absent (cannot be read). */
  const withEnv = (own: Record<string, string | null>) => {
    const t = fakeTmux({});
    t.sessionEnv = async (name: string, variable: string) => (variable === 'OPENRIG_SESSION_NAME' && name in own ? own[name] : undefined);
    return t;
  };
  const event = () => ({ name: 'SessionStart' as const, at: T0, source: 'hook' as const });
  it('at start, a saved tag is dropped from an agent whose session only inherited it; real seats and unreadable ones keep theirs', async () => {
    await srv.close();
    store.upsert(mk('ec85', { name: 'Max', cwd: '/w/payment', rig }));                     // Desktop's launch, the seat from the server's env
    store.upsert(mk('8566', { name: 'Advisor-lead@kernel-2', rig }));                       // OpenRig's `ledge claude`: its own session carries it
    store.upsert(mk('q', { source: 'rig', tmuxSession: 'queue-worker@kernel', rig: { seat: 'queue-worker@kernel', name: 'kernel' } }));
    store.upsert(mk('gone', { rig }));                                                      // its tmux cannot say
    tmux = withEnv({ 'ledge-ec85': null, 'ledge-8566': SEAT });
    srv = await startServer({ store, tmux, port: 0 });
    await until(() => store.get('ec85')?.rig === undefined);
    expect(store.get('8566')?.rig).toEqual(rig);
    expect(store.get('q')?.rig?.seat).toBe('queue-worker@kernel');
    expect(store.get('gone')?.rig).toEqual(rig);
    // A front that refreshes reads Max without a seat: back to his project.
    const c = await connect({ port: srv.port });
    expect((await c.next('snapshot')).sessions.find(s => s.id === 'ec85')).not.toHaveProperty('rig');
    c.close();
  });
  it('at the next hook: an agent still claiming the seat its process inherited gets no tag; a real seat gets it', async () => {
    await srv.close();
    tmux = withEnv({ 'ledge-max': null, 'ledge-lead': SEAT });
    srv = await startServer({ store, tmux, port: 0 });
    store.upsert(mk('max', { name: 'Max' }));
    store.upsert(mk('lead', { name: 'Lead' }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.event', id: 'lead', event: event(), agent: 'claude', rigSeat: SEAT });
    c.send({ type: 'session.event', id: 'max', event: event(), agent: 'claude', rigSeat: SEAT });
    await until(() => store.get('lead')?.rig?.seat === SEAT);
    await new Promise(r => setTimeout(r, 200));
    expect(store.get('max')?.rig).toBeUndefined();
    // A tag saved by an older daemon goes at its next hook too, not only at start.
    store.upsert(mk('max', { name: 'Max', rig }));
    c.send({ type: 'session.event', id: 'max', event: event(), agent: 'claude', rigSeat: SEAT });
    await until(() => store.get('max')?.rig === undefined);
    c.close();
  });
  it('two checks answered in reverse order: only the latest counts, a late failed read never tags again', async () => {
    await srv.close();
    // Each read waits until the test answers it: the first ends unreadable after the second said « not carried ».
    const pending: ((v: string | null | undefined) => void)[] = [];
    tmux = fakeTmux({});
    tmux.sessionEnv = () => new Promise(r => { pending.push(r); });
    srv = await startServer({ store, tmux, port: 0 });
    store.upsert(mk('max', { name: 'Max' }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.event', id: 'max', event: event(), agent: 'claude', rigSeat: SEAT });
    await until(() => pending.length === 1);
    c.send({ type: 'session.event', id: 'max', event: event(), agent: 'claude', rigSeat: SEAT });
    await until(() => pending.length === 2);
    pending[1]!(null);
    await new Promise(r => setTimeout(r, 50));
    pending[0]!(undefined);
    await new Promise(r => setTimeout(r, 100));
    expect(store.get('max')?.rig).toBeUndefined();
    // Nor an answer for a session that changed meanwhile (resumed in another tmux session).
    c.send({ type: 'session.event', id: 'max', event: event(), agent: 'claude', rigSeat: SEAT });
    await until(() => pending.length === 3);
    store.upsert({ ...store.get('max')!, tmuxSession: 'ledge-max2' });
    pending[2]!(SEAT);
    await new Promise(r => setTimeout(r, 100));
    expect(store.get('max')?.rig).toBeUndefined();
    c.close();
  });
  it('a seat whose session cannot be read, or another source, is taken at its hook\'s word as before', async () => {
    await srv.close();
    tmux = withEnv({});
    srv = await startServer({ store, tmux, port: 0 });
    store.upsert(mk('a'));
    store.upsert(mk('h', { source: 'hook_only', tmuxSession: null }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.event', id: 'a', event: event(), agent: 'claude', rigSeat: SEAT });
    c.send({ type: 'session.event', id: 'h', event: event(), agent: 'claude', rigSeat: 'dev-back@ledge-dev' });
    await until(() => store.get('a')?.rig?.seat === SEAT && store.get('h')?.rig?.seat === 'dev-back@ledge-dev');
    c.close();
  });
});
