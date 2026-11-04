import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forChat, forSession, readNotes } from '../src/brain/notes.js';
import { brainContext, INDEX_TOLD, runBrain } from '../src/brain/index.js';

const T0 = '2026-10-11T10:00:00.000Z';
let home: string; let from: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ledge-brain-')); process.env.LEDGE_HOME = home;
  from = join(home, 'context'); mkdirSync(from);
});
function note(file: string, text: string) { writeFileSync(join(from, file), text); utimesSync(join(from, file), new Date(T0), new Date(T0)); }
const PROJECTS = { projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: 'Le cockpit.', repos: [{ machine: 'local', path: '/w/ledge' }] }, { id: 'api', name: 'API', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/api' }] }], rules: [] };

describe('readNotes', () => {
  it('reads title, when, scope, projects and checked; an unknown scope is all, a bad date none', async () => {
    note('machines.md', '---\ntitle: Les machines\nwhen: une question sur une machine\nscope: chat\nprojects: Ledge, api\nchecked: 2026-11-01\n---\n# Machines\nLe Pi.\n');
    note('git.md', '---\nscope: everyone\nchecked: hier\n---\n\nBranches en feat/…\n');
    const { notes } = await readNotes(from);
    expect(notes.map(n => n.name)).toEqual(['git', 'machines']);
    const [git, machines] = notes as [typeof notes[0], typeof notes[0]];
    expect(machines).toMatchObject({ title: 'Les machines', when: 'une question sur une machine', scope: 'chat', projects: ['ledge', 'api'], checkedAt: '2026-11-01', modifiedAt: T0, firstLine: '# Machines', body: '# Machines\nLe Pi.', truncated: false });
    expect(git).toMatchObject({ title: 'git.md', when: null, scope: 'all', projects: [], firstLine: 'Branches en feat/…' });
    expect(git.checkedAt).toBeUndefined();
  });

  it('the chat never gets a sessions note; a session never a chat note, and a projects note only in those projects', async () => {
    note('all.md', 'a'); note('chat.md', '---\nscope: chat\n---\nc'); note('sess.md', '---\nscope: sessions\n---\ns'); note('api.md', '---\nprojects: API\n---\nx');
    const { notes } = await readNotes(from);
    expect(forChat(notes).map(n => n.name)).toEqual(['all', 'api', 'chat']);
    expect(forSession(notes, { id: 'api', name: 'API' }).map(n => n.name)).toEqual(['all', 'api', 'sess']);
    expect(forSession(notes, { id: 'ledge', name: 'Ledge' }).map(n => n.name)).toEqual(['all', 'sess']);
    expect(forSession(notes, null).map(n => n.name)).toEqual(['all', 'sess']);
  });
});

describe('brainContext (a launched session\'s start context)', () => {
  it('always says how to read what Ledge says of itself; the notes\' index only when there are some, never their text', async () => {
    const empty = brainContext([]);
    expect(empty.split('\n')[0]).toBe("Ce que Ledge sait de lui-même (ses écrans, ses commandes, ses actions) : `ledge brain @ledge` ; tout ce qu'il sait : `ledge brain`.");
    expect(empty).not.toContain('Notes de l\'utilisateur');
    // How to propose a fact or flag a note, always: the user validates.
    expect(empty).toContain('`ledge brain propose <nom> "<fait>" "<comment tu le sais>"`');
    expect(empty).toContain('`ledge brain flag <nom> "<ce qui ne va pas>"`');
    expect(empty).toContain('Jamais la valeur d\'un secret');
    note('reseau.md', '---\ntitle: Le réseau\nwhen: une question sur le réseau\nchecked: 2026-11-01\n---\nLe secret du réseau.\n');
    note('bots.md', 'Les bots tournent sur la tablette.\n');
    const text = brainContext((await readNotes(from)).notes);
    expect(text).toContain('`ledge brain <nom>` seulement si ton travail en a besoin ; pour le code, le CLAUDE.md ou AGENTS.md du dépôt prime');
    expect(text).toContain('- reseau — « Le réseau » — quand : une question sur le réseau — vérifiée le 2026-11-01');
    expect(text).toContain('- bots — « bots.md » — première ligne : Les bots tournent sur la tablette. — modifiée le 2026-10-11');
    expect(text).not.toContain('Le secret du réseau');
  });

  it('tells at most INDEX_TOLD notes, and counts the rest', async () => {
    for (let i = 0; i < INDEX_TOLD + 3; i++) note(`n${String(i).padStart(2, '0')}.md`, 'x');
    const text = brainContext((await readNotes(from)).notes);
    expect(text.split('\n').filter(l => l.startsWith('- n'))).toHaveLength(INDEX_TOLD);
    expect(text).toContain('- et 3 autre(s) : `ledge brain`');
  });
});

describe('ledge brain', () => {
  beforeEach(() => { writeFileSync(join(home, 'projects.json'), JSON.stringify(PROJECTS)); });

  it('lists what Ledge writes of itself, then the notes this session\'s project is offered', async () => {
    note('all.md', '---\ntitle: Pour tous\n---\na'); note('chat.md', '---\nscope: chat\n---\nc'); note('api.md', '---\nprojects: api\n---\nx');
    const r = await runBrain([], { from, cwd: '/w/ledge/src', inSession: true });
    expect(r.code).toBe(0);
    for (const g of ['@ledge', '@projects', '@machines']) expect(r.line).toContain(`- ${g} — `);
    expect(r.line).toContain('pour le projet Ledge');
    expect(r.line).toContain('- all — « Pour tous »');
    expect(r.line).not.toContain('- chat ');
    expect(r.line).toContain("- et 1 note(s) d'autres projets : api");
    // Outside a session (the user in a terminal): every note, each scope said.
    const user = await runBrain([], { from, cwd: '/', inSession: false });
    expect(user.line).toContain('— réservée au chat');
    expect(user.line).toContain('- api — ');
  });

  it('reads a note by name: its body under its name, title and date; a chat note is refused in a session; an unknown name says how to list', async () => {
    note('machines.md', '---\ntitle: Les machines\nchecked: 2026-11-01\n---\nLe Pi est en Debian.\n');
    note('secrets.md', '---\nscope: chat\n---\nOù sont les tokens.\n');
    const r = await runBrain(['machines'], { from, inSession: true });
    expect(r).toEqual({ code: 0, line: `# machines — « Les machines » — vérifiée le 2026-11-01 (${join(from, 'machines.md')})\n\nLe Pi est en Debian.` });
    expect(await runBrain(['MACHINES.md'], { from, inSession: true })).toMatchObject({ code: 0 });
    expect(await runBrain(['secrets'], { from, inSession: true })).toEqual({ code: 1, line: 'La note « secrets » est réservée au chat de Ledge.' });
    expect(await runBrain(['secrets'], { from, inSession: false })).toMatchObject({ code: 0 });
    expect(await runBrain(['nope'], { from })).toMatchObject({ code: 1, line: expect.stringContaining('`ledge brain` liste ce qu\'il sait') });
  });

  it('a note named like a generated entry keeps its plain name; @ names are Ledge\'s own', async () => {
    note('machines.md', 'Ma note sur les machines.');
    expect((await runBrain(['machines'], { from })).line).toContain('Ma note sur les machines.');
    const m = await runBrain(['@machines'], { from });
    expect(m.line).toContain('# Machines'); expect(m.line).toContain('- Local (local): this machine');
    const p = await runBrain(['@projects'], { from });
    expect(p.line).toContain('## Ledge'); expect(p.line).toContain('- local: /w/ledge');
    const l = await runBrain(['@ledge'], { from });
    expect(l.line).toContain('# Generated from the code of this installation');
  });
});
