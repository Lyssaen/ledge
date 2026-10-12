import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ServerMessage } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createChat } from '../src/chat/service.js';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const tmux = { async capture() { return null; } } as any;
describe('chat service', () => {
  it('resumes the day session, and starts a new one when the resume fails', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-'));
    writeFileSync(join(home, 'chat.json'), JSON.stringify({ day: '2026-10-11', sessionId: '22222222-2222-4222-8222-222222222222' }));
    let calls = 0;
    const chat = createChat({ store: new Store({ journalPath: join(home, 'j.json') }), tmux, home, today: () => '2026-10-11', uuid: () => '33333333-3333-4333-8333-333333333333',
      env: async () => ({ ...process.env, FAKE_CLAUDE_MODE: calls++ === 0 ? 'fail' : 'ok' }), bin: [process.execPath, FAKE] });
    const out: ServerMessage[] = [];
    await chat.ask('q1', 'x', m => out.push(m));
    expect(out.at(-1)?.type).toBe('chat.done');
    expect(JSON.parse(readFileSync(join(home, 'chat.json'), 'utf8'))).toEqual({ day: '2026-10-11', sessionId: '33333333-3333-4333-8333-333333333333', tool: 'claude' });
  });
  it('a new day forgets yesterday\'s turns and session', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-'));
    writeFileSync(join(home, 'chat.json'), JSON.stringify({ day: '2026-10-10', sessionId: '22222222-2222-4222-8222-222222222222' }));
    const chat = createChat({ store: new Store({ journalPath: join(home, 'j.json') }), tmux, home, today: () => '2026-10-11', uuid: () => '44444444-4444-4444-8444-444444444444', env: async () => ({ ...process.env }), bin: [process.execPath, FAKE] });
    await chat.ask('q1', 'x', () => {});
    expect(chat.history()).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(home, 'chat.json'), 'utf8')).sessionId).toBe('44444444-4444-4444-8444-444444444444');
  });

  /** A chat over a temp home whose day file already names today (so the question resumes), counting spawns and keeping their env. */
  function setup(extra: Partial<Parameters<typeof createChat>[0]> = {}) {
    const home = mkdtempSync(join(tmpdir(), 'ledge-'));
    writeFileSync(join(home, 'chat.json'), JSON.stringify({ day: '2026-10-11', sessionId: '22222222-2222-4222-8222-222222222222' }));
    const spawned: NodeJS.ProcessEnv[] = [];
    const spawn = ((file: string, args: string[], o: { env: NodeJS.ProcessEnv }) => { spawned.push(o.env); return nodeSpawn(file, args, o as never); }) as unknown as typeof nodeSpawn;
    const store = new Store({ journalPath: join(home, 'j.json') });
    const chat = createChat({ store, tmux, home, today: () => '2026-10-11', env: async () => ({ ...process.env }), bin: [process.execPath, FAKE], spawn, ...extra });
    return { chat, spawned, store, home };
  }

  it('reset clears the turns, forgets the day file, and the next question starts a new session (--session-id, not --resume)', async () => {
    const args: string[][] = [];
    const spawn = ((file: string, a: string[], o: object) => { args.push(a); return nodeSpawn(file, a, o as never); }) as unknown as typeof nodeSpawn;
    const { chat, home } = setup({ spawn, uuid: () => '55555555-5555-4555-8555-555555555555' });
    await chat.ask('q1', 'x', () => {});
    expect(args[0]).toContain('--resume');
    const out: ServerMessage[] = [];
    await chat.reset(m => out.push(m));
    expect(out).toEqual([{ type: 'chat.history', turns: [] }]);
    expect(chat.history()).toEqual([]);
    expect(existsSync(join(home, 'chat.json'))).toBe(false);
    await chat.ask('q2', 'y', () => {});
    expect(args[1]).not.toContain('--resume');
    expect(args[1]![args[1]!.indexOf('--session-id') + 1]).toBe('55555555-5555-4555-8555-555555555555');
    expect(JSON.parse(readFileSync(join(home, 'chat.json'), 'utf8')).sessionId).toBe('55555555-5555-4555-8555-555555555555');
    await chat.ask('q3', 'z', () => {});
    expect(args[2]![args[2]!.indexOf('--resume') + 1]).toBe('55555555-5555-4555-8555-555555555555');
  });

  it('a reset while a question runs is ignored', async () => {
    const { chat, spawned } = setup({ env: async () => ({ ...process.env, FAKE_CLAUDE_MODE: 'slow' }) });
    const asked = chat.ask('q1', 'x', () => {});
    while (spawned.length === 0) await new Promise(r => setTimeout(r, 10));
    const out: ServerMessage[] = [];
    await chat.reset(m => out.push(m));
    expect(out).toEqual([]); expect(chat.history()).toHaveLength(1);
    chat.cancel('q1'); await asked;
  });

  it('a timeout kills the run, says so, and is not retried with a fresh session', async () => {
    const { chat, spawned } = setup({ timeoutMs: 300, env: async () => ({ ...process.env, FAKE_CLAUDE_MODE: 'slow' }) });
    const out: ServerMessage[] = [];
    await chat.ask('q1', 'x', m => out.push(m));
    expect(out.at(-1)).toEqual({ type: 'chat.error', qid: 'q1', message: 'Claude Code did not answer within 3 minutes' });
    expect(spawned).toHaveLength(1);
    expect(chat.history()[0]?.error).toBe('Claude Code did not answer within 3 minutes');
  });

  it('cancel ends the turn with "cancelled" and emits chat.error so the overlay unlocks', async () => {
    const { chat, spawned } = setup({ env: async () => ({ ...process.env, FAKE_CLAUDE_MODE: 'slow' }) });
    const out: ServerMessage[] = [];
    const asked = chat.ask('q1', 'x', m => out.push(m));
    while (spawned.length === 0) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 100));
    chat.cancel('q1');
    await asked;
    expect(out.at(-1)).toEqual({ type: 'chat.error', qid: 'q1', message: 'cancelled' });
    expect(chat.history()[0]?.error).toBe('cancelled');
    expect(spawned).toHaveLength(1);
  });

  it('a cancel while the context is still being built stops before any spawn', async () => {
    const slowTmux = { async capture() { await new Promise(r => setTimeout(r, 200)); return 'line'; } } as any;
    const { chat, spawned, store, home } = setup({ tmux: slowTmux });
    store.upsert({ id: 'a', name: 'Otto', tool: 'claude', cwd: home, project: 'p', title: 'Otto · p', tmuxSession: 'ledge-a', state: 'working', helpers: [], startedAt: '2026-10-11T10:00:00.000Z', lastActivityAt: '2026-10-11T10:00:00.000Z', source: 'launcher' });
    const out: ServerMessage[] = [];
    const asked = chat.ask('q1', 'x', m => out.push(m));
    chat.cancel('q1');
    await asked;
    expect(spawned).toHaveLength(0);
    expect(out.at(-1)).toEqual({ type: 'chat.error', qid: 'q1', message: 'cancelled' });
    expect(chat.history()[0]?.error).toBe('cancelled');
  });

  it('runs claude as the chat: LEDGE_CHAT set, LEDGE_SESSION, LEDGE_NAME and ANTHROPIC_API_KEY removed', async () => {
    const { chat, spawned } = setup({ env: async () => ({ ...process.env, LEDGE_SESSION: 's', LEDGE_NAME: 'Otto', ANTHROPIC_API_KEY: 'sk-inherited' }) });
    await chat.ask('q1', 'x', () => {});
    expect(spawned[0]?.LEDGE_CHAT).toBe('1');
    expect(spawned[0]).not.toHaveProperty('LEDGE_SESSION');
    expect(spawned[0]).not.toHaveProperty('LEDGE_NAME');
    expect(spawned[0]).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('removes the context folder once the run has ended', async () => {
    const { chat, home } = setup();
    await chat.ask('q1', 'x', () => {});
    expect(chat.history()[0]?.answer).toBeTruthy();
    expect(existsSync(join(home, 'chat', 'context'))).toBe(false);
  });

  it('announces the turn with chat.history before anything streams', async () => {
    const { chat } = setup();
    const out: ServerMessage[] = [];
    await chat.ask('q1', 'x', m => out.push(structuredClone(m)));
    expect(out[0]).toMatchObject({ type: 'chat.history', turns: [{ qid: 'q1', question: 'x', steps: [] }] });
    expect((out[0] as Extract<ServerMessage, { type: 'chat.history' }>).turns[0]).not.toHaveProperty('answer');
    expect(out[1]?.type).toBe('chat.step');
  });

  it('records the sessions step once', async () => {
    const { chat } = setup();
    await chat.ask('q1', 'x', () => {});
    expect(chat.history().at(-1)?.steps).toEqual([{ kind: 'sessions' }]);
  });

  it('keeps only the last 50 turns (in-process fake child, no real spawn)', async () => {
    const spawn = (() => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => { child.emit('close', null); } });
      setImmediate(() => {
        child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }) + '\n');
        child.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's' }) + '\n');
        setImmediate(() => child.emit('close', 0));
      });
      return child;
    }) as unknown as typeof nodeSpawn;
    const { chat } = setup({ spawn });
    for (let i = 0; i < 51; i++) await chat.ask(`q${i}`, 'x', () => {});
    expect(chat.history()).toHaveLength(50);
    expect(chat.history()[0]?.qid).toBe('q1');
  });

  it('runs Codex when asked, and a later Claude question starts a new session', async () => {
    const args: string[][] = [];
    const spawn = ((file: string, a: string[], o: object) => { args.push(a); return nodeSpawn(file, a, o as never); }) as unknown as typeof nodeSpawn;
    const { chat, home } = setup({ spawn, env: async () => ({ ...process.env, FAKE_AGENT: 'codex' }) });
    await chat.ask('q1', 'x', () => {}, 'codex');
    expect(args[0]).toContain('exec');
    expect(JSON.parse(readFileSync(join(home, 'chat.json'), 'utf8'))).toMatchObject({ tool: 'codex' });
    await chat.ask('q2', 'y', () => {}, 'claude');
    expect(args[1]).toContain('--session-id');
    expect(args[1]).not.toContain('exec');
    expect(JSON.parse(readFileSync(join(home, 'chat.json'), 'utf8'))).toMatchObject({ tool: 'claude' });
  });

  const fence = (json: string) => 'Je te propose cette session.\n\n```ledge-session\n' + json + '\n```';

  it('gives Ledge the recent folders in folders.md', async () => {
    const { chat, store } = setup({ env: async () => ({ ...process.env, FAKE_CLAUDE_MODE: 'folders' }) });
    store.touchRecent('/w/ledge', 'ledge', '2026-10-11T09:00:00.000Z');
    await chat.ask('q1', 'x', () => {});
    expect(chat.history()[0]!.answer).toContain('- ledge: /w/ledge');
  });

  it('a valid block becomes the turn proposal, joined to chat.done, and leaves the text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proj-'));
    const { chat } = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: fence(`{"cwd": "${dir}/", "prompt": " Corrige le build "}`) }) });
    const out: ServerMessage[] = [];
    await chat.ask('q1', 'ouvre une session pour corriger le build', m => out.push(m));
    const proposal = { cwd: dir, project: basename(dir), tool: 'claude', prompt: 'Corrige le build' };
    expect(out.find(m => m.type === 'chat.done')).toEqual({ type: 'chat.done', qid: 'q1', text: 'Je te propose cette session.', at: expect.any(String), proposal });
    expect(chat.history()[0]).toMatchObject({ answer: 'Je te propose cette session.', proposal });
    expect(chat.proposal('q1')).toEqual(proposal);
  });

  it('a ~ path resolves against the user home, a blank prompt means an empty session', async () => {
    const userHome = mkdtempSync(join(tmpdir(), 'home-')); mkdirSync(join(userHome, 'ledge'));
    const { chat } = setup({ userHome, env: async () => ({ ...process.env, FAKE_ANSWER: fence('{"cwd": "~/ledge/", "prompt": "   "}') }) });
    await chat.ask('q1', 'x', () => {});
    expect(chat.proposal('q1')).toEqual({ cwd: join(userHome, 'ledge'), project: 'ledge', tool: 'claude' });
  });

  it('no card for a missing folder, a file, or a bad block; the text is shown without the block', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'f-')), 'a.txt'); writeFileSync(file, 'x');
    for (const json of ['{"cwd": "/nope/ledge-missing"}', `{"cwd": "${file}"}`, '{"cwd":', '{"prompt": "x"}']) {
      const { chat } = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: fence(json) }) });
      const out: ServerMessage[] = [];
      await chat.ask('q1', 'x', m => out.push(m));
      const done = out.find(m => m.type === 'chat.done');
      expect(done).toEqual({ type: 'chat.done', qid: 'q1', text: 'Je te propose cette session.', at: expect.any(String) });
      expect(chat.proposal('q1')).toBeUndefined();
    }
  });

  it('markLaunched and markFailed update the proposal and tell every client', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proj-'));
    const { chat } = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: fence(`{"cwd": "${dir}"}`) }) });
    await chat.ask('q1', 'x', () => {});
    const out: ServerMessage[] = [];
    chat.markFailed('q1', 'no such folder: /w', m => out.push(m));
    expect(out.at(-1)).toMatchObject({ type: 'chat.history', turns: [{ qid: 'q1', proposal: { cwd: dir, error: 'no such folder: /w' } }] });
    chat.markLaunched('q1', 'n1', m => out.push(m));
    expect(chat.proposal('q1')).toEqual({ cwd: dir, project: basename(dir), tool: 'claude', launchedId: 'n1' });
    expect(out).toHaveLength(2);
    chat.markLaunched('nope', 'n2', m => out.push(m)); chat.markFailed('nope', 'x', m => out.push(m));
    expect(out).toHaveLength(2);
  });
});
