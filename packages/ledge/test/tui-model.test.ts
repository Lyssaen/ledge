import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ChatTurn, Task, ThreadItem } from '@ledge/protocol';
import { fr } from '../src/tui/i18n/fr.js';
import { en } from '../src/tui/i18n/en.js';
import { MESSAGES } from '../src/tui/i18n/lang.js';
import { glyphsFor } from '../src/tui/glyphs.js';
import { closedLedgeTasks, exchanges, keepSelection, nextWaiting, overview, step } from '../src/tui/model/overview.js';
import { answerFor, choices } from '../src/tui/model/pending.js';
import { diffCount, threadImages, threadLines, wrap } from '../src/tui/model/thread.js';
import { chatLines, openCards } from '../src/tui/model/chat.js';
import { ago } from '../src/tui/model/time.js';
import { asked, notification } from '../src/tui/notify.js';
import { defaultLang, loadSettings, saveSettings, settingsPath } from '../src/tui/settings.js';
import { tuiArgs } from '../src/tui/index.js';
import { ledgeDir } from '../src/paths.js';
import { mockupSessions, PROJECTS } from './tui-fixture.js';

const text = (lines: { text: string }[][]) => lines.map(l => l.map(s => s.text).join(''));

describe('tui copy', () => {
  /** Every key of the French copy has an English one of the same kind, never empty. */
  function same(a: unknown, b: unknown, path: string): void {
    expect(typeof b, path).toBe(typeof a);
    if (typeof a === 'string') expect((b as string).length, path).toBeGreaterThan(0);
    else if (typeof a === 'function') expect(String((b as (...x: unknown[]) => string)('x', 1)).length, path).toBeGreaterThan(0);
    else if (a && typeof a === 'object') for (const k of Object.keys(a)) same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
  }
  it('English has every French string', () => { same(fr, en, 'en'); });
});

describe('tui overview model', () => {
  it('lists who waits, oldest first, and the projects by branch in the daemon’s order', () => {
    const v = overview(mockupSessions(), PROJECTS);
    expect(v.yours.map(s => s.name)).toEqual(['Otto', 'Luna']);
    expect(v.tree.map(n => n.label)).toEqual(['Ledge', 'Website']);
    expect(v.tree[0]!.branches.map(b => b.branch)).toEqual(['release/LEDGE-42-v0.5.0', 'fix/LEDGE-42-ssh-reconnect', 'docs/protocol']);
    expect(v.order).toEqual(['otto', 'nova', 'bix', 'luna']);
  });

  it('puts a session outside every project under its repository, and leaves exited ones out', () => {
    const v = overview([fakeSession('a', { repo: 'tools', repoPath: '/w/tools', cwd: '/w/tools' }), fakeSession('b', { state: 'exited' })], PROJECTS);
    expect(v.tree.map(n => [n.label, n.color])).toEqual([['tools', undefined]]);
    expect(v.order).toEqual(['a']);
  });

  it('walks the sessions, wraps, keeps the selection and jumps between those waiting', () => {
    expect(step(['a', 'b', 'c'], 'c', 1)).toBe('a');
    expect(step(['a', 'b', 'c'], 'a', -1)).toBe('c');
    expect(keepSelection(['a', 'c'], 'c', ['a', 'b', 'c'])).toBe('c');
    // The selected session left: the one before it in the old order.
    expect(keepSelection(['a', 'c'], 'b', ['a', 'b', 'c'])).toBe('a');
    const v = overview(mockupSessions(), PROJECTS);
    expect(nextWaiting(v.yours, 'otto')).toBe('luna');
    expect(nextWaiting(v.yours, 'luna')).toBe('otto');
  });

  it('lists the latest messages between sessions, newest first, by the peer’s name', () => {
    const list = exchanges([
      fakeSession('o', { name: 'Otto', lastMessage: { id: 'm1', to: 'nova', peer: 'n', summary: 'Rebase', at: '2026-10-09T18:02:00.000Z' } }),
      fakeSession('n', { name: 'Nova', lastMessage: { id: 'm2', to: 'otto', summary: 'Relance', at: '2026-10-09T18:01:00.000Z' } })
    ], 5);
    expect(list.map(x => `${x.from}→${x.to}:${x.summary}`)).toEqual(['Otto→Nova:Rebase', 'Nova→otto:Relance']);
  });

  it('mixes the task hand-overs between any two seats with the messages, newest first; an old journal shows none (#92)', () => {
    const T = (m: number) => `2026-10-09T18:0${m}:00.000Z`;
    const relire: Task = { id: 't1', title: 'Relire', giver: 'o', giverName: 'Otto', owner: 'b', ownerName: 'Bix', state: 'open', at: T(0), updatedAt: T(3), log: [
      { at: T(0), by: 'Otto', what: 'confiée à Nova', op: 'give', from: 'o', to: 'n', fromName: 'Otto', toName: 'Nova' },
      { at: T(1), by: 'Nova', what: 'prise', op: 'take' },
      { at: T(3), by: 'Nova', what: 'passée à Bix', op: 'pass', from: 'local:n', to: 'b', fromName: 'Nova', toName: 'Bix', note: 'la fin' }
    ] };
    const old: Task = { ...relire, id: 't2', title: 'Ancienne', log: [{ at: T(4), by: 'Otto', what: 'confiée à Nova' }] };
    const list = exchanges([
      fakeSession('o', { name: 'Otto', lastMessage: { id: 'm1', to: 'nova', peer: 'n', summary: 'Rebase', at: T(2) } }),
      fakeSession('n', { name: 'Nova' })
    ], 5, [relire, old]);
    expect(list.map(x => `${x.kind}:${x.from}→${x.to}:${x.summary}`)).toEqual(['task:Nova→Bix:Relire', 'message:Otto→Nova:Rebase', 'task:Otto→Nova:Relire']);
  });

  it('says how long ago, short', () => {
    const now = Date.parse('2026-10-09T18:00:00.000Z');
    expect(ago('2026-10-09T17:59:58.000Z', now, fr.time)).toBe('à l’instant');
    expect(ago('2026-10-09T17:55:00.000Z', now, fr.time)).toBe('5 min');
    expect(ago('2026-10-09T15:00:00.000Z', now, en.time)).toBe('3 h');
  });
});

