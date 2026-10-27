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
import { anchorLine, diffCount, threadImages, threadLines, threadView, wrap } from '../src/tui/model/thread.js';
import { cells, type Line } from '../src/tui/model/cells.js';
import { markdownLines } from '../src/tui/model/markdown.js';
import { helpLines } from '../src/tui/screens/Help.js';
import { askRows } from '../src/tui/screens/Session.js';
import { askHistory, chatLines, chatView, openCards } from '../src/tui/model/chat.js';
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
    // The action card's words every PC front shares (packages/ui actionCopy): checked there, not the TUI's own.
    if (path === 'en.ask.action.copy') { expect(b).toBeTypeOf('object'); return; }
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
  // Two short turns between: turn 1 is then older than the last OPEN_TURNS, folded.
  const older: ThreadItem[] = [
    ...items.filter(i => i.turn === 1),
    { kind: 'prompt', id: 'pb', at: at(2.2), turn: 2, text: 'Relis' }, { kind: 'reply', id: 'rb', at: at(2.4), turn: 2, text: 'Relu.' },
    { kind: 'prompt', id: 'pc', at: at(2.6), turn: 3, text: 'Pousse' }, { kind: 'reply', id: 'rc', at: at(2.8), turn: 3, text: 'Poussé.' },
    ...items.filter(i => i.turn === 2).map(i => ({ ...i, turn: 4 }))
  ];
  const o = { t: fr, g: glyphsFor({}), now: Date.parse(at(10)), width: 80, diffs: false, unfolded: false };

  it('folds the turns before the last three on one line and shows the last three in full', () => {
    expect(text(threadLines(items, o))).toEqual(expect.arrayContaining(['  Câble la liste', '  Corrige-les']));
    const lines = text(threadLines(older, o));
    expect(lines[0]).toMatch(/^▸ \d\d:\d\d {2}Câble la liste · 1 action · 1 fichier modifié · Deux tests échouent\.$/);
    expect(lines).toEqual(expect.arrayContaining(['  Relis', '  Pousse', '  Corrige-les']));
    expect(lines.filter(l => l.startsWith('▸'))).toHaveLength(1);
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
    const v = threadView([{ ...older[0]!, text: 'Une très longue demande '.repeat(10) } as ThreadItem, ...older.slice(1)], { ...o, width: 60 });
    expect(v.lines.length).toBe(v.keys.length);
    expect(text([v.lines[0]!])[0]).toMatch(/…$/);
    expect(cells(text([v.lines[0]!])[0]!)).toBe(60);
    expect(v.keys[0]).toBe('p1');
    expect(v.keys[v.keys.length - 1]).toBe('s1');
  });

  it('a line kept at the top whose item folds away falls back on its turn, at the turn’s line', () => {
    const open = threadView(older, { ...o, unfolded: true }), folded = threadView(older, o);
    const tool = open.keys.findIndex(k => k !== 'p1' && !folded.keys.includes(k) && open.turns.get(k) === 'p1');
    expect(tool).toBeGreaterThan(-1);
    expect(anchorLine(open, { key: open.keys[tool]!, offset: 1 })).toBe(tool + 1);
    expect(anchorLine(folded, { key: open.keys[tool]!, offset: 1 })).toBe(folded.keys.indexOf('p1'));
    expect(anchorLine(folded, { key: 'nowhere', offset: 0 })).toBe(-1);
  });

  it('says how long it took: « 8,4 s », « 12 s », « 1 min 04 »', () => {
    expect([took(8_400, ','), took(12_300, ','), took(64_000, ','), took(8_400, '.'), took(7_380_000, ',')]).toEqual(['8,4 s', '12 s', '1 min 04', '8.4 s', '2 h 03']);
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
    // A line full at its spaces, then its newline: no empty line in between.
    expect(wrap('aaaaa bbbb \nccc', 10)).toEqual(['aaaaa bbbb', 'ccc']);
    expect(wrap('aaaaa bbbb   \n\nccc', 10)).toEqual(['aaaaa bbbb', '', 'ccc']);
    expect(wrap('aaaaa bbbb \n', 10)).toEqual(['aaaaa bbbb', '']);
    expect(diffCount('--- a\n+++ b\n+x\n-y\n-z')).toEqual({ add: 1, del: 2 });
  });
});

