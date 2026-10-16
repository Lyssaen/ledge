import { describe, expect, it } from 'vitest';
import { fakeSession, T0 } from '@ledge/fleet/test/mockDaemon';
import { projectOf } from '@ledge/fleet';
import type { Pending, Projects, Session } from '@ledge/protocol';
import { mainOrder } from '../src/nav/agents';
import { MESSAGES } from '../src/i18n/messages';
import { bucketOf, helperBucket, listModel, quickActions, repoOf, walkRows, type ListCtx, type ListModel, type ListQuery } from '../src/list/model';
import { spanOf, trackWaits, whenOf } from '../src/list/time';

const P: Projects = { projects: [
  { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
  { id: 'pay', name: 'Payment', color: 'green', description: '', repos: [{ machine: 'dev', path: '/w/pay' }] },
  { id: 'docs', name: 'Docs', color: 'amber', description: '', repos: [{ machine: 'local', path: '/w/docs' }] }
], rules: [] };
const at = (min: number) => new Date(Date.parse(T0) - min * 60_000).toISOString();
const ask = (kind: Pending['kind'], text = 'npm test'): Pending => ({ kind, text, source: 'hook' });
const s = (id: string, extra: Partial<Session> = {}) => fakeSession(`local:${id}`, { name: id[0]!.toUpperCase() + id.slice(1), machineId: 'local', machineName: 'Local', cwd: '/w/ledge', ...extra });
const otto = s('otto', { branch: 'desktop', helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'working' }, { id: 'h2', kind: 'Review', task: 'Relire la PR', state: 'waiting_permission' }] });
const nova = s('nova', { state: 'waiting_input', pending: ask('question'), lastActivityAt: at(2), branch: 'main', helpers: [{ id: 'n1', kind: 'Plan', task: 'Découper', state: 'working' }] });
const pim = s('pim', { state: 'waiting_permission', pending: ask('permission'), lastActivityAt: at(10), branch: 'desktop', topic: 'Écrire la doc' });
const bix = s('bix', { state: 'idle' });
const rio = fakeSession('dev:rio', { name: 'Rio', machineId: 'dev', machineName: 'Dev SSH', cwd: '/w/pay', offline: true });
const kit = s('kit', { cwd: '/tmp/scratch', repo: 'scratch' });
const order = mainOrder([otto, nova, pim, bix, rio, kit], P);                   // bix, nova, otto, pim · rio · kit
const ctx: ListCtx = {
  projects: P, projectIdOf: x => projectOf(x, P), waits: new Map(),
  machines: [{ id: 'local', label: 'Local', status: 'open' }, { id: 'dev', label: 'Dev SSH', status: 'unreachable' }],
  labels: { unassigned: 'Sans projet', buckets: MESSAGES.fr.list.buckets }
};
const q = (over: Partial<ListQuery> = {}): ListQuery => ({ text: '', chip: 'all', group: 'project', helpers: true, toggled: new Set(), filter: 'all', ...over });
const names = (m: ListModel) => m.groups.map(g => `${g.key}=${g.rows.map(r => r.kind === 'main' ? r.session.name + (r.context ? '?' : '') : `↳${r.helper.kind}`).join(',')}`);