describe('tui answers', () => {
  const [otto, , , luna] = mockupSessions();
  it('y, n and A answer a permission; A only where the agent offers it', () => {
    expect(answerFor(otto!, 'y')).toEqual({ kind: 'decide', decision: 'accept' });
    expect(answerFor(otto!, 'n')).toEqual({ kind: 'decide', decision: 'deny' });
    expect(answerFor(otto!, 'A')).toEqual({ kind: 'decide', decision: 'always' });
    expect(answerFor({ ...otto!, tool: 'cursor' }, 'A')).toEqual({ kind: 'refused', why: 'noAlways' });
    expect(answerFor(otto!, 'x')).toBeNull();
  });

  it('a digit picks a question’s option, never Claude’s free-text row', () => {
    expect(answerFor(luna!, '2')).toEqual({ kind: 'option', n: 2 });
    expect(answerFor(luna!, '4')).toEqual({ kind: 'refused', why: 'notNow' });
    expect(choices(luna!.pending!).map(c => c.label)).toEqual(['3000', '5173', '8080']);
  });

  it('an OMP question is answered by its label', () => {
    const s = fakeSession('o', { tool: 'omp', state: 'waiting_input', pending: { kind: 'question', text: 'Port ?', source: 'rpc', requestId: 'r1', questions: [{ id: 'q1', question: 'Port ?', options: [{ label: '3000' }, { label: '8080' }] }] } });
    expect(answerFor(s, '2')).toEqual({ kind: 'select', questionId: 'q1', label: '8080', n: 2 });
  });

  it('nothing goes to an offline or read-only session', () => {
    expect(answerFor({ ...otto!, offline: true }, 'y')).toEqual({ kind: 'refused', why: 'offline' });
    expect(answerFor({ ...otto!, source: 'hook_only' }, 'y')).toEqual({ kind: 'refused', why: 'readOnly' });
  });
});