describe('tui chat', () => {
  const turn = (extra: Partial<ChatTurn>): ChatTurn => ({ qid: 'q1', question: 'Qui a besoin de moi ?', askedAt: '2026-10-09T18:00:00.000Z', steps: [], ...extra });
  it('shows when and what Ledge read on one line, then the streamed text while it writes, its caret last', () => {
    const lines = text(chatLines([turn({ steps: [{ kind: 'sessions' }, { kind: 'pane', name: 'Otto' }] })], { qid: 'q1', text: 'Otto attend.' }, { t: fr, g: glyphsFor({}), width: 80 }));
    expect(lines.some(l => /^  vous · \d\d:\d\d · lu : les sessions · le terminal de Otto$/.test(l))).toBe(true);
    expect(lines.slice(-2)).toEqual(['  Otto attend.', '  ▍']);
  });

  it('the answer in Markdown; each line keeps its turn, so a scroll stays on it', () => {
    const v = chatView([turn({ answer: '## Qui t’attend\n- **Otto** veut lancer `rm -rf coverage`', answeredAt: '2026-10-09T18:00:05.000Z' }), turn({ qid: 'q2', question: 'Et Luna ?' })],
      null, { t: fr, g: glyphsFor({}), width: 80 });
    const shown = text(v.lines);
    expect(shown).toContain('  Qui t’attend');
    expect(shown).toContain('  • Otto veut lancer rm -rf coverage');
    expect(shown).not.toContain('  ▍');
    expect(v.keys.length).toBe(v.lines.length);
    expect(v.keys[shown.indexOf('❯ Et Luna ?')]).toBe('q2');
    expect(anchorLine(v, { key: 'q2', offset: 0 })).toBe(shown.indexOf('❯ Et Luna ?') - 1);
  });

  it('the history of the field: the questions of the conversation, after the ones cleared since, each once', () => {
    const at = (s: number) => `2026-10-09T18:00:0${s}.000Z`;
    expect(askHistory([turn({ question: 'B', askedAt: at(2) }), turn({ qid: 'q2', question: 'C', askedAt: at(3) })],
      [{ question: 'A', askedAt: at(1) }, { question: 'B', askedAt: at(2) }])).toEqual(['A', 'B', 'C']);
    expect(askHistory([turn({ question: 'A' })], [])).toEqual(['A']);
  });

  it('the history of the field: a question that never got its turn (not sent) comes at its time, not first', () => {
    const at = (s: number) => `2026-10-09T18:00:0${s}.000Z`;
    expect(askHistory([turn({ question: 'B', askedAt: at(2) })], [{ question: 'B', askedAt: at(2) }, { question: 'D', askedAt: at(4) }]))
      .toEqual(['B', 'D']);
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

describe('tui markdown (#95 lot C)', () => {
  const g = glyphsFor({}), ascii = glyphsFor({ LEDGE_TUI_ASCII: '1' });
  const md = (src: string, width = 40, gl = g) => markdownLines(src, { width, g: gl, color: '#fff' });
  const seg = (lines: Line[], s: string) => lines.flat().find(x => x.text.includes(s));

  it('titles without their hashes, bold, # and ## in coral; bold, italics and code as the terminal draws them', () => {
    const lines = md('# Un\n### Trois\n\n**gras** *italique* `code` ~~barré~~');
    expect(text(lines)).toEqual(['Un', 'Trois', '', 'gras italique code barré']);
    expect(seg(lines, 'Un')).toMatchObject({ bold: true, color: '#f07a62' });
    expect(seg(lines, 'Trois')).toMatchObject({ bold: true, color: '#e6e0dc' });
    expect(seg(lines, 'gras')).toMatchObject({ bold: true });
    expect(seg(lines, 'italique')).toMatchObject({ italic: true });
    expect(seg(lines, 'code')!.bg).toBeDefined();
    expect(seg(lines, 'barré')).toMatchObject({ strike: true });
  });

  it('lists with their marks and a hanging indent, nested, numbered and ticked', () => {
    expect(text(md('- un deux trois quatre cinq six sept huit\n  - dedans\n- [ ] à faire\n- [x] fait\n\n1. premier\n2. second', 24))).toEqual([
      '• un deux trois quatre', '  cinq six sept huit', '  ◦ dedans', '☐ à faire', '✓ fait', '', '1. premier', '2. second'
    ]);
    expect(text(md('- un\n  - deux', 40, ascii))).toEqual(['- un', '  o deux']);
  });

  it('a code block between corners, its language on top, a long line wrapped with ↪; one still open while it streams already a block', () => {
    expect(text(md('```bash\npnpm --filter @ledge/fleet test -- reconnect\n```', 30))).toEqual(['╭ bash', '│ pnpm --filter @ledge/fleet', '│ ↪ test -- reconnect', '╰']);
    expect(text(md('Voici :\n\n```ts\nconst a = 1;', 30))).toEqual(['Voici :', '', '╭ ts', '│ const a = 1;', '╰']);
    expect(text(md('```\nx\n```', 30, ascii))).toEqual(['+ code', '| x', '+']);
  });

  it('a link: underlined and clickable with ↗; without OSC 8, its address follows it', () => {
    const lines = md('la [PR #212](https://github.com/x/pull/212) ici', 80);
    expect(text(lines)).toEqual(['la PR #212 ↗ ici']);
    expect(seg(lines, 'PR')).toMatchObject({ underline: true, link: 'https://github.com/x/pull/212' });
    expect(text(md('la [PR](https://x.io/p) et https://x.io', 80, ascii))).toEqual(['la PR (https://x.io/p) et https://x.io']);
    expect(text(md('[PR](https://x.io/p)', 80, glyphsFor({ LEDGE_TUI_LINKS: '0' })))).toEqual(['PR (https://x.io/p)']);
  });

  it('a quote behind its bar in dim italics; a rule; an image by its text', () => {
    const lines = md('> Je peux lui relayer les remarques.\n\n---\n\n![le logo](x.png)', 24);
    expect(text(lines)).toEqual(['▎ Je peux lui relayer', '▎ les remarques.', '', '─'.repeat(24), '', 'le logo']);
    expect(seg(lines, 'relayer')).toMatchObject({ italic: true });
  });

  it('a table in aligned columns, its head in bold over a rule; too wide, its cells wrapped and its rows ruled', () => {
    const src = '| Story | Sous-tâches |\n|---|--:|\n| ST7-266 | 304 à 308, 310 à 314 |\n| **ST7-261** | 331 |';
    const lines = md(src, 40);
    expect(text(lines)).toEqual([
      'Story   │          Sous-tâches', '────────┼─────────────────────', 'ST7-266 │ 304 à 308, 310 à 314', 'ST7-261 │                  331'
    ]);
    expect(seg(lines, 'Story')).toMatchObject({ bold: true });
    expect(seg(lines, 'ST7-261')).toMatchObject({ bold: true });
    expect(seg(lines, 'ST7-266')!.bold).toBeUndefined();
    expect(text(md(src, 24))).toEqual([
      'Story   │    Sous-tâches', '────────┼───────────────', 'ST7-266 │ 304 à 308, 310', '        │          à 314', '────────┼───────────────', 'ST7-261 │            331'
    ]);
    expect(text(md('| a | b |\n|---|---|\n| 1 | 2 |', 40, ascii))).toEqual(['a | b', '--+--', '1 | 2']);
    // No room for its columns: as it was written, cut.
    expect(text(md('| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |', 12))[0]).toBe('| a | b | c |'.slice(0, 11) + '…');
  });

  it('wraps at the real width: an emoji or 日 counts two cells', () => {
    for (const l of text(md('Tests verts ✅ 🎉 sur **fix/tui-wrap** : 日本語 compris, emoji 🎯 aussi.', 16))) expect(cells(l)).toBeLessThanOrEqual(16);
  });

  it('the thread draws its prompts, messages and replies in Markdown', () => {
    const items: ThreadItem[] = [{ kind: 'reply', id: 'r', at: '2026-10-09T18:00:00.000Z', text: '## Fait\n- **wrap** compte les cellules' } as ThreadItem];
    const lines = threadLines(items, { t: fr, g, width: 60, diffs: false, unfolded: false });
    expect(text(lines)).toEqual(['  Fait', '  • wrap compte les cellules']);
  });
});

describe('tui help (#95 lot C)', () => {
  const group = (title: string, n: number) => [title, Array.from({ length: n }, (_, i) => [`k${i}`, `label ${i}`] as const)] as const;
  it('the groups side by side, in order, each column as short as it can', () => {
    const lines = text(helpLines([group('A', 3), group('B', 2), group('C', 3)], 76));
    expect(lines[0]).toMatch(/^A +C$/);
    expect(lines.length).toBe(8);
    expect(lines[4]!.trim()).toBe('');
    expect(lines[5]).toMatch(/^B/);
    expect(text(helpLines([group('A', 3), group('B', 2)], 30))).toHaveLength(8);
  });
});

describe('tui session request (#95 lot A, second review)', () => {
  it('a key wider than the box takes as many rows as Ink wraps it on', () => {
    expect(askRows({ lines: [[{ text: 'Quel port ?' }]], buttons: [{ label: 'x'.repeat(50), k: '1' }] }, 20)).toBe(2 + 1 + 1 + 3);
    expect(askRows({ lines: [[{ text: 'Quel port ?' }]], buttons: [{ label: 'a', k: '1' }, { label: 'b', k: '2' }] }, 20)).toBe(2 + 1 + 1 + 1);
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
      { kind: 'prompt', id: 'p2', at, turn: 2, text: 'deux' },
      { kind: 'prompt', id: 'p3', at, turn: 3, text: 'trois' },
      { kind: 'prompt', id: 'p4', at, turn: 4, text: 'quatre', images: [other] }
    ];
    expect(threadImages(items, false)).toEqual([other]);
    expect(threadImages(items, true)).toEqual([ref, other]);
  });
});
