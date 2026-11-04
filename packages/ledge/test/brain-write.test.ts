import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendAddition, applyProposal, checkProposal, PENDING_MAX, proposalTask, readAnswer } from '../src/brain/write.js';
import { readNotes } from '../src/brain/notes.js';
import { brainContext } from '../src/brain/index.js';
import { brainWriteArgs } from '../src/brain/cli.js';
import { parseLedgeCommand } from '../src/cli/send.js';
import { writeNotes, NOTES_INDEX } from '../src/chat/notes.js';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';

const T0 = '2026-11-04T10:00:00.000Z';
let home: string; let from: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ledge-bw-')); process.env.LEDGE_HOME = home; from = join(home, 'context'); mkdirSync(from); });
const note = (file: string, text: string) => writeFileSync(join(from, file), text);
const add = (n: string, fact: string, extra = {}) => ({ kind: 'add' as const, note: n, fact, ...extra });

describe('the answer', () => {
  it('« oui » in its forms (a ready line too) writes, « oui : <texte> » writes that text, anything else writes nothing', () => {
    for (const a of ['oui', 'Oui.', 'OK', 'oui — ajouter à la note machines : « x »', 'Ajouter']) expect(readAnswer(a)).toEqual({ yes: true });
    expect(readAnswer('oui : le Pi a 1 Go\nde RAM')).toEqual({ yes: true, text: 'le Pi a 1 Go de RAM' });
    for (const a of ['non', 'non — ne rien écrire', 'ouille', 'plus tard', 'pas sûr, oui']) expect(readAnswer(a)).toEqual({ yes: false });
  });
  it('the decision says what « oui » writes, as two ready answers', () => {
    const t = proposalTask(add('machines', 'Le Pi a 1 Go de RAM', { source: 'free -h sur le Pi' }));
    expect(t.title).toBe('Note machines : ajouter ce fait ? (oui, non, ou « oui : ton texte »)');
    expect(t.text.split('\n')).toEqual(['oui — ajouter à la note machines : « Le Pi a 1 Go de RAM » (source : free -h sur le Pi)', 'non — ne rien écrire']);
    expect(proposalTask({ kind: 'flag', note: 'reseau', fact: 'la box a changé' }).text).toBe('oui — marquer la note reseau « à revoir » : la box a changé\nnon — ne rien marquer');
  });
});

describe('checkProposal', () => {
  it('refuses a secret, an unknown or chat-only note, a new note that exists, a flag on nothing, and past the pending cap', async () => {
    note('machines.md', 'x'); note('secrets.md', '---\nscope: chat\n---\ny');
    expect(await checkProposal(add('machines', 'ok'), 0, from)).toBeNull();
    expect(await checkProposal(add('MACHINES', 'ok'), 0, from)).toBeNull();
    expect(await checkProposal(add('machines', 'le token est ghp_abcdefghijklmnopqrstuvwxyz0123'), 0, from)).toContain('secret');
    expect(await checkProposal(add('machines', 'ok', { source: 'https://u:p@host/x' }), 0, from)).toContain('secret');
    expect(await checkProposal(add('nope', 'ok'), 0, from)).toContain('ne connaît pas');
    expect(await checkProposal(add('secrets', 'ok'), 0, from)).toContain('ne connaît pas');
    expect(await checkProposal(add('machines', 'ok', { create: true }), 0, from)).toContain('existe déjà');
    expect(await checkProposal(add('bots', 'ok', { create: true }), 0, from)).toBeNull();
    expect(await checkProposal({ kind: 'flag', note: 'bots', fact: 'x', create: true }, 0, from)).toContain('n\'existe pas');
    expect(await checkProposal(add('machines', 'ok'), PENDING_MAX, from)).toContain('trop de propositions');
  });
});