describe('tui thread', () => {
  const at = (s: number) => new Date(Date.parse('2026-10-09T18:00:00.000Z') + s * 1000).toISOString();
  const items: ThreadItem[] = [
    { kind: 'prompt', id: 'p1', at: at(0), turn: 1, text: 'Câble la liste' },
    { kind: 'tool', id: 't1', at: at(1), turn: 1, tool: 'Edit', label: 'apps/overlay/src/surface/SessionList.tsx', status: 'success', durationMs: 200, files: [{ path: 'apps/overlay/src/surface/SessionList.tsx', change: 'edit', diff: '--- a\n+++ b\n-old\n+new\n+more' }] },
    { kind: 'reply', id: 'r1', at: at(2), turn: 1, text: 'Deux tests échouent.' },
    { kind: 'prompt', id: 'p2', at: at(3), turn: 2, text: 'Corrige-les' },
    { kind: 'tool', id: 't2', at: at(4), turn: 2, tool: 'Bash', label: 'npm test', status: 'running', files: [] },
    { kind: 'sent', id: 's1', at: at(5), turn: 2, to: 'Nova', text: 'Tu peux rebaser.', status: 'delivered' }
  ];
  const o = { t: fr, g: glyphsFor({}), now: Date.parse(at(10)), width: 80, diffs: false, unfolded: false };

  it('folds past turns on one line and shows the last one in full', () => {
    const lines = text(threadLines(items, o));
    expect(lines[0]).toMatch(/^▸ \d\d:\d\d {2}Câble la liste · 1 action · 1 fichier modifié · Deux tests échouent\.$/);
    expect(lines).toContain('  Corrige-les');
    expect(lines.find(l => l.includes('npm test'))).toMatch(/Bash {3}npm test {2}6\.0 s$/);
    expect(lines.find(l => l.includes('envoyé à'))).toBe('  ✉ envoyé à Nova  « Tu peux rebaser. »  remis');
  });

  it('prints the card of a task the session handed over, by its plain line (#92)', () => {
    const card: ThreadItem = { kind: 'notice', id: 'task-t1-0', at: at(6), turn: 2, notice: 'other', task: 't1', taskOp: 'give', outgoing: true, name: 'Nova', summary: 'Relire', text: 'Tâche « Relire » confiée à Nova' };
    const incoming: ThreadItem = { kind: 'notice', id: 'n2', at: at(7), turn: 2, notice: 'other', task: 't2', name: 'Otto', summary: 'Tâche de Otto', text: '<ledge-task …>' };
    const lines = text(threadLines([...items, card, incoming], o));
    expect(lines).toContain('  · Tâche « Relire » confiée à Nova');
    expect(lines).toContain('  · Tâche de Otto');
  });

  it('unfolds every turn and shows the diffs on demand', () => {
    const lines = text(threadLines(items, { ...o, unfolded: true, diffs: true }));
    expect(lines.find(l => l.includes('SessionList.tsx'))).toContain('+2 −1');
    expect(lines).toContain('      │ -old');
    expect(lines).toContain('      │ +new');
  });

  it('wraps at spaces and counts a diff', () => {
    expect(wrap('un deux trois quatre', 10)).toEqual(['un deux', 'trois', 'quatre']);
    expect(diffCount('--- a\n+++ b\n+x\n-y\n-z')).toEqual({ add: 1, del: 2 });
  });
});

describe('tui chat', () => {
  const turn = (extra: Partial<ChatTurn>): ChatTurn => ({ qid: 'q1', question: 'Qui a besoin de moi ?', askedAt: '2026-10-09T18:00:00.000Z', steps: [], ...extra });
  it('shows what Ledge read, then the streamed text while it writes', () => {
    const lines = text(chatLines([turn({ steps: [{ kind: 'sessions' }, { kind: 'pane', name: 'Otto' }] })], { qid: 'q1', text: 'Otto attend.' }, { t: fr, g: glyphsFor({}), width: 80 }));
    expect(lines).toContain('  lu : les sessions · le terminal de Otto');
    expect(lines).toContain('  Otto attend.');
  });

  it('keeps the cards still to act on, newest turn first', () => {
    const cards = openCards([
      turn({ qid: 'a', answeredAt: '2026-10-09T18:00:01.000Z', proposals: [{ cwd: '/w/ledge', project: 'ledge', tool: 'claude', launchedId: 'x' }, { cwd: '/w/web', project: 'web', tool: 'codex' }] }),
      turn({ qid: 'b', answeredAt: '2026-10-09T18:00:02.000Z', relay: { id: 'o', name: 'Otto', tool: 'claude', text: 'Relance', status: 'sent' }, closes: [{ id: 'n', name: 'Nova', tool: 'codex' }] }),
      turn({ qid: 'c' })
    ]);
    expect(cards).toEqual([{ kind: 'close', qid: 'b', rows: [0] }, { kind: 'launch', qid: 'a', rows: [1] }]);
  });
});

