import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Session, Team } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { until } from './helpers.js';

// Lot E, task 1: inside a team only the lead puts questions to Ledge; the other seats ask their lead.

function fakeTmux(): Tmux {
  const panes = new Set<string>();
  return {
    async newSession(o) { panes.add(o.name); },
    async sendText() {}, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
    async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
}

const TO_LEAD = 'seul le lead pose les questions à Ledge : pose la tienne à ton lead (ledge task give @leader "<question>" "<options>")';
const LEAD_ASK = 'dans une équipe, pose ta question avec ledge task give ledge "<question>" "<options>" : Ledge la tranche selon le mandat ou la remonte';
const at = '2026-11-01T08:00:00.000Z';

let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let work: string; let c: Client;
const role = (id: string, front: string) => { mkdirSync(join(process.env.LEDGE_HOME!, 'roles'), { recursive: true }); writeFileSync(join(process.env.LEDGE_HOME!, 'roles', `${id}.md`), `---\n${front}\n---\nTu es ${id}.\n`); };
const seatOf = (team: Team, r: string) => team.seats.find(s => s.role === r)!.sessionId!;

beforeEach(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-lead-'));
  work = mkdtempSync(join(tmpdir(), 'ledge-work-'));
  role('leader', 'label: Lead'); role('review', 'label: Relecteur\ntool: codex');
  store = new Store();
  srv = await startServer({ store, tmux: fakeTmux(), port: 0, claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
  c = await connect({ port: srv.port }); await c.next('snapshot');
});
afterEach(async () => { await c.close(); await srv.close(); });

async function launch() {
  c.send({ type: 'team.launch', rid: 'r1', cwd: work, name: 'api', seats: [{ role: 'leader' }, { role: 'review', tool: 'codex' as const }] });
  const { team } = await c.next('team.launched', 5000);
  return { lead: seatOf(team, 'leader'), review: seatOf(team, 'review') };
}
async function give(by: string) {
  c.send({ type: 'task.cmd', rid: `g-${by}`, by, op: 'give', to: 'ledge', title: 'Fusionner ?', text: 'oui\nnon' });
  return c.next('task.result', 3000);
}
async function ask(by: string) {
  c.send({ type: 'ask.create', rid: `a-${by}`, by, question: 'Fusionner ?', options: 'oui\nnon' });
  return c.next('ask.result', 3000);
}

describe('only a team lead puts questions to Ledge', () => {
  it('task give ledge: a non-lead seat is refused, the lead creates the decision', async () => {
    const { lead, review } = await launch();
    expect(await give(review)).toMatchObject({ reason: TO_LEAD });
    const ok = await give(lead);
    expect(ok.reason).toBeUndefined();
    expect(ok.task).toMatchObject({ giver: lead, owner: 'ledge', state: 'open' });
  });

  it('ask.create: a seat of a live team is refused (lead and others, each its words); a lone session passes', async () => {
    const { lead, review } = await launch();
    expect(await ask(lead)).toMatchObject({ code: 'not_session', reason: LEAD_ASK });
    expect(await ask(review)).toMatchObject({ code: 'not_session', reason: TO_LEAD });
    const lone: Session = { id: 'solo', name: 'Solo', tool: 'claude', cwd: '/w/x', project: 'x', title: 'Solo · x', tmuxSession: 'ledge-solo', state: 'idle', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher' };
    store.upsert(lone);
    const r = await ask('solo');
    expect(r.code).toBeUndefined();
    expect(r.ask).toMatchObject({ from: 'solo', state: 'open' });
  });

  it('a session that left its team, or whose team was dissolved, puts its question to Ledge as a lone one', async () => {
    c.send({ type: 'team.launch', rid: 'r1', cwd: work, name: 'api', seats: [{ role: 'leader' }, { role: 'review', tool: 'codex' as const }] });
    const { team } = await c.next('team.launched', 5000);
    const review = seatOf(team, 'review'); const lead = seatOf(team, 'leader');
    c.send({ type: 'team.leave', team: team.id, session: review });
    await until(async () => (await give(review)).reason === undefined);
    c.send({ type: 'team.dissolve', team: team.id });
    await until(async () => (await give(lead)).reason === undefined);
  });
});
