import { describe, it, expect } from 'vitest';
import { WebSocketServer } from 'ws';
import { sendMessage, parseLedgeCommand } from '../src/cli/send.js';

/** A daemon that answers every `session.message` with `ack`, and keeps what it received. */
async function fakeDaemon(ack: { outcome: string; reason?: string } | null) {
  const got: Array<Record<string, unknown>> = [];
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await new Promise(r => wss.once('listening', r));
  wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'snapshot', sessions: [] }));
    ws.on('message', d => { const m = JSON.parse(String(d)); got.push(m); if (ack && m.type === 'session.message') ws.send(JSON.stringify({ type: 'message.ack', rid: m.rid, ...ack })); });
  });
  return { got, port: (wss.address() as { port: number }).port, close: () => wss.close() };
}

describe('parseLedgeCommand', () => {
  it('reads a lone ledge ask', () => {
    expect(parseLedgeCommand('ledge ask "Q ?" "A ou B"')).toEqual({ cmd: 'ask', args: ['Q ?', 'A ou B'] });
    expect(parseLedgeCommand('ledge ask "Q ?" "A" && ls')).toBeUndefined();
  });
});

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
  it('refused without a reason: says so', async () => {
    const d = await fakeDaemon({ outcome: 'refused' });
    try { expect(await sendMessage(['Pim', 'Salut'], { port: d.port, env: { LEDGE_SESSION: 'a' } })).toEqual({ line: 'refusé : raison inconnue', code: 1 }); } finally { d.close(); }
  });
  it('a text over the cap is refused before it is sent, with its length', async () => {
    const d = await fakeDaemon({ outcome: 'accepted' });
    try { expect(await sendMessage(['Pim', 'x'.repeat(20001)], { port: d.port, env: { LEDGE_SESSION: 'a' } })).toEqual({ line: 'refusé : message trop long (20001 caractères, 20000 au plus)', code: 1 }); } finally { d.close(); }
  });
  it('no ack after the send: not a refusal, within timeoutMs', async () => {
    const d = await fakeDaemon(null);
    try {
      const t = Date.now();
      expect(await sendMessage(['Pim', 'Salut'], { port: d.port, env: { LEDGE_SESSION: 'a' }, timeoutMs: 300 })).toEqual({ line: 'pas de réponse de Ledge : le message est peut-être déjà parti', code: 1 });
      expect(Date.now() - t).toBeLessThan(1000);
      expect(d.got).toHaveLength(1);
    } finally { d.close(); }
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
    expect(r.line).toBe('daemon not running (start a session with `ledge claude`, or run `ledge daemon`)');
  });
  it('bad usage prints the usage line', async () => {
    const usage = 'ledge send <nom> "<message>" [--summary <texte>]   write to another Ledge session';
    for (const args of [[], ['Pim'], ['Pim', 'a', 'b'], ['Pim', 'a', '--summary']]) expect(await sendMessage(args, { port: 1, env: { LEDGE_SESSION: 'a' } })).toEqual({ line: usage, code: 1 });
  });
});

describe('parseLedgeCommand', () => {
  it('reads a lone `ledge who` and `ledge send`', () => {
    expect(parseLedgeCommand('ledge who')).toEqual({ cmd: 'who' });
    expect(parseLedgeCommand('  ledge who ')).toEqual({ cmd: 'who' });
    expect(parseLedgeCommand('ledge who\n')).toEqual({ cmd: 'who' });
    expect(parseLedgeCommand('ledge send Otto "Tests verts\nje pousse"')).toEqual({ cmd: 'send', args: ['Otto', 'Tests verts\nje pousse'] });
    expect(parseLedgeCommand("ledge send Otto 'coût: $5'")).toEqual({ cmd: 'send', args: ['Otto', 'coût: $5'] });
    expect(parseLedgeCommand('ledge send Otto "dit \\"oui\\""')).toEqual({ cmd: 'send', args: ['Otto', 'dit "oui"'] });
    expect(parseLedgeCommand('ledge send Otto "a;b|c&d" --summary x#y')).toEqual({ cmd: 'send', args: ['Otto', 'a;b|c&d', '--summary', 'x#y'] });
    expect(parseLedgeCommand('ledge send Otto ""')).toEqual({ cmd: 'send', args: ['Otto', ''] });
  });
  it('reads a lone `ledge read <id>`, and nothing chained to it', () => {
    expect(parseLedgeCommand('ledge read m3fa21c')).toEqual({ cmd: 'read', args: ['m3fa21c'] });
    expect(parseLedgeCommand('ledge read m3fa21c | head')).toBeUndefined();
    expect(parseLedgeCommand('ledge read m3fa21c; ls')).toBeUndefined();
  });
  it('no longer reads ledge task', () => {
    expect(parseLedgeCommand('ledge task list')).toBeUndefined();
  });
  it('keeps a newline inside quotes literal, but an unquoted newline or carriage return is a command separator', () => {
    expect(parseLedgeCommand('ledge send Otto "a\nb"')).toEqual({ cmd: 'send', args: ['Otto', 'a\nb'] });
    expect(parseLedgeCommand('ledge send Otto "hi"\nls')).toBeUndefined();
    expect(parseLedgeCommand('ledge who\rls')).toBeUndefined();
  });
  it('rejects an unquoted glob or tilde, which the shell would expand, and keeps it literal when quoted', () => {
    for (const c of ['ledge send Otto *', 'ledge send Otto a?', 'ledge send Otto [a]', 'ledge send Otto ~', 'ledge send Otto {a,b}']) expect(parseLedgeCommand(c), c).toBeUndefined();
    expect(parseLedgeCommand(`ledge send Otto "a*b?[c]~{d}" '*'`)).toEqual({ cmd: 'send', args: ['Otto', 'a*b?[c]~{d}', '*'] });
  });
  it('rejects anything else', () => {
    for (const c of [
      'ledge who --all', 'ledge', 'ledge sendx Otto hi', 'ls', 'FOO=1 ledge who', '/usr/bin/ledge who', '',
      'ledge send Otto "a" && rm -rf x', 'ledge send Otto "a" ; ls', 'ledge send Otto "a" | cat', 'ledge send Otto "a" &',
      'ledge send Otto "$(cat f)"', 'ledge send Otto "`id`"', 'ledge send Otto $HOME', 'ledge send Otto $(id)', 'ledge send Otto `id`',
      'ledge send Otto "x" > f', 'ledge send Otto "x" < f', 'ledge who\nls', '(ledge who)', 'ledge send Otto hi # c', '#ledge who',
      'ledge send Otto "x', "ledge send Otto 'x", 'ledge send Otto a\;ls', 'ledge send Otto a\\ b'
    ]) expect(parseLedgeCommand(c), c).toBeUndefined();
  });
});
