import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientMessage, ServerMessage, Task } from '@ledge/protocol';
import { PhoneClientMessageSchema } from '@ledge/protocol';
import { addFromUser, applyProposal, clearFlag, markChecked, noteInfos, withChecked } from '../src/brain/write.js';
import { readNotes } from '../src/brain/notes.js';
import { resolveAction } from '../src/daemon/actions.js';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { flush, setup, stopAll } from './helpers/gateway.js';

const T0 = '2026-11-04T10:00:00.000Z';
let home: string; let from: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ledge-bs-')); process.env.LEDGE_HOME = home; from = join(home, 'context'); mkdirSync(from); });
const note = (file: string, text: string) => writeFileSync(join(from, file), text);

describe('the buttons\' choice', () => {
  it('« Ajouter » writes the proposed fact, « Modifier » the user\'s text, « Refuser » nothing; a new note takes the corrected title and when', () => {
    note('machines.md', '# M\n');
    const p = { kind: 'add' as const, note: 'machines', fact: 'Le Pi a 1 Go' };
    expect(applyProposal(p, { yes: false }, 'Nova', T0, from)).toBe('rien n\'est écrit : l\'utilisateur a refusé');
    expect(applyProposal(p, { yes: true }, 'Nova', T0, from)).toBe('ajouté à la note machines : Le Pi a 1 Go');
    expect(applyProposal(p, { yes: true, text: 'Le Pi a 906 Mo' }, 'Nova', T0, from)).toBe('ajouté à la note machines : Le Pi a 906 Mo');
    const text = readFileSync(join(from, 'machines.md'), 'utf8');
    expect(text).toContain('- Le Pi a 1 Go (proposé par Nova, le 2026-11-04)');
    expect(text).toContain('- Le Pi a 906 Mo (proposé par Nova, corrigé par l\'utilisateur, le 2026-11-04)');
    applyProposal({ kind: 'add', note: 'bots', create: true, fact: 'x', title: 'Bots', when: 'les bots' }, { yes: true, title: 'Les bots: tablette', when: 'un bot # précis' }, 'Otto', T0, from);
    expect(readFileSync(join(from, 'bots.md'), 'utf8')).toMatch(/^---\ntitle: "Les bots: tablette"\nwhen: "un bot # précis"\n---\n/);
  });
  it('the corrected new note reads back with that title and when', async () => {
    applyProposal({ kind: 'add', note: 'bots', create: true, fact: 'x' }, { yes: true, title: 'Les bots: tablette', when: 'un bot # précis' }, 'Otto', T0, from);
    expect((await readNotes(from)).notes[0]).toMatchObject({ title: 'Les bots: tablette', when: 'un bot # précis' });
  });
});

describe('Réglages › Notes', () => {
  it('« Vérifiée aujourd\'hui » sets checked in the front matter (replaced, added, or made) and clears the flag', async () => {
    expect(withChecked('# M\n', '2026-11-04')).toBe('---\nchecked: 2026-11-04\n---\n\n# M\n');
    expect(withChecked('---\ntitle: M\n---\n# M\n', '2026-11-04')).toBe('---\ntitle: M\nchecked: 2026-11-04\n---\n# M\n');
    expect(withChecked('---\nchecked: 2026-01-01\ntitle: M\n---\n# M\n', '2026-11-04')).toBe('---\nchecked: 2026-11-04\ntitle: M\n---\n# M\n');
    note('reseau.md', '---\ntitle: R\n---\nLa box.\n');
    const past = new Date(Date.parse(T0) - 60_000); utimesSync(join(from, 'reseau.md'), past, past);
    applyProposal({ kind: 'flag', note: 'reseau', fact: 'la box a changé' }, { yes: true }, 'Pim', T0, from);
    expect((await noteInfos(from, T0))[0]).toMatchObject({ name: 'reseau', flag: { what: 'la box a changé', by: 'Pim', at: T0 } });
    expect(markChecked('reseau', '2026-11-04', from)).toBeNull();
    expect((await noteInfos(from, T0))[0]).toMatchObject({ checkedAt: '2026-11-04' });
    expect((await noteInfos(from, T0))[0]!.flag).toBeUndefined();
    expect(markChecked('nope', '2026-11-04', from)).toContain('n\'existe plus');
  });
  it('« Effacer le signalement » removes it; the list counts additions and says how old a note is', async () => {
    note('reseau.md', '# R\n\n## Ajouts\n\n- a\n- b\n\n## Autre\n\n- c\n');
    const old = new Date('2026-08-28T12:00:00.000Z'); utimesSync(join(from, 'reseau.md'), old, old);
    applyProposal({ kind: 'flag', note: 'reseau', fact: 'x' }, { yes: true }, 'Pim', T0, from);
    let [n] = await noteInfos(from, '2026-11-04T12:00:00.000Z');
    expect(n).toMatchObject({ additions: 2, oldDays: 68, flag: { what: 'x' } });
    expect(clearFlag('reseau', from)).toBeNull();
    [n] = await noteInfos(from, '2026-11-04T12:00:00.000Z');
    expect(n!.flag).toBeUndefined();
  });
});