describe('applyProposal', () => {
  it('appends the fact, dated and signed, under « ## Ajouts » (made at the end, then kept before a later section)', () => {
    expect(appendAddition('# M\n\nLe Pi.\n', '- a')).toBe('# M\n\nLe Pi.\n\n## Ajouts\n\n- a\n');
    expect(appendAddition('# M\n\n## Ajouts\n\n- a\n\n## Autre\n\nz\n', '- b')).toBe('# M\n\n## Ajouts\n\n- a\n- b\n\n## Autre\n\nz\n');
    note('machines.md', '---\ntitle: M\n---\n# M\n');
    expect(applyProposal(add('machines', 'Le Pi a 1 Go de RAM', { source: 'free -h' }), 'oui', 'Nova', T0, from)).toBe('ajouté à la note machines : Le Pi a 1 Go de RAM');
    expect(readFileSync(join(from, 'machines.md'), 'utf8')).toBe('---\ntitle: M\n---\n# M\n\n## Ajouts\n\n- Le Pi a 1 Go de RAM — free -h (proposé par Nova, le 2026-11-04)\n');
    applyProposal(add('machines', 'x'), 'oui : Le Pi a 906 Mo de RAM', 'Nova', T0, from);
    expect(readFileSync(join(from, 'machines.md'), 'utf8')).toContain('- Le Pi a 906 Mo de RAM (proposé par Nova, corrigé par l\'utilisateur, le 2026-11-04)');
  });
  it('writes nothing on « non », nor a corrected text that looks like a secret', () => {
    note('machines.md', '# M\n');
    expect(applyProposal(add('machines', 'x'), 'non', 'Nova', T0, from)).toBe('rien n\'est écrit : l\'utilisateur a répondu « non »');
    expect(applyProposal(add('machines', 'x'), 'oui : glpat-abcdefghijklmnop1234', 'Nova', T0, from)).toContain('secret');
    expect(readFileSync(join(from, 'machines.md'), 'utf8')).toBe('# M\n');
  });
  it('creates a new note, never over one that appeared meanwhile', () => {
    expect(applyProposal(add('bots', 'Les bots tournent sur la tablette', { create: true }), 'oui', 'Pim', T0, from)).toBe('note bots créée avec : Les bots tournent sur la tablette');
    expect(readFileSync(join(from, 'bots.md'), 'utf8')).toContain('title: bots\nwhen: (à compléter)\n---\n\n## Ajouts\n\n- Les bots tournent sur la tablette (proposé par Pim');
    expect(applyProposal(add('bots', 'autre', { create: true }), 'oui', 'Pim', T0, from)).toContain('ajouté à la note bots');
  });
  it('a flag shows « à revoir » in both indexes until the user edits the note; Ledge\'s own additions do not clear it', async () => {
    note('reseau.md', '---\ntitle: Réseau\n---\nLa box.\n');
    const past = new Date(Date.parse(T0) - 60_000); utimesSync(join(from, 'reseau.md'), past, past);
    expect(applyProposal({ kind: 'flag', note: 'reseau', fact: 'la box a changé' }, 'oui', 'Nova', T0, from)).toBe('la note reseau est marquée « à revoir » : la box a changé');
    expect((await readNotes(from)).notes[0]!.flag).toBe('la box a changé');
    expect(brainContext((await readNotes(from)).notes)).toContain('— à revoir : la box a changé');
    const dir = mkdtempSync(join(tmpdir(), 'ctx-')); await writeNotes(dir, from, new Map());
    expect(readFileSync(join(dir, NOTES_INDEX), 'utf8')).toContain('TO CHECK (the user agreed it may be wrong): la box a changé');
    // Ledge appends a fact: still to check.
    applyProposal(add('reseau', 'Le DNS est sur le Pi'), 'oui', 'Nova', new Date(Date.parse(T0) + 60_000).toISOString(), from);
    expect((await readNotes(from)).notes[0]!.flag).toBe('la box a changé');
    // The user edits it: cleared.
    writeFileSync(join(from, 'reseau.md'), '---\ntitle: Réseau\n---\nLa nouvelle box.\n');
    const later = new Date(Date.parse(T0) + 120_000); utimesSync(join(from, 'reseau.md'), later, later);
    expect((await readNotes(from)).notes[0]!.flag).toBeUndefined();
  });
});

