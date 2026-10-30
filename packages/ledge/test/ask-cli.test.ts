import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import type { Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import type { Tmux } from '../src/tmux.js';
import { askArgs, runAsk } from '../src/cli/ask.js';
import { decideArgs, runDecide } from '../src/cli/decide.js';
import { connect } from '../src/client.js';

const at = '2026-10-30T08:00:00.000Z';
const sess = (id: string, name: string, extra: Partial<Session> = {}): Session => ({ id, name, tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: `${name} · ledge`, tmuxSession: `ledge-${id}`,
  state: 'idle', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher', ...extra });
const tmux = (): Tmux => ({ async newSession() {}, async sendText() {}, async sendKeys() {}, async capture() { return ''; }, async hasSession() { return true; }, async listSessions() { return []; },
  async setOption() {}, async killSession() {}, attachArgs: n => ['attach', n] });

describe('askArgs and decideArgs', () => {
  it('askArgs: exactly a non-empty question and an options string', () => {
    expect(askArgs(['Q ?', 'A, B (je recommande B)'])).toEqual({ question: 'Q ?', options: 'A, B (je recommande B)' });
    expect(askArgs(['Q ?'])).toBeUndefined();
    expect(askArgs(['', 'x'])).toBeUndefined();
    expect(askArgs(['Q ?', 'x', 'y'])).toBeUndefined();
  });
  it('decideArgs: nothing, or an ask id and a non-empty answer', () => {
    expect(decideArgs([])).toEqual({ op: 'list' });
    expect(decideArgs(['a1b2c3d', 'B'])).toEqual({ op: 'answer', id: 'a1b2c3d', text: 'B' });
    expect(decideArgs(['t1b2c3d', 'B'])).toBeUndefined();
    expect(decideArgs(['a1b2c3d', '  '])).toBeUndefined();
  });
});

describe('ledge ask and ledge decide against a daemon', () => {
  let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let sent: Array<[string, string]>;
  const asker = (id = 'nova') => ({ port: srv.port, env: { LEDGE_SESSION: id } });
  const user = () => ({ port: srv.port, env: {} });
  beforeEach(async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-ask-'));
    store = new Store({ journalPath: join(process.env.LEDGE_HOME, 'j.json') });
    store.upsert(sess('nova', 'Nova'));
    sent = [];
    const t = tmux(); t.sendText = async (name, text) => { sent.push([name, text]); };
    srv = await startServer({ store, tmux: t, port: 0 });
  });
  afterEach(async () => { await srv.close(); });

  it('runAsk outside a Ledge session: « ledge ask ne marche que dans une session lancée par Ledge », code 1', async () => {
    expect(await runAsk(['Q ?', 'A'], { port: srv.port, env: {} })).toEqual({ line: 'ledge ask ne marche que dans une session lancée par Ledge', code: 1 });
  });

  it('runAsk: « décision <id> posée à l\'utilisateur : sa réponse te réveillera », then decide lists it, answers it, and the asker is typed the answer', async () => {
    const asked = await runAsk(['Quelle base ?', 'Postgres\nSQLite (je recommande SQLite)'], asker());
    expect(asked.code).toBe(0);
    const id = /^décision (a[0-9a-f]{6}) posée à l'utilisateur : sa réponse te réveillera$/.exec(asked.line)![1]!;
    expect(await runDecide([], user())).toEqual({ line: `${id}  de Nova  Quelle base ?\n    Postgres\n    SQLite (je recommande SQLite)`, code: 0 });
    expect(await runDecide([id, 'SQLite'], user())).toEqual({ line: 'réponse envoyée à Nova', code: 0 });
    expect(await runDecide([], user())).toEqual({ line: 'aucune décision en attente', code: 0 });
    await until(() => sent.length > 0);
    expect(sent[0]![1]).toBe(`<ledge-answer id="${id}">Réponse de l'utilisateur à « Quelle base ? » : SQLite</ledge-answer>`);
  });

  it('runAsk from an unknown session is refused', async () => {
    expect(await runAsk(['Q ?', 'A'], asker('ghost'))).toMatchObject({ code: 1, line: expect.stringMatching(/^refusé : /) });
  });

  it('runDecide with none: « aucune décision en attente »', async () => {
    expect(await runDecide([], user())).toEqual({ line: 'aucune décision en attente', code: 0 });
  });

  it('runDecide <id> "<réponse>": a refusal prints « refusé : <raison> », code 1; two answers: the second is « déjà répondue » and one answer is typed', async () => {
    const id = /(a[0-9a-f]{6})/.exec((await runAsk(['Q ?', 'A ou B'], asker())).line)![1]!;
    expect(await runDecide(['a000000', 'B'], user())).toMatchObject({ code: 1, line: expect.stringMatching(/^refusé : aucune décision a000000/) });
    expect(await runDecide([id, 'A'], user())).toEqual({ line: 'réponse envoyée à Nova', code: 0 });
    expect(await runDecide([id, 'B'], user())).toEqual({ line: 'refusé : déjà répondue', code: 1 });
    await until(() => sent.length > 0); await new Promise(r => setTimeout(r, 50));
    expect(sent).toHaveLength(1);
    expect(sent[0]![1]).toContain('» : A<');
  });

  it('the asker exits before the answer: decide no longer lists it and refuses a late answer', async () => {
    const id = /(a[0-9a-f]{6})/.exec((await runAsk(['Q ?', 'A ou B'], asker())).line)![1]!;
    store.upsert(sess('nova', 'Nova', { state: 'exited' }));
    expect(await runDecide([], user())).toEqual({ line: 'aucune décision en attente', code: 0 });
    expect(await runDecide([id, 'B'], user())).toEqual({ line: "refusé : cette session s'est terminée avant ta réponse", code: 1 });
    expect(sent).toEqual([]);
  });

  it('a front connected after the ask gets it in `asks` after the snapshot, and ask.updated on a change', async () => {
    const id = /(a[0-9a-f]{6})/.exec((await runAsk(['Q ?', 'A ou B'], asker())).line)![1]!;
    const front = await connect({ port: srv.port });
    try {
      const snap = await front.next('snapshot'); expect(snap.daemon).toBeUndefined();
      expect((await front.next('asks')).asks.map(a => a.id)).toEqual([id]);
      await runDecide([id, 'B'], user());
      expect((await front.next('ask.updated')).ask).toMatchObject({ id, state: 'answered' });
    } finally { await front.close(); }
  });

  it('runDecide from a session env (LEDGE_SESSION or the Codex hook var) is refused before connecting', async () => {
    const refusal = { line: "refusé : ledge decide est la réponse de l'utilisateur, pas celle d'une session", code: 1 };
    expect(await runDecide([], { port: 1, env: { LEDGE_SESSION: 'nova' } })).toEqual(refusal);
    expect(await runDecide([], { port: 1, env: { LEDGE_CODEX_HOOK_SESSION: 'nova' } })).toEqual(refusal);
  });

  it('an older daemon that never sends asks: decide says it has no answer', async () => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await new Promise(r => wss.once('listening', r));
    wss.on('connection', ws => ws.send(JSON.stringify({ type: 'snapshot', sessions: [] })));
    try { expect(await runDecide([], { port: (wss.address() as { port: number }).port, env: {} })).toMatchObject({ code: 1, line: expect.stringContaining('pas de réponse de Ledge') }); } finally { wss.close(); }
  });
});

async function until(cond: () => boolean, ms = 2000) { const end = Date.now() + ms; while (!cond() && Date.now() < end) await new Promise(r => setTimeout(r, 10)); }
