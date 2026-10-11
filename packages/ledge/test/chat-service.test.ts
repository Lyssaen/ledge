import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as nodeSpawn } from 'node:child_process';
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
    expect(JSON.parse(readFileSync(join(home, 'chat.json'), 'utf8'))).toEqual({ day: '2026-10-11', sessionId: '33333333-3333-4333-8333-333333333333' });
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
    return { chat, spawned, store };
  }

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

  it('runs claude as the chat: LEDGE_CHAT set, LEDGE_SESSION and LEDGE_NAME removed', async () => {
    const { chat, spawned } = setup({ env: async () => ({ ...process.env, LEDGE_SESSION: 's', LEDGE_NAME: 'Otto' }) });
    await chat.ask('q1', 'x', () => {});
    expect(spawned[0]?.LEDGE_CHAT).toBe('1');
    expect(spawned[0]).not.toHaveProperty('LEDGE_SESSION');
    expect(spawned[0]).not.toHaveProperty('LEDGE_NAME');
  });

  it('records each step once and keeps only the last 50 turns', async () => {
    const { chat } = setup();
    for (let i = 0; i < 51; i++) await chat.ask(`q${i}`, 'x', () => {});
    expect(chat.history()).toHaveLength(50);
    expect(chat.history()[0]?.qid).toBe('q1');
    expect(chat.history().at(-1)?.steps).toEqual([{ kind: 'sessions' }]);
  });
});