it('groups by project, Sans projet last; what waits first, the longest wait on top, then the shell order', () => {
  const m = listModel(order, ctx, q());
  expect(names(m)).toEqual(['project:ledge=Pim,Nova,Bix,Otto,↳Explore,↳Review', 'project:pay=Rio', 'project:none=Kit']);
  expect(m.groups[0]).toMatchObject({ label: 'Ledge', branch: 'desktop', shown: 4, tally: { decide: 2, running: 1, done: 1, offline: 0 } });
  expect(m.groups[2]).toMatchObject({ label: 'Sans projet', unassigned: true });
  expect(m.groups[0]!.rows.filter(r => r.kind === 'helper').map(r => r.kind === 'helper' && r.last)).toEqual([false, true]);
  expect(m.counts).toEqual({ all: 6, decide: 2, running: 2, done: 1, offline: 1 });
  expect([m.total, m.filtering, m.empty]).toEqual([6, false, null]);
});
it('subagents fold unless one waits; a toggle flips that; hidden, they are neither rows nor counted', () => {
  expect(names(listModel(order, ctx, q({ toggled: new Set(['local:otto', 'local:nova']) })))[0]).toBe('project:ledge=Pim,Nova,↳Plan,Bix,Otto');
  const hidden = listModel(order, ctx, q({ helpers: false }));
  expect(names(hidden)[0]).toBe('project:ledge=Pim,Nova,Bix,Otto');
  expect(hidden.groups[0]!.rows.every(r => r.kind === 'main' && r.kids === 0)).toBe(true);
  expect(names(listModel(order, ctx, q({ helpers: false, text: 'lire le code' })))).toEqual([]);
});
it('the text filter folds accents and reads name, task, machine, repo, project; a subagent keeps its parent as context', () => {
  const ctxOf = (text: string) => names(listModel(order, ctx, q({ text })));
  expect(ctxOf('ecrire')).toEqual(['project:ledge=Pim']);
  expect(ctxOf('dev ssh')).toEqual(['project:pay=Rio']);
  expect(ctxOf('payment')).toEqual(['project:pay=Rio']);
  expect(ctxOf('scratch')).toEqual(['project:none=Kit']);
  expect(ctxOf('sans projet')).toEqual(['project:none=Kit']);
  const sub = listModel(order, ctx, q({ text: 'lire le code' }));
  expect(names(sub)).toEqual(['project:ledge=Otto?,↳Explore']);
  expect(sub.counts).toEqual({ all: 1, decide: 0, running: 1, done: 0, offline: 0 });
  expect([sub.groups[0]!.shown, sub.filtering]).toEqual([1, true]);
});
it('a chip narrows the rows, never its own counts; the project filter narrows everything; an empty project is said', () => {
  const decide = listModel(order, ctx, q({ chip: 'decide' }));
  expect(names(decide)).toEqual(['project:ledge=Pim,Nova']);
  expect(decide.groups[0]).toMatchObject({ shown: 2, members: [bix, nova, otto, pim] });
  expect(decide.counts).toEqual({ all: 6, decide: 2, running: 2, done: 1, offline: 1 });
  const pay = listModel(order, ctx, q({ chip: 'decide', filter: 'pay' }));
  expect([pay.groups, pay.counts, pay.total, pay.empty]).toEqual([[], { all: 1, decide: 0, running: 0, done: 0, offline: 1 }, 1, null]);
  const docs = listModel(order, ctx, q({ filter: 'docs' }));
  expect([docs.groups, docs.total, docs.empty?.id]).toEqual([[], 0, 'docs']);
  expect(names(listModel(order, ctx, q({ filter: 'none' })))).toEqual(['project:none=Kit']);
  expect(names(listModel(order, { ...ctx, projects: null, projectIdOf: () => null }, q()))).toEqual(['project:none=Pim,Nova,Bix,Otto,↳Explore,↳Review,Rio,Kit']);
});
it('by machine (an offline one hollow) and by state, in their fixed order', () => {
  const byMachine = listModel(order, ctx, q({ group: 'machine' }));
  expect(names(byMachine)).toEqual(['machine:local=Pim,Nova,Bix,Otto,↳Explore,↳Review,Kit', 'machine:dev=Rio']);
  expect(byMachine.groups[1]).toMatchObject({ label: 'Dev SSH', machine: { id: 'dev', offline: true }, branch: null });
  const byState = listModel(order, ctx, q({ group: 'state' }));
  expect(names(byState)).toEqual(['state:decide=Pim,Nova', 'state:running=Otto,↳Explore,↳Review,Kit', 'state:done=Bix', 'state:offline=Rio']);
  expect(byState.groups.map(g => g.label)).toEqual(['À décider', 'En cours', 'Terminés', 'Hors ligne']);
});
it('J / K walk what is shown, unfolded subagents included, collapsed groups skipped', () => {
  const m = listModel(order, ctx, q());
  expect(walkRows(m.groups, new Set(['project:pay'])).map(r => r.key)).toEqual(['local:pim', 'local:nova', 'local:bix', 'local:otto', 'local:otto:h1', 'local:otto:h2', 'local:kit']);
});
it('buckets and quick actions', () => {
  expect([bix, s('e', { state: 'error' }), s('x', { state: 'exited' }), s('i', { state: 'idle', helpers: [{ id: 'h', kind: 'K', task: 't', state: 'working' }] }), nova, rio].map(bucketOf))
    .toEqual(['done', 'running', 'done', 'running', 'decide', 'offline']);
  expect(helperBucket({ id: 'h', kind: 'K', task: 't', state: 'waiting_input' }, otto)).toBe('decide');
  expect(helperBucket({ id: 'h', kind: 'K', task: 't', state: 'waiting_input' }, rio)).toBe('offline');
  expect([pim, nova, s('p', { state: 'waiting_permission', pending: ask('plan') }), s('d', { state: 'waiting_permission', pending: ask('diff') }),
    { ...pim, offline: true }, { ...pim, source: 'hook_only' as const }].map(quickActions)).toEqual([
    { decide: true, reply: false }, { decide: false, reply: true }, { decide: false, reply: false }, { decide: true, reply: false },
    { decide: false, reply: false }, { decide: false, reply: false }
  ]);
  expect([repoOf(kit), repoOf(otto)]).toEqual(['scratch', 'ledge']);
});
it('spans round down: minutes, hours, days', () => {
  const min = 60_000, h = 60 * min, d = 24 * h;
  expect([0, min - 1, min, 60 * min - 1, h, 24 * h - 1, d, 3 * d, -5000].map(spanOf)).toEqual([
    'now', 'now', { n: 1, unit: 'min' }, { n: 59, unit: 'min' }, { n: 1, unit: 'h' }, { n: 23, unit: 'h' }, { n: 1, unit: 'd' }, { n: 3, unit: 'd' }, 'now'
  ]);
});
it('a wait says « depuis », the rest « il y a », offline « vu pour la dernière fois »; French and English', () => {
  const now = Date.parse(T0), fr = MESSAGES.fr.list.when, en = MESSAGES.en.list.when;
  expect(whenOf(pim, undefined, now, fr)).toEqual({ text: 'depuis 10 min', title: 'En attente depuis 10 min', waiting: true });
  expect(whenOf(pim, at(25), now, en)).toEqual({ text: 'for 25 min', title: 'Waiting for 25 min', waiting: true });
  expect(whenOf(s('b', { lastActivityAt: at(120) }), undefined, now, fr)).toEqual({ text: 'il y a 2 h', title: 'Dernière activité il y a 2 h', waiting: false });
  expect(whenOf({ ...rio, lastActivityAt: at(3 * 1440) }, undefined, now, fr)).toEqual({ text: 'il y a 3 j', title: 'Vu pour la dernière fois il y a 3 j', waiting: false });
  expect(whenOf({ ...rio, lastActivityAt: at(3 * 1440) }, undefined, now, en)).toEqual({ text: '3 d ago', title: 'Last seen 3 d ago', waiting: false });
  expect(whenOf(s('k', { state: 'waiting_input', pending: ask('question') }), undefined, now, fr)).toEqual({ text: 'à l’instant', title: 'Demande reçue à l’instant', waiting: true });
  expect(whenOf(s('w'), undefined, now, en)).toEqual({ text: 'just now', title: 'Last activity just now', waiting: false });
});
it('a wait starts at its request: pane activity during it does not restart it, a new request does', () => {
  const w0 = trackWaits(new Map(), [pim, nova, bix]);
  expect([...w0.keys()]).toEqual(['local:pim', 'local:nova']);
  expect(w0.get('local:pim')!.since).toBe(at(10));
  expect(trackWaits(w0, [{ ...pim, lastActivityAt: at(1) }]).get('local:pim')!.since).toBe(at(10));
  expect(trackWaits(w0, [{ ...pim, pending: ask('permission', 'rm -rf dist'), lastActivityAt: at(1) }]).get('local:pim')!.since).toBe(at(1));
  expect(trackWaits(w0, [{ ...pim, state: 'working', pending: undefined }]).has('local:pim')).toBe(false);
});
