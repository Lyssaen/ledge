import { describe, it, expect } from 'vitest';
import { WebSocketServer } from 'ws';
import { sendMessage } from '../src/cli/send.js';

/** A daemon that answers every `session.message` with `ack`, and keeps what it received. */
async function fakeDaemon(ack: { outcome: string; reason?: string }) {
  const got: Array<Record<string, unknown>> = [];
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await new Promise(r => wss.once('listening', r));
  wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'snapshot', sessions: [] }));
    ws.on('message', d => { const m = JSON.parse(String(d)); got.push(m); if (m.type === 'session.message') ws.send(JSON.stringify({ type: 'message.ack', rid: m.rid, ...ack })); });
  });
  return { got, port: (wss.address() as { port: number }).port, close: () => wss.close() };
}

describe('ledge send', () => {
  it('accepted: the message is handed over', async () => {
    const d = await fakeDaemon({ outcome: 'accepted' });
    try {
      expect(await sendMessage(['Pim', 'Salut'], { port: d.port, env: { LEDGE_SESSION: 'a' } })).toEqual({ line: 'remis à Pim', code: 0 });
      expect(d.got).toHaveLength(1);
      expect(d.got[0]).toMatchObject({ type: 'session.message', from: 'a', to: 'Pim', text: 'Salut' });
      expect(d.got[0]).not.toHaveProperty('intercept');
      expect(d.got[0]).not.toHaveProperty('summary');
      expect(typeof d.got[0]!.rid).toBe('string');
    } finally { d.close(); }
  });
  it('queued: the target is busy', async () => {
    const d = await fakeDaemon({ outcome: 'queued' });
    try { expect(await sendMessage(['Pim', 'Salut'], { port: d.port, env: { LEDGE_SESSION: 'a' } })).toEqual({ line: "Pim est occupé : il le recevra dès qu'il sera libre", code: 0 }); } finally { d.close(); }
  });
  it('refused: says why, exit 1', async () => {
    const d = await fakeDaemon({ outcome: 'refused', reason: 'Pim est introuvable' });
    try { expect(await sendMessage(['Pim', 'Salut'], { port: d.port, env: { LEDGE_SESSION: 'a' } })).toEqual({ line: 'refusé : Pim est introuvable', code: 1 }); } finally { d.close(); }
  });
  it('passes --summary through, wherever it stands', async () => {
    const d = await fakeDaemon({ outcome: 'accepted' });
    try {
      await sendMessage(['--summary', 'Un salut', 'Pim', 'Salut'], { port: d.port, env: { LEDGE_SESSION: 'a' } });
      expect(d.got[0]).toMatchObject({ to: 'Pim', text: 'Salut', summary: 'Un salut' });
    } finally { d.close(); }
  });
  it('reads the sender from LEDGE_CODEX_HOOK_SESSION before LEDGE_SESSION, and `from` before both', async () => {
    const d = await fakeDaemon({ outcome: 'accepted' });
    try {
      await sendMessage(['Pim', 'x'], { port: d.port, env: { LEDGE_CODEX_HOOK_SESSION: 'codex-1', LEDGE_SESSION: 'shared' } });
      await sendMessage(['Pim', 'x'], { port: d.port, env: { LEDGE_SESSION: 'a' }, from: 'hook-9' });
      expect(d.got.map(m => m.from)).toEqual(['codex-1', 'hook-9']);
    } finally { d.close(); }
  });
  it('without a sender id, says it only works in a Ledge session', async () => {
    expect(await sendMessage(['Pim', 'Salut'], { port: 1, env: {} })).toEqual({ line: 'ledge send ne marche que dans une session lancée par Ledge', code: 1 });
  });
  it('with no daemon listening, says so', async () => {
    const r = await sendMessage(['Pim', 'Salut'], { port: 1, env: { LEDGE_SESSION: 'a' } });
    expect(r.code).toBe(1);
    expect(r.line).toMatch(/^daemon not running/);
  });
  it('bad usage prints the usage line', async () => {
    const usage = 'ledge send <nom> "<message>" [--summary <texte>]   write to another Ledge session';
    for (const args of [[], ['Pim'], ['Pim', 'a', 'b'], ['Pim', 'a', '--summary']]) expect(await sendMessage(args, { port: 1, env: { LEDGE_SESSION: 'a' } })).toEqual({ line: usage, code: 1 });
  });
});