describe('the chat\'s note.add', () => {
  it('resolves only for a note that exists (its own spelling), and writes what the user said, signed so', () => {
    note('Machines.md', '# M\n');
    const ctx = { sessions: [], tasks: [] };
    expect(resolveAction('note.add', { note: 'machines', fact: 'Legion a 64 Go' }, ctx)).toMatchObject({ action: 'note.add', args: { note: 'Machines', fact: 'Legion a 64 Go' }, risk: 'reversible', summary: 'Ajouter à la note **Machines**', detail: 'Legion a 64 Go' });
    expect(resolveAction('note.add', { note: 'nope', fact: 'x' }, ctx)).toMatchObject({ refused: 'unknown note nope', code: 'unknown' });
    expect(addFromUser('Machines', 'Legion a 64 Go', T0, from)).toEqual({ result: 'ajouté à la note Machines : Legion a 64 Go' });
    expect(readFileSync(join(from, 'Machines.md'), 'utf8')).toContain('- Legion a 64 Go (dit par l\'utilisateur, le 2026-11-04)');
    expect(addFromUser('Machines', 'token ghp_abcdefghijklmnopqrstuvwxyz0123', T0, from).reason).toContain('secret');
  });
});

describe('through the daemon', () => {
  const fakeTmux = (): Tmux => {
    const panes = new Set<string>();
    return { async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; }, async hasSession(n) { return panes.has(n); },
      async listSessions() { return [...panes]; }, async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n] };
  };
  let srv: Awaited<ReturnType<typeof startServer>>; let c: Client;
  beforeEach(async () => {
    srv = await startServer({ store: new Store(), tmux: fakeTmux(), port: 0, close: { freeMs: 50, exitMs: 50 }, agentEnv: async () => ({ ...process.env }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
    c = await connect({ port: srv.port }); await c.next('snapshot');
  });
  afterEach(async () => { await c.close(); await srv.close(); });
  const result = async (m: ClientMessage) => { c.send(m); return c.next('brain.result', 3000); };

  it('brain.answer closes the proposal with the buttons\' choice; brain.list, brain.note and brain.add answer with the notes', async () => {
    note('machines.md', '# Machines\n');
    c.send({ type: 'session.launch', tool: 'claude', cwd: home, name: 'ann' });
    const ann = (await c.next('session.launched', 5000)).id;
    c.send({ type: 'task.cmd', rid: 'p', by: ann, op: 'give', to: 'ledge', brain: { kind: 'add', note: 'machines', fact: 'Le Pi a 1 Go' } });
    const d = (await c.next('task.result', 3000)).task!;
    expect(await result({ type: 'brain.answer', rid: 'a', task: d.id, choice: { yes: true, text: 'Le Pi a 906 Mo' } })).toEqual({ type: 'brain.result', rid: 'a', result: 'ajouté à la note machines : Le Pi a 906 Mo' });
    expect((await result({ type: 'brain.answer', rid: 'b', task: d.id, choice: { yes: true } })).reason).toContain('déjà close');
    expect((await result({ type: 'brain.answer', rid: 'c', task: 'tnope', choice: { yes: true } })).reason).toContain('aucune proposition');
    const list = await result({ type: 'brain.list', rid: 'l' });
    expect(list).toMatchObject({ dir: from, notes: [{ name: 'machines', additions: 1 }] });
    expect((await result({ type: 'brain.note', rid: 'n', note: 'machines', op: 'checked' })).notes![0]).toMatchObject({ checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(await result({ type: 'brain.add', rid: 'x', note: 'machines', fact: 'Legion a 64 Go' })).toMatchObject({ result: 'ajouté à la note machines : Legion a 64 Go' });
    c.send({ type: 'action.run', rid: 'run', action: 'note.add', args: { note: 'machines', fact: 'Le PC a 32 Go' } } as never);
    expect((await c.next('action.result', 3000)).reason).toBeUndefined();
    expect(readFileSync(join(from, 'machines.md'), 'utf8')).toContain('- Le PC a 32 Go (dit par l\'utilisateur');
  });
});

describe('the phone\'s buttons', () => {
  afterEach(stopAll);
  const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
  const proposal: Task = { id: 't000001', title: 'Note machines : ajouter ce fait ?', text: 'oui — …\nnon — …', giver: 'a', giverName: 'Nova', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: T0, updatedAt: T0, log: [],
    brain: { kind: 'add', note: 'machines', fact: 'Le Pi a 1 Go' } };
  function make() {
    const asked: ClientMessage[] = [];
    const g = setup({ tasks: () => [proposal], dispatch: async (msg: ClientMessage, reply: (m: ServerMessage) => void) => {
      asked.push(msg);
      if (msg.type === 'brain.answer') reply({ type: 'brain.result', rid: msg.rid, result: 'ajouté' });
    } });
    return { g, asked };
  }
  const enroll = async (g: ReturnType<typeof setup>) => {
    const auth = softAuthenticator();
    g.send('dev1', { type: 'confirm.prepare', purpose: 'register' }); await flush();
    const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
    if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
    g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, reg.challenge) }); await flush();
    return auth;
  };
  const challenge = async (g: ReturnType<typeof setup>, choice: object) => {
    const before = g.got('dev1').length;
    g.send('dev1', { type: 'confirm.prepare', purpose: 'note', task: proposal.id, choice }); await flush();
    const m = g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge' || x.type === 'error');
    if (m?.type !== 'confirm.challenge') throw new Error(`no challenge: ${JSON.stringify(m)}`);
    return m.challenge;
  };
  const answer = async (g: ReturnType<typeof setup>, msg: object) => {
    const op = randomUUID();
    g.send('dev1', { type: 'brain.answer', op, task: proposal.id, ...msg }); await flush();
    return g.results('dev1').filter(r => r.op === op && r.status !== 'received').at(-1);
  };

  it('the phone sees the proposal; « Refuser » needs no check; « Ajouter » needs one over that exact choice', async () => {
    const { g, asked } = make();
    expect(PhoneClientMessageSchema.safeParse({ type: 'brain.answer', op: randomUUID(), task: 't1', choice: { yes: true, text: 'a\nb' } }).success).toBe(false);
    expect(await answer(g, { choice: { yes: true } })).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    expect(await answer(g, { choice: { yes: false } })).toMatchObject({ status: 'applied' });
    const auth = await enroll(g);
    const other = await challenge(g, { yes: true, text: 'autre chose' });
    expect(await answer(g, { choice: { yes: true }, assertion: auth.get(rp, other, { counter: 1 }) })).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    const ch = await challenge(g, { yes: true, text: 'Le Pi a 906 Mo' });
    expect(await answer(g, { choice: { yes: true, text: 'Le Pi a 906 Mo' }, assertion: auth.get(rp, ch, { counter: 2 }) })).toMatchObject({ status: 'applied' });
    expect(asked.filter(m => m.type === 'brain.answer').map(m => m.type === 'brain.answer' && m.choice)).toEqual([{ yes: false }, { yes: true, text: 'Le Pi a 906 Mo' }]);
  });
});
