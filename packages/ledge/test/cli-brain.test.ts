import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { runBrain, BRAIN_USAGE } from '../src/cli/brain.js';
import { NOT_BRAIN_LINE } from '../src/daemon/brain/commands.js';

const VARS = ['LEDGE_HOME'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(VARS.map(k => [k, process.env[k]]));
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-cli-brain-'));
});
afterEach(() => { for (const k of VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

/** A daemon that counts its connections and answers each brain.cmd with `line`. */
const fake = async (line = 'ok') => {
  const got: Array<Record<string, unknown>> = []; let connections = 0;
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await new Promise(r => wss.once('listening', r));
  wss.on('connection', ws => {
    connections++;
    ws.on('message', d => {
      const m = JSON.parse(String(d)); got.push(m);
      if (m.type === 'brain.cmd') ws.send(JSON.stringify({ type: 'brain.result', rid: m.rid, ok: m.op !== 'decide', line, ...(m.op === 'decide' ? { code: 'mandate' } : {}) }));
    });
  });
  return { got, connections: () => connections, port: (wss.address() as { port: number }).port, close: () => new Promise(r => wss.close(r)) };
};

describe('runBrain', () => {
  test('the CLI refuses outside the brain without calling the daemon', async () => {
    const d = await fake();
    try {
      expect(await runBrain(['rigs'], { port: d.port, env: {} })).toEqual({ line: NOT_BRAIN_LINE, code: 1 });
      // LEDGE_BRAIN without a session id is no brain either.
      expect(await runBrain(['rigs'], { port: d.port, env: { LEDGE_BRAIN: '1' } })).toEqual({ line: NOT_BRAIN_LINE, code: 1 });
      expect(d.connections()).toBe(0);
    } finally { await d.close(); }
  });

  test('from the brain: one brain.cmd as the session, with its key', async () => {
    const d = await fake('Noté.');
    try {
      const env = { LEDGE_BRAIN: '1', LEDGE_SESSION: 'brain', LEDGE_SESSION_KEY: 'k1' };
      expect(await runBrain(['say', 'Bonjour'], { port: d.port, env })).toEqual({ line: 'Noté.', code: 0 });
      expect(d.got).toEqual([expect.objectContaining({ type: 'brain.cmd', by: 'brain', key: 'k1', op: 'say', args: ['Bonjour'] })]);
      expect((await runBrain(['decide', 'x'], { port: d.port, env })).code).toBe(1);
    } finally { await d.close(); }
  });

  test('an unknown op gets the usage; a daemon down says so', async () => {
    const env = { LEDGE_BRAIN: '1', LEDGE_SESSION: 'brain' };
    expect(await runBrain([], { port: 1, env })).toEqual({ line: BRAIN_USAGE, code: 1 });
    expect(await runBrain(['explode'], { port: 1, env })).toEqual({ line: BRAIN_USAGE, code: 1 });
    expect((await runBrain(['rigs'], { port: 1, env })).line).toMatch(/daemon not running/);
  });
});
