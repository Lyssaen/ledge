import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import type { Tmux } from '../src/tmux.js';
import { runAsk } from '../src/cli/ask.js';
import { runDecide } from '../src/cli/decide.js';
import { connect } from '../src/client.js';

// `ledge decide` over asks (`a…`) and a seat's task decisions (`t…`): the listing shows both, the id prefix routes the answer.
const at = '2026-10-30T08:00:00.000Z';
const sess = (id: string, name: string): Session => ({ id, name, tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: `${name} · ledge`, tmuxSession: `ledge-${id}`,
  state: 'idle', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher' });

describe('ledge decide: asks and task decisions', () => {
  let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let sent: Array<[string, string]>;
  const prior = process.env.LEDGE_HOME;
  const user = () => ({ port: srv.port, env: {} });
  /** Rex puts a decision to the user as a task given to Ledge. */
  async function taskDecision(): Promise<string> {
    const c = await connect({ port: srv.port });
    try {
      c.send({ type: 'task.cmd', rid: 'give', by: 'rex', op: 'give', to: 'ledge', title: 'Fusionner ?', text: 'oui\nnon' });
      return (await c.next('task.result', 3000)).task!.id;
    } finally { await c.close(); }
  }
  beforeEach(async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-decide-'));
    store = new Store({ journalPath: join(process.env.LEDGE_HOME, 'j.json') });
    store.upsert(sess('nova', 'Nova')); store.upsert(sess('rex', 'Rex'));
    sent = [];
    const tmux: Tmux = { async newSession() {}, async sendText(name, text) { sent.push([name, text]); }, async sendKeys() {}, async capture() { return ''; }, async hasSession() { return true; },
      async listSessions() { return []; }, async setOption() {}, async killSession() {}, attachArgs: n => ['attach', n] };
    srv = await startServer({ store, tmux, port: 0 });
  });
  afterEach(async () => { await srv.close(); if (prior === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = prior; });

  it('lists a pending ask and a pending task decision together', async () => {
    const asked = await runAsk(['Quelle base ?', 'Postgres\nSQLite'], { port: srv.port, env: { LEDGE_SESSION: 'nova' } });
    const askId = /(a[0-9a-f]{6})/.exec(asked.line)![1]!;
    const taskId = await taskDecision();
    expect(await runDecide([], user())).toEqual({
      line: `${askId}  de Nova  Quelle base ?\n    Postgres\n    SQLite\n\n${taskId}  de Rex  Fusionner ?\n    oui\n    non`, code: 0 });
  });

  it('routes an answer by id: a… to the ask, otherwise to the task decision', async () => {
    const asked = await runAsk(['Quelle base ?', 'Postgres'], { port: srv.port, env: { LEDGE_SESSION: 'nova' } });
    const askId = /(a[0-9a-f]{6})/.exec(asked.line)![1]!;
    const taskId = await taskDecision();
    expect(await runDecide([askId, 'Postgres'], user())).toEqual({ line: 'réponse envoyée à Nova', code: 0 });
    expect(sent.some(([n, t]) => n === 'ledge-nova' && t.includes('Postgres'))).toBe(true);
    // The task answer is confirmed by the CLI itself (typed by the user) and closes the decision.
    expect((await runDecide([taskId, 'oui'], user())).code).toBe(0);
    expect(await runDecide([], user())).toEqual({ line: 'aucune décision en attente', code: 0 });
    expect(await runDecide([taskId, 'non'], user())).toMatchObject({ code: 1, line: expect.stringContaining('refusé') });
  });
});
