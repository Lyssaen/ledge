import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
});
