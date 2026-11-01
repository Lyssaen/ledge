import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Team } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import type { MailState } from '../src/daemon/mailbox.js';
import { formatTeamNotice } from '../src/daemon/crossSession.js';
import { listRoles, parseRole } from '../src/daemon/roles.js';
import { seatContext } from '../src/daemon/seat.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';

// Lot C, task 2: the lead writes to the whole team with `@team`, the user with `team.broadcast`; `team` is a reserved role.

function fakeTmux(): Tmux {
  const panes = new Set<string>();
  return {
    async newSession(o) { panes.add(o.name); },
    async sendText() {}, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
    async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
}

type Item = MailState['queue'][number];
let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let work: string; let queued: Map<string, Item>; let home: string | undefined;
const role = (id: string) => { mkdirSync(join(process.env.LEDGE_HOME!, 'roles'), { recursive: true }); writeFileSync(join(process.env.LEDGE_HOME!, 'roles', `${id}.md`), `---\nlabel: ${id}\n---\nTu es ${id}.\n`); };
async function start() {
  store = new Store(); queued = new Map();
  const mail = { load: () => undefined, save: (s: MailState) => { for (const q of s.queue) queued.set(q.id, q); } };
  srv = await startServer({ store, tmux: fakeTmux(), port: 0, mail, agentEnv: async () => ({ ...process.env }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
}
async function client(): Promise<Client> { const c = await connect({ port: srv.port }); await c.next('snapshot'); return c; }
async function launch(c: Client, roles: string[]): Promise<Team> {
  c.send({ type: 'team.launch', rid: `l-${Math.random()}`, cwd: work, name: 'api', seats: roles.map(r => ({ role: r })) });
  return (await c.next('team.launched', 5000)).team;
}
const seat = (team: Team, r: string) => store.get(team.seats.find(s => s.role === r)!.sessionId!)!;
const idle = (id: string) => store.apply(id, { name: 'Stop', at: new Date().toISOString(), source: 'hook' });
const itemsTo = (id: string) => [...queued.values()].filter(q => q.target === id);
const at = () => new Date().toISOString();

beforeEach(() => {
  home = process.env.LEDGE_HOME;
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-broadcast-'));
  work = mkdtempSync(join(tmpdir(), 'ledge-work-'));
  for (const r of ['leader', 'build', 'review']) role(r);
});
afterEach(async () => {
  await srv.close();
  if (home === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = home;
});

describe('@team, from the lead', () => {
  it('reaches every other live seat, and not the lead', async () => {
    await start(); const c = await client();
    const team = await launch(c, ['leader', 'build', 'review']);
    const [lead, build, review] = [seat(team, 'leader'), seat(team, 'build'), seat(team, 'review')];
    for (const s of [lead, build, review]) idle(s.id);
    c.send({ type: 'session.message', rid: 'm1', from: lead.id, to: '@team', text: 'On fusionne à 17h' });
    const ack = await c.next('message.ack');
    expect(ack).toMatchObject({ rid: 'm1', outcome: 'accepted', recipients: 2 });
    for (const s of [build, review]) expect(itemsTo(s.id)).toMatchObject([{ kind: 'message', text: 'On fusionne à 17h', from: lead.id, sender: { name: lead.name }, rid: `m1:${s.id}` }]);
    expect(itemsTo(lead.id)).toEqual([]);
    await c.close();
  });

  it('a busy seat gets it queued; an exited seat is skipped', async () => {
    await start(); const c = await client();
    const team = await launch(c, ['leader', 'build', 'review']);
    const [lead, build, review] = [seat(team, 'leader'), seat(team, 'build'), seat(team, 'review')];
    idle(lead.id); idle(review.id);
    store.apply(build.id, { name: 'UserPromptSubmit', at: at(), source: 'hook' });
    c.send({ type: 'session.message', rid: 'm1', from: lead.id, to: '@team', text: 'Pause' });
    expect(await c.next('message.ack')).toMatchObject({ outcome: 'accepted', recipients: 2 });
    store.apply(review.id, { name: 'SessionEnd', at: at(), source: 'hook' });
    c.send({ type: 'session.message', rid: 'm2', from: lead.id, to: '@team', text: 'Encore' });
    expect(await c.next('message.ack')).toMatchObject({ rid: 'm2', recipients: 1, outcome: 'queued' });
    expect(itemsTo(review.id).filter(i => i.rid === `m2:${review.id}`)).toEqual([]);
    await c.close();
  });

  it('is the lead’s alone', async () => {
    await start(); const c = await client();
    const team = await launch(c, ['leader', 'build', 'review']);
    c.send({ type: 'session.message', rid: 'm1', from: seat(team, 'build').id, to: '@team', text: 'Salut' });
    expect(await c.next('message.ack')).toMatchObject({ outcome: 'refused', reason: 'seul le lead (@leader) parle à toute l\'équipe : écris à un rôle (ledge send @<rôle> "…")' });
    await c.close();
  });

  it('refuses a team of one seat', async () => {
    await start(); const c = await client();
    const team = await launch(c, ['leader']);
    c.send({ type: 'session.message', rid: 'm1', from: seat(team, 'leader').id, to: '@team', text: 'Salut' });
    expect(await c.next('message.ack')).toMatchObject({ outcome: 'refused', reason: `personne d'autre dans l'équipe ${team.name}` });
    await c.close();
  });
});

describe('team.broadcast, from the user', () => {
  it('tells every live seat, the lead too', async () => {
    await start(); const c = await client();
    const team = await launch(c, ['leader', 'build', 'review']);
    const seats = ['leader', 'build', 'review'].map(r => seat(team, r));
    c.send({ type: 'team.broadcast', rid: 'b1', team: team.id, text: 'Pause' });
    expect(await c.next('team.broadcast.result')).toMatchObject({ rid: 'b1', sent: 3 });
    for (const s of seats) {
      const n = itemsTo(s.id).filter(i => i.kind === 'notice');
      expect(n).toMatchObject([{ text: formatTeamNotice({ team: team.id, text: "Message de l'utilisateur à toute l'équipe : Pause" }) }]);
    }
    await c.close();
  });

  it('refuses a dissolved team', async () => {
    await start(); const c = await client();
    const team = await launch(c, ['leader', 'build']);
    c.send({ type: 'team.dissolve', team: team.id });
    await c.next('team.updated');
    c.send({ type: 'team.broadcast', rid: 'b1', team: team.id, text: 'Pause' });
    const r = await c.next('team.broadcast.result');
    expect(r.sent).toBeUndefined();
    expect(r.reason).toBe(`aucune équipe ${team.id}`);
    await c.close();
  });
});

describe('the reserved role team and the lead’s context', () => {
  it('parseRole refuses team, listRoles reports it', () => {
    const reason = "team est réservé (ledge send @team parle à toute l'équipe) : renomme ce rôle";
    expect(parseRole('team', '---\nlabel: X\n---\nHi\n', 'home', '/x/team.md')).toBe(reason);
    role('team');
    expect(listRoles().problems.map(p => p.reason)).toContain(reason);
    expect(listRoles().roles.some(r => r.id === 'team')).toBe(false);
  });

  it('seatContext names @team to the leader only', () => {
    const team = { name: 'api', members: [{ name: 'Pim', role: 'build' }] };
    const line = 'Tu es le lead : ledge send @team "…" écrit à toute l\'équipe d\'un coup.';
    expect(seatContext({ roleId: 'leader', team }).split('\n')).toContain(line);
    expect(seatContext({ roleId: 'build', team })).not.toContain('@team');
  });
});