describe('tui notifications', () => {
  it('tells a new request, not one already on screen nor a session seen for the first time', () => {
    const [otto, nova] = mockupSessions();
    const was = new Map([[nova!.id, nova!], [otto!.id, otto!]]);
    const now = [{ ...nova!, state: 'waiting_permission' as const, pending: { kind: 'permission' as const, text: 'rm -rf dist', source: 'hook' as const } }, otto!, fakeSession('new', { state: 'waiting_input', pending: { kind: 'question', text: '?', source: 'hook' } })];
    expect(asked(was, now, fr.notify)).toEqual(['Nova attend ton accord : rm -rf dist']);
  });

  it('rings, or sends OSC 9, wrapped for tmux', () => {
    expect(notification('x', 'bell', {})).toBe('\u0007');
    expect(notification('x', 'off', {})).toBe('');
    expect(notification('a\u001bb', 'osc9', {})).toBe('\u001b]9;a b\u0007');
    expect(notification('x', 'osc9', { TMUX: '/tmp/t' })).toBe('\u001bPtmux;\u001b\u001b]9;x\u0007\u001b\\');
  });

  it('reads --notify', () => {
    expect(tuiArgs([])).toEqual({ notify: 'bell', here: false });
    expect(tuiArgs(['--notify', 'osc9', '--here'])).toEqual({ notify: 'osc9', here: true });
    expect(tuiArgs(['--notify=off'])).toEqual({ notify: 'off', here: false });
    expect(tuiArgs(['--notify=loud'])).toBeNull();
    expect(tuiArgs(['--other'])).toBeNull();
  });
});

describe('tui settings', () => {
  it('takes French from a French locale, English otherwise', () => {
    expect(defaultLang({ LANG: 'fr_BE.UTF-8' })).toBe('fr');
    expect(defaultLang({ LC_ALL: 'en_US.UTF-8', LANG: 'fr_FR.UTF-8' })).toBe('en');
    expect(defaultLang({})).toBe('en');
  });

  it('saves the language and keeps the keys it does not know', () => {
    mkdirSync(ledgeDir(), { recursive: true });
    writeFileSync(settingsPath(), JSON.stringify({ notify: 'osc9' }));
    saveSettings({ ...loadSettings(), lang: 'en' });
    expect(JSON.parse(readFileSync(settingsPath(), 'utf8'))).toEqual({ notify: 'osc9', lang: 'en' });
    expect(loadSettings().lang).toBe('en');
  });

  it('a broken file is no settings', () => {
    mkdirSync(ledgeDir(), { recursive: true });
    writeFileSync(settingsPath(), '{ not json');
    expect(loadSettings()).toEqual({});
    writeFileSync(settingsPath(), JSON.stringify({ lang: 'de' }));
    expect(loadSettings()).toEqual({});
  });

  it('every language has its messages', () => { expect(Object.keys(MESSAGES)).toEqual(['fr', 'en']); });
});

