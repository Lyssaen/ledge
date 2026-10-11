import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/client.js', () => ({ connect: vi.fn(async () => { throw new Error('no daemon in this test'); }) }));
import { connect } from '../src/client.js';
import { runHook } from '../src/cli/hook.js';

describe('runHook under LEDGE_CHAT', () => {
  it('never reaches the daemon for Ledge\'s own chat, and does otherwise', async () => {
    const payload = JSON.stringify({ session_id: 's', prompt: 'hi' });
    const before = process.env.LEDGE_CHAT; process.env.LEDGE_CHAT = '1';
    try { await runHook('UserPromptSubmit', payload, { port: 1, timeoutMs: 50 }); expect(connect).not.toHaveBeenCalled(); }
    finally { if (before === undefined) delete process.env.LEDGE_CHAT; else process.env.LEDGE_CHAT = before; }
    delete process.env.LEDGE_CHAT;
    await runHook('UserPromptSubmit', payload, { port: 1, timeoutMs: 50 }); expect(connect).toHaveBeenCalledTimes(1);
  });
});
