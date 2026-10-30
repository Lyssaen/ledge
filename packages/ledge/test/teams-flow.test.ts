import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatTurn, Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { tasksJournal } from '../src/daemon/tasks.js';
import { teamsJournal } from '../src/daemon/teamsLive.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { until } from './helpers.js';

// The two promises of the roles spec, end to end through the daemon: a team the chat proposes is launched, kept across a
// restart, saved as a template and launched again; the tasks given to a role reach its seat one at a time, oldest first,
// the next one only once the seat is free again.

type NewSession = { name: string; cwd: string; env: Record<string, string>; command: string[] };
/** A tmux whose panes take what is typed; `typed` is every text, by pane. */
function fakeTmux(): Tmux & { created: NewSession[]; typed: Array<{ pane: string; text: string }> } {
  const created: NewSession[] = []; const panes = new Set<string>(); const typed: Array<{ pane: string; text: string }> = [];
  const t: Tmux & { created: NewSession[]; typed: typeof typed } = {
    created, typed,
    async newSession(o) { created.push(o); panes.add(o.name); },
    async sendText(pane, text) { typed.push({ pane, text }); }, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
    async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
  return t;
}

let srv: Awaited<ReturnType<typeof startServer>> | undefined; let store: Store; let tmux: ReturnType<typeof fakeTmux>; let work: string; let answer: string | undefined;
const role = (id: string, front: string) => { mkdirSync(join(process.env.LEDGE_HOME!, 'roles'), { recursive: true }); writeFileSync(join(process.env.LEDGE_HOME!, 'roles', `${id}.md`), `---\n${front}\n---\nTu es ${id}.\n`); };
const journals = () => ({ teams: teamsJournal(join(process.env.LEDGE_HOME!, 'teams-live.json')), tasks: tasksJournal(join(process.env.LEDGE_HOME!, 'tasks.json')) });
/** A daemon on `store` (the sessions it keeps), with its teams and tasks journals in LEDGE_HOME. */
async function start() {
  tmux = fakeTmux();
  srv = await startServer({ store, tmux, port: 0, verify: { attempts: 2, intervalMs: 10 }, ...journals(), agentEnv: async () => ({ ...process.env, ...(answer ? { FAKE_ANSWER: answer } : {}) }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
}
async function client(): Promise<Client> { const c = await connect({ port: srv!.port }); await c.next('snapshot'); return c; }
const set = (id: string, state: Session['state']) => store.upsert({ ...store.get(id)!, state });

beforeEach(() => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-flow-'));
  work = mkdtempSync(join(tmpdir(), 'ledge-work-'));
  store = new Store();
  answer = undefined;
  role('lead', 'label: Chef');
  role('build', 'label: Build\nmodel: opus\nautonomy: edits');
});
afterEach(async () => { await srv?.close(); srv = undefined; });

describe('a live team recomposed from the phone', () => {
  it('a seat start racing the compose that adds the seat is refused: one session, not two', async () => {
    role('rev', 'label: Rev');
    await start();
    const c = await client();
    c.send({ type: 'team.launch', rid: 'r1', cwd: work, name: 'duo', seats: [{ role: 'lead' }] });
    const { team } = await c.next('team.launched', 5000);
    // @rev takes a while to spawn: the window in which the seat exists and holds no session yet.
    const spawn = tmux.newSession.bind(tmux);
    tmux.newSession = async o => { if (o.env.LEDGE_ROLE === 'rev') await new Promise(r => setTimeout(r, 150)); return spawn(o); };
    // Both arrive together: the compose adds @rev and starts it, the start finds the seat already there.
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'lead' }, { role: 'rev' }] });
    c.send({ type: 'team.seat', rid: 's1', team: team.id, role: 'rev', action: 'start' });
    const first = await c.next('team.changed', 5000);
    const second = await c.next('team.changed', 5000);
    const [composed, started] = first.rid === 'c1' ? [first, second] : [second, first];
    expect(composed.reason).toBeUndefined();
    expect(started.reason).toContain('déjà en cours');
    expect(tmux.created.filter(o => o.env.LEDGE_ROLE === 'rev')).toHaveLength(1);
    await c.close();
  }, 15_000);
});