describe('ledge brain propose / flag: the command', () => {
  it('reads its arguments, new:<nom> for a new note', () => {
    expect(brainWriteArgs(['propose', 'machines', 'Le Pi a 1 Go', 'free -h'])).toEqual({ kind: 'add', note: 'machines', fact: 'Le Pi a 1 Go', source: 'free -h' });
    expect(brainWriteArgs(['propose', 'new:bots', 'x'])).toEqual({ kind: 'add', note: 'bots', create: true, fact: 'x' });
    expect(brainWriteArgs(['flag', 'reseau', 'la box a changé'])).toEqual({ kind: 'flag', note: 'reseau', fact: 'la box a changé' });
    expect(brainWriteArgs(['flag', 'reseau', 'x', 'y'])).toContain('ledge brain flag');
    expect(brainWriteArgs(['propose', '../etc', 'x'])).toContain('nom de note');
    expect(brainWriteArgs(['propose', 'm', 'x'.repeat(501)])).toContain('500');
  });
  it('a Codex hook runs the writes (they need the daemon), never the reads (its own shell does)', () => {
    expect(parseLedgeCommand('ledge brain propose machines "Le Pi a 1 Go"')).toEqual({ cmd: 'brain', args: ['propose', 'machines', 'Le Pi a 1 Go'] });
    expect(parseLedgeCommand('ledge brain flag reseau "x"')).toEqual({ cmd: 'brain', args: ['flag', 'reseau', 'x'] });
    expect(parseLedgeCommand('ledge brain')).toBeUndefined();
    expect(parseLedgeCommand('ledge brain machines')).toBeUndefined();
  });
});

describe('a proposal through the daemon', () => {
  const fakeTmux = (): Tmux => {
    const panes = new Set<string>();
    return { async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; }, async hasSession(n) { return panes.has(n); },
      async listSessions() { return [...panes]; }, async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n] };
  };
  let srv: Awaited<ReturnType<typeof startServer>>; let c: Client; let store: Store;
  beforeEach(async () => {
    store = new Store();
    srv = await startServer({ store, tmux: fakeTmux(), port: 0, close: { freeMs: 50, exitMs: 50 }, agentEnv: async () => ({ ...process.env }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
    c = await connect({ port: srv.port }); await c.next('snapshot');
  });
  afterEach(async () => { await c.close(); await srv.close(); });

  it('a session proposes, the user is asked, « oui » writes the note and the session is told; a bad one is refused before asking', async () => {
    note('machines.md', '# Machines\n');
    c.send({ type: 'session.launch', tool: 'claude', cwd: home, name: 'ann' });
    const ann = (await c.next('session.launched', 5000)).id;
    c.send({ type: 'task.cmd', rid: 'p1', by: ann, op: 'give', to: 'ledge', brain: { kind: 'add', note: 'nope', fact: 'x' } });
    expect((await c.next('task.result', 3000)).reason).toContain('ne connaît pas la note « nope »');
    c.send({ type: 'task.cmd', rid: 'p2', by: ann, op: 'give', to: 'ledge', brain: { kind: 'add', note: 'machines', fact: 'Le Pi a 1 Go de RAM', source: 'free -h' } });
    const d = (await c.next('task.result', 3000)).task!;
    expect(d).toMatchObject({ owner: 'ledge', title: 'Note machines : ajouter ce fait ? (oui, non, ou « oui : ton texte »)', brain: { note: 'machines' } });
    expect(readFileSync(join(from, 'machines.md'), 'utf8')).toBe('# Machines\n');
    c.send({ type: 'action.run', rid: 'a1', action: 'task.answer', args: { task: d.id, answer: 'oui' }, confirmed: true } as never);
    expect((await c.next('action.result', 5000)).reason).toBeUndefined();
    expect(readFileSync(join(from, 'machines.md'), 'utf8')).toContain('- Le Pi a 1 Go de RAM — free -h (proposé par Ann');
    c.send({ type: 'task.cmd', rid: 's', by: 'ledge', op: 'show', task: d.id });
    expect((await c.next('task.result', 3000)).task).toMatchObject({ state: 'done', result: 'ajouté à la note machines : Le Pi a 1 Go de RAM' });
    expect(existsSync(join(home, 'brain.json'))).toBe(true);
  });
});