describe('tui overview with teams (roles spec §3.9)', () => {
  const team = { id: 'team-a1b2', name: 'ledge-roles', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active' as const, seats: [{ role: 'build', sessionId: 'nova' }], createdAt: '2026-10-09T16:00:00.000Z', updatedAt: '2026-10-09T16:00:00.000Z' };
  const task = (id: string, extra: object) => ({ id, title: `Tâche ${id}`, giver: 'ledge', giverName: 'Ledge', owner: 'nova', ownerName: 'Nova', team: 'team-a1b2', state: 'open' as const, at: '2026-10-09T16:05:00.000Z', updatedAt: '2026-10-09T16:05:00.000Z', log: [], ...extra });
  it('a project lists its common table’s branches, then its teams with their seats; Ledge’s progress per team', () => {
    const sessions = mockupSessions().map(s => (s.id === 'nova' ? { ...s, team: 'team-a1b2', role: 'build' } : s));
    const v = overview(sessions, PROJECTS, [team, { ...team, id: 'team-c3d4', name: 'mobile', state: 'resting', seats: [] }, { ...team, id: 'team-e5f6', state: 'dissolved' }], [task('t000001', { state: 'done' }), task('t000002', {})]);
    const ledge = v.tree[0]!;
    expect(ledge.branches.flatMap(b => b.sessions.map(s => s.name))).toEqual(['Otto', 'Bix']);
    expect(ledge.teams.map(x => [x.team.name, x.team.state, x.sessions.map(s => s.name), `${x.done}/${x.given}`])).toEqual([['ledge-roles', 'active', ['Nova'], '1/2'], ['mobile', 'resting', [], '0/0']]);
    expect(v.order).toEqual(['otto', 'bix', 'nova', 'luna']);
  });
  it('Ledge is a sender in the exchanges; the closed tasks Ledge gave are items of « À toi » until seen', () => {
    const given = { at: '2026-10-09T17:00:00.000Z', by: 'Ledge', what: 'confiée à Nova', op: 'give' as const, from: 'ledge', to: 'nova', fromName: 'Ledge', toName: 'Nova' };
    const tasks = [task('t000001', { state: 'done', at: '2026-10-09T17:00:00.000Z', log: [given] }), task('t000002', { state: 'done', seen: true }), task('t000003', { giver: 'otto', giverName: 'Otto', state: 'done' })];
    expect(exchanges([], 3, tasks, 'Ledge (moi)')[0]).toEqual({ at: '2026-10-09T17:00:00.000Z', from: 'Ledge (moi)', to: 'Nova', summary: 'Tâche t000001', kind: 'task' });
    expect(closedLedgeTasks(tasks).map(x => x.id)).toEqual(['t000001']);
  });
  it('the team and task cards: open until acted on, then their outcome stays in the conversation', () => {
    const turn: ChatTurn = { qid: 'q1', question: 'Monte une équipe', askedAt: '2026-10-09T16:00:00.000Z', steps: [], answer: 'Voici.', answeredAt: '2026-10-09T16:00:05.000Z',
      team: { cwd: '/w/ledge', project: 'ledge', name: 'ledge-roles', seats: [{ role: 'build', label: 'Build', tool: 'claude' }] }, tasks: [{ to: '@build', title: 'Implémenter' }] };
    expect(openCards([turn])).toEqual([{ kind: 'team', qid: 'q1' }, { kind: 'task', qid: 'q1', rows: [0] }]);
    const done: ChatTurn = { ...turn, team: { ...turn.team!, teamId: 'team-a1b2', launchedAt: '2026-10-09T16:01:00.000Z' }, tasks: [{ ...turn.tasks![0]!, taskId: 't91b0d4', ownerName: 'Mila', state: 'taken' }] };
    expect(openCards([done])).toEqual([]);
    const lines = text(chatLines([done], null, { t: fr, g: glyphsFor({}), width: 80 }));
    expect(lines.some(l => l.includes('▣ ledge-roles · ✓ Équipe lancée à'))).toBe(true);
    expect(lines).toContain('  Implémenter · ✓ Confiée à Mila · t91b0d4 · prise');
  });
});

describe('tui image lines', () => {
  const ref = { id: 'a'.repeat(64), mime: 'image/png' as const, width: 1440, height: 900, bytes: 212_000, preview: false };
  const at = '2026-10-09T18:00:00.000Z';
  const o = { g: glyphsFor({}), now: Date.parse(at), width: 80, diffs: false, unfolded: false };

  it('a prompt shows one line per image, indented, with the o hint', () => {
    const items: ThreadItem[] = [{ kind: 'prompt', id: 'p1', at, turn: 1, text: 'Regarde', images: [ref, { ...ref, id: 'b'.repeat(64), width: 800, height: 600, bytes: 1_400_000 }] }];
    expect(text(threadLines(items, { ...o, t: fr }))).toEqual(expect.arrayContaining(['  ▣ capture 1440×900 · 212 Ko · o ouvrir dans la visionneuse', '  ▣ capture 800×600 · 1,4 Mo · o ouvrir dans la visionneuse']));
    expect(text(threadLines(items, { ...o, t: en }))).toContain('  ▣ capture 1440×900 · 212 KB · o open in viewer');
  });

  it('a chat question shows its images with alt+o', () => {
    const turn: ChatTurn = { qid: 'q1', question: 'Et ça ?', askedAt: at, steps: [], attachments: [ref] };
    expect(text(chatLines([turn], null, { t: fr, g: glyphsFor({}), width: 80 }))).toContain('  ▣ capture 1440×900 · 212 Ko · alt+o ouvrir dans la visionneuse');
    expect(text(chatLines([turn], null, { t: en, g: glyphsFor({}), width: 80 }))).toContain('  ▣ capture 1440×900 · 212 KB · alt+o open in viewer');
  });

  it('threadImages lists the images of the turns shown in full, oldest first', () => {
    const other = { ...ref, id: 'c'.repeat(64) };
    const items: ThreadItem[] = [
      { kind: 'prompt', id: 'p1', at, turn: 1, text: 'un', images: [ref] },
      { kind: 'reply', id: 'r1', at, turn: 1, text: 'ok' },
      { kind: 'prompt', id: 'p2', at, turn: 2, text: 'deux', images: [other] }
    ];
    expect(threadImages(items, false)).toEqual([other]);
    expect(threadImages(items, true)).toEqual([ref, other]);
  });
});
