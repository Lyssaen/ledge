import { describe, expect, it } from 'vitest';
import type { RoutingContext } from '@ledge/protocol';
import { createRouter, parseRoute } from '../src/chat/routing.js';
import type { RunOptions } from '../src/chat/claude.js';

const context: RoutingContext = { machines: [{ id: 'local', label: 'Local', local: true, online: true, sessions: [], folders: [] }, { id: 'server', label: 'Server', local: false, online: false, sessions: [], folders: [] }], history: [] };
describe('read-only chat router', () => {
  it('accepts clarification and offline destinations but rejects unknown or conflicting targets', () => {
    expect(parseRoute('```json\n{"machineId":null,"text":"Où ?","choices":["local","server"]}\n```', context).choices).toHaveLength(2);
    expect(parseRoute('{"machineId":"server","text":"Lire"}', context).machineId).toBe('server');
    expect(() => parseRoute('{"machineId":"unknown","text":"Lire"}', context)).toThrow();
    expect(() => parseRoute('{"machineId":null,"text":"Où ?","choices":["unknown"]}', context)).toThrow();
    expect(() => parseRoute('{"machineId":"local","text":"Lire","choices":["server"]}', context)).toThrow();
  });
  it('isolates routing from session context and passes inventory as data', async () => {
    let options: RunOptions | undefined;
    const router = createRouter({ env: async () => ({ LEDGE_SESSION: 'parent', LEDGE_NAME: 'Otto', ANTHROPIC_API_KEY: 'test-only' }), run: (o, emit) => {
      options = o; emit({ type: 'result', text: '{"machineId":null,"text":"Où ?","choices":["local","server"]}', isError: false });
      return { done: Promise.resolve({ code: 0, stderr: '' }), kill() {} };
    } });
    expect(await router.route({ type: 'chat.route', qid: 'q', text: 'Lance', context })).toMatchObject({ machineId: null });
    expect(options?.addDirs).toEqual([]); expect(options?.resume).toBe(false);
    expect(options?.env).toEqual({ LEDGE_CHAT: '1' });
    expect(JSON.parse(options!.question)).toEqual({ context, request: 'Lance' });
    expect(options?.persona).toContain('clarification');
  });
  it('times out, kills the harness, then accepts a new request', async () => {
    let killed = 0;
    const router = createRouter({ env: async () => ({}), timeoutMs: 5, run: () => {
      let done!: (r: { code: number; stderr: string }) => void;
      return { done: new Promise(r => { done = r; }), kill: () => { killed++; done({ code: 1, stderr: '' }); } };
    } });
    const req = { type: 'chat.route' as const, qid: 'q', text: 'Lance', context };
    await expect(router.route(req)).rejects.toThrow('timed out');
    await expect(router.route(req)).rejects.toThrow('timed out');
    expect(killed).toBe(2);
  });
  it('can cancel while the environment is loading without spawning a harness', async () => {
    let release!: (e: NodeJS.ProcessEnv) => void;
    const env = new Promise<NodeJS.ProcessEnv>(r => { release = r; });
    const router = createRouter({ env: () => env, run: () => { throw new Error('must not spawn'); } });
    const result = router.route({ type: 'chat.route', qid: 'q', text: 'Lance', context });
    router.cancel('q'); release({});
    await expect(result).rejects.toThrow('cancelled');
  });
});
