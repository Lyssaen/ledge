import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ChatTurn, ThreadItem } from '@ledge/protocol';
import { fr } from '../src/tui/i18n/fr.js';
import { en } from '../src/tui/i18n/en.js';
import { MESSAGES } from '../src/tui/i18n/lang.js';
import { glyphsFor } from '../src/tui/glyphs.js';
import { closedLedgeTasks, exchanges, keepSelection, nextWaiting, overview, step } from '../src/tui/model/overview.js';
import { answerFor, choices } from '../src/tui/model/pending.js';
import { anchorLine, diffCount, threadLines, threadView, wrap } from '../src/tui/model/thread.js';
import { cells } from '../src/tui/model/cells.js';
import { chatLines, openCards } from '../src/tui/model/chat.js';
import { ago, took } from '../src/tui/model/time.js';
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
    // The meta right of the element's first line, at the thread's width.
    const running = lines.find(l => l.includes('npm test'))!;
    expect(running).toMatch(/^ {2}⠋ Bash {3}npm test +6,0 s$/);
    expect(cells(running)).toBe(80);
    const sent = lines.find(l => l.includes('envoyé à'))!;
    expect(sent).toMatch(/^ {2}✉ envoyé à Nova {2}« Tu peux rebaser\. » +✓ remis$/);
    expect(cells(sent)).toBe(80);
  });

  it('a running action ticks on its own: its spinner and time are live pieces, the rest is the same at any time', () => {
    const one = threadLines(items, { ...o, now: Date.parse(at(10)) }), two = threadLines(items, { ...o, now: Date.parse(at(75)) });
    const run = (ls: typeof one) => ls.find(l => l.some(x => x.text.includes('npm test')))!;
    expect(run(one).filter(x => x.live).map(x => x.live)).toEqual([{ spin: true }, { since: Date.parse(at(4)), pad: 9 }]);
    expect(text([run(two)])[0]).toMatch(/1 min 11$/);
    expect(cells(text([run(two)])[0]!)).toBe(cells(text([run(one)])[0]!));
  });

  it('wraps each element at its real width under a hanging indent, up to its ceiling, then « … +n »; unfolded shows all', () => {
    const long = 'pnpm --filter @ledge/ledge exec vitest run test/tui-model.test.ts test/tui-cells.test.ts test/tui-screens.test.tsx --reporter=dot --no-color --bail 1';
    const many: ThreadItem[] = [
      { kind: 'prompt', id: 'p', at: at(0), turn: 1, text: 'Vas-y' },
      { kind: 'tool', id: 'b', at: at(1), turn: 1, tool: 'Bash', label: long, status: 'failed', durationMs: 8_400, error: `AssertionError: ${'expected [ Tests verts ✅ 🎉 ] '.repeat(6)}`, files: [] },
      { kind: 'permission', id: 'q', at: at(2), turn: 1, tool: 'Bash', text: 'rm -rf node_modules/.vite', decision: 'accept' },
      { kind: 'sent', id: 's', at: at(3), turn: 1, to: 'Nova', text: 'Garde un test avec des caractères larges (日本語) en fin de ligne : c’est là que ça débordait, peux-tu relire thread.ts avant que je pousse ?', status: 'read' },
      { kind: 'notice', id: 'n', at: at(4), turn: 1, notice: 'other', text: 'Ledge : Nova a laissé deux remarques sur la PR #212 (calcul des cellules, DIFF_MAX) et attend ta réponse avant de valider la suite du travail.' }
    ];
    const lines = text(threadLines(many, { ...o, width: 50 }));
    for (const l of lines) expect(cells(l)).toBeLessThanOrEqual(50);
    const tool = lines.findIndex(l => l.includes('Bash') && l.includes('pnpm'));
    expect(lines[tool]).toMatch(/8,4 s$/);
    expect(lines[tool + 1]).toMatch(/^ {11}\S/);
    expect(lines[tool + 2]).toMatch(/… \+\d+$/);
    expect(lines[tool + 3]).toMatch(/^ {6}AssertionError/);
    expect(lines.filter(l => l.startsWith('      ') && !l.startsWith('       ')).length).toBeGreaterThan(0);
    expect(lines.find(l => l.includes('rm -rf'))).toMatch(/→ autorisé$/);
    expect(lines.find(l => l.includes('envoyé à'))).toMatch(/✓✓ lu$/);
    const notice = lines.findIndex(l => l.startsWith('  · Ledge'));
    expect(lines[notice + 1]).toMatch(/… \+\d+$/);
    const all = text(threadLines(many, { ...o, width: 50, unfolded: true }));
    expect(all.length).toBeGreaterThan(lines.length);
    expect(all.some(l => l.includes('…'))).toBe(false);
  });

  it('wraps each diff line, what goes on marked ↪', () => {
    const diff = `--- a\n+++ b\n+${'const line: Line = [{ text: status.g, color: status.c }, { text: target(it), color: C.fg }];'}`;
    const lines = text(threadLines([{ kind: 'tool', id: 'e', at: at(0), turn: 0, tool: 'Edit', label: 'thread.ts', status: 'success', files: [{ path: 'thread.ts', change: 'edit', diff }] }], { ...o, width: 50, diffs: true }));
    expect(lines.filter(l => l.startsWith('      │ ↪ ')).length).toBeGreaterThan(0);
    for (const l of lines) expect(cells(l)).toBeLessThanOrEqual(50);
  });

  it('a folded turn takes one line, cut with …; each line knows its item', () => {
    const v = threadView([{ ...items[0]!, text: 'Une très longue demande '.repeat(10) } as ThreadItem, ...items.slice(1)], { ...o, width: 60 });
    expect(v.lines.length).toBe(v.keys.length);
    expect(text([v.lines[0]!])[0]).toMatch(/…$/);
    expect(cells(text([v.lines[0]!])[0]!)).toBe(60);
    expect(v.keys[0]).toBe('p1');
    expect(v.keys[v.keys.length - 1]).toBe('s1');
  });

  it('a line kept at the top whose item folds away falls back on its turn, at the turn’s line', () => {
    const open = threadView(items, { ...o, unfolded: true }), folded = threadView(items, o);
    const tool = open.keys.findIndex(k => k !== 'p1' && !folded.keys.includes(k) && open.turns.get(k) === 'p1');
    expect(tool).toBeGreaterThan(-1);
    expect(anchorLine(open, { key: open.keys[tool]!, offset: 1 })).toBe(tool + 1);
    expect(anchorLine(folded, { key: open.keys[tool]!, offset: 1 })).toBe(folded.keys.indexOf('p1'));
    expect(anchorLine(folded, { key: 'nowhere', offset: 0 })).toBe(-1);
  });

  it('says how long it took: « 8,4 s », « 12 s », « 1 min 04 »', () => {
    expect([took(8_400, ','), took(12_300, ','), took(64_000, ','), took(8_400, '.'), took(7_380_000, ',')]).toEqual(['8,4 s', '12 s', '1 min 04', '8.4 s', '2 h 03']);
  });

  it('unfolds every turn and shows the diffs on demand', () => {
    const lines = text(threadLines(items, { ...o, unfolded: true, diffs: true }));
    expect(lines.find(l => l.includes('SessionList.tsx'))).toContain('+2 −1');
    expect(lines).toContain('      │ -old');
    expect(lines).toContain('      │ +new');
  });

  it('wraps at spaces and counts a diff', () => {
    expect(wrap('un deux trois quatre', 10)).toEqual(['un deux', 'trois', 'quatre']);
    // A line full at its spaces, then its newline: no empty line in between.
    expect(wrap('aaaaa bbbb \nccc', 10)).toEqual(['aaaaa bbbb', 'ccc']);
    expect(wrap('aaaaa bbbb   \n\nccc', 10)).toEqual(['aaaaa bbbb', '', 'ccc']);
    expect(wrap('aaaaa bbbb \n', 10)).toEqual(['aaaaa bbbb', '']);
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
    expect(tuiArgs([])).toEqual({ notify: 'bell' });
    expect(tuiArgs(['--notify', 'osc9'])).toEqual({ notify: 'osc9' });
    expect(tuiArgs(['--notify=off'])).toEqual({ notify: 'off' });
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
    const tasks = [task('t000001', { state: 'done', at: '2026-10-09T17:00:00.000Z' }), task('t000002', { state: 'done', seen: true }), task('t000003', { giver: 'otto', giverName: 'Otto', state: 'done' })];
    expect(exchanges([], 3, tasks)[0]).toEqual({ at: '2026-10-09T17:00:00.000Z', from: 'Ledge', to: 'Nova', summary: 'Tâche t000001' });
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
