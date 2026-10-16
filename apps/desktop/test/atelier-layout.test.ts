import { describe, it, expect } from 'vitest';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { projectOf } from '@ledge/fleet';
import type { Helper, Projects, Session } from '@ledge/protocol';
import type { BotState } from '@ledge/ui/bots/poseFor';
import { mainOrder } from '../src/nav/agents';
import { layoutTable, tableLength, roomWidth, noteX, tableBranch, sheetState, helperState, sceneOf, walkOrder, type AtelierScene } from '../src/atelier/layout';
import { widestRow, fitCeiling, clampZoom, stepZoom, wheelZoom, zoomAround, frameZoom, centreOf, centreOn } from '../src/atelier/zoom';
import { plantsFor } from '../src/atelier/plants';

describe('atelier geometry', () => {
const main = (id: string, extra: Partial<Session> = {}) => fakeSession(id, { id: `local:${id}`, name: id, machineId: 'local', cwd: '/w/ledge', ...extra });
const helper = (id: string, state: Helper['state'] = 'working'): Helper => ({ id, kind: 'Explore', task: `Task ${id}`, state });

it('a table grows one step per agent, from two, up to six', () => {
  expect([1, 2, 3, 6].map(tableLength)).toEqual([210, 210, 280, 490]);
  expect([1, 6, 9].map(roomWidth)).toEqual([470, 750, 750]);
});
it('seats main agents in a zigzag; a lone agent sits in the middle, on top', () => {
  expect(layoutTable([main('a')], true).seats.map(s => [s.x, s.side])).toEqual([[105, 't']]);
  expect(layoutTable(['a', 'b', 'c'].map(id => main(id)), true).seats.map(s => [s.session.name, s.x, s.side])).toEqual([['a', 70, 't'], ['b', 140, 'b'], ['c', 210, 't']]);
});
it("seats helpers at the ends on their parent's side, two per end; the post-it is the first helper, +N the others", () => {
  const t = layoutTable([main('a', { helpers: [helper('a1'), helper('a2')] }), main('b'), main('c', { helpers: [helper('c1'), helper('c2'), helper('c3')] })], true);
  expect(t.ends.map(e => [e.helper.id, e.end, e.slot, e.count])).toEqual([['a1', 'left', 0, 2], ['a2', 'left', 1, 2], ['c1', 'right', 0, 2], ['c2', 'right', 1, 2]]);
  expect(t.extra.helpers.map(h => h.helper.id)).toEqual(['c3']);
  expect(t.notes.get('local:a')).toEqual({ helper: helper('a1'), more: 1 });
  expect(t.notes.get('local:c')).toEqual({ helper: helper('c1'), more: 2 });
});
it('beyond six main agents, and with helpers hidden', () => {
  const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => main(id, { helpers: id === 'g' ? [helper('g1')] : [] }));
  const t = layoutTable(seven, true);
  expect(t.seats).toHaveLength(6);
  expect(t.extra.mains.map(s => s.name)).toEqual(['g']);
  expect(t.extra.helpers.map(h => h.helper.id)).toEqual(['g1']);       // the helper of an agent not seated is not seated
  expect(t.extraCount).toBe(2);
  const hidden = layoutTable(seven, false);
  expect(hidden).toMatchObject({ ends: [], extraCount: 1 });
  expect(hidden.notes.size).toBe(0);
});
it('lays a post-it right of its sheet, else left, else overlapping', () => {
  expect(noteX(70, [70, 210], 490)).toBe(114);
  expect(noteX(420, [140, 280, 420], 490)).toBe(324);
  expect(noteX(100, [100], 150)).toBe(98);
});
it("the table's branch is its agents' most frequent one", () => {
  expect(tableBranch([main('a', { branch: 'desktop' }), main('b', { branch: 'main' }), main('c', { branch: 'desktop' }), main('d')])).toBe('desktop');
  expect(tableBranch([main('a', { branch: 'x' }), main('b', { branch: 'y' })])).toBe('x');
  expect(tableBranch([main('a')])).toBeNull();
});
it('sheet states: idle reads as done, offline wins', () => {
  expect((['approval', 'question', 'done', 'idle', 'working', 'readonly'] as BotState[]).map(s => sheetState(s))).toEqual(['approval', 'question', 'done', 'done', 'working', 'working']);
  expect(sheetState('approval', true)).toBe('offline');
  expect(helperState(helper('h', 'waiting_permission'))).toBe('approval');
});
it('the scene of each filter, and the J / K order', () => {
  const projects: Projects = { projects: ['ledge', 'pay', 'docs'].map(id => ({ id, name: id, color: 'blue' as const, description: '', repos: [{ machine: 'local', path: `/w/${id}` }] })), rules: [] };
  const idOf = (s: Session) => projectOf(s, projects);
  const order = mainOrder([main('otto'), main('nova', { cwd: '/w/pay' }), main('kit', { cwd: '/tmp' })], projects);
  const names = (sc: AtelierScene) => [sc.tables.map(t => `${t.project.id}:${t.mains.map(m => m.name).join(',')}`), sc.unassigned.map(s => s.name), sc.empty?.id ?? null];
  expect(names(sceneOf(order, projects, idOf, 'all'))).toEqual([['ledge:otto', 'pay:nova'], ['kit'], null]);
  expect(names(sceneOf(order, projects, idOf, 'ledge'))).toEqual([['ledge:otto'], [], null]);
  expect(names(sceneOf(order, projects, idOf, 'docs'))).toEqual([[], [], 'docs']);
  expect(names(sceneOf(order, projects, idOf, 'none'))).toEqual([[], ['kit'], null]);
  expect(names(sceneOf(order, null, () => null, 'all'))).toEqual([[], ['otto', 'nova', 'kit'], null]);
  const crowd = mainOrder(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => main(id)), projects);
  expect(walkOrder(sceneOf(crowd, projects, idOf, 'all')).map(s => s.name)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
});
it('mosaic rows and zoom arithmetic', () => {
  expect([1, 2, 3].map(k => widestRow([230, 750, 470, 420], k))).toEqual([1918, 1004, 762]);
  expect(fitCeiling(1200, 1004)).toBeCloseTo(1.053, 3);
  expect(fitCeiling(4000, 300)).toBe(1.8);
  expect([clampZoom(0.1), clampZoom(3), stepZoom(1, 1), stepZoom(2.4, 1), stepZoom(0.32, -1)]).toEqual([0.3, 2.5, 1.2, 2.5, 0.3]);
  expect(wheelZoom(1, -100)).toBeCloseTo(1.246, 3);
  expect(zoomAround({ zoom: 1, left: 0, top: 0 }, 2, { x: 100, y: 50 })).toEqual({ left: 100, top: 50 });
  expect(zoomAround({ zoom: 2, left: 100, top: 50 }, 1, { x: 100, y: 50 })).toEqual({ left: 0, top: 0 });
  const f = frameZoom({ x: 100, y: 50, w: 750, h: 502 }, { width: 1000, height: 600 });
  expect(f.zoom).toBeCloseTo(1.0996, 4); expect(f.left).toBeCloseTo(22.3, 1); expect(f.top).toBeCloseTo(31.0, 1);
  const view = { width: 800, height: 600 };
  expect(centreOf({ zoom: 2, left: 400, top: 100 }, view)).toEqual({ x: 400, y: 200 });
  expect(centreOn({ x: 400, y: 200 }, 2, view, { width: 2000, height: 1500 })).toEqual({ left: 400, top: 100 });
  // clamped to the scrollable range, never negative
  expect(centreOn({ x: 990, y: 10 }, 2, view, { width: 2000, height: 1500 })).toEqual({ left: 1200, top: 0 });
  expect(centreOn({ x: 400, y: 200 }, 1, view, { width: 500, height: 400 })).toEqual({ left: 0, top: 0 });
});
it('plants: one or two per table, from the project id, never on the label corner, away from the +N pill', () => {
  expect(plantsFor('ledge', [])).toEqual([{ spot: 'br', species: 'monstera', flip: false }]);
  expect(plantsFor('pay', [])).toEqual([{ spot: 'br', species: 'snake', flip: true }, { spot: 'ml', species: 'succulent', flip: false }]);
  expect(plantsFor('pay', ['br'])).toEqual([{ spot: 'ml', species: 'snake', flip: true }, { spot: 'mr', species: 'succulent', flip: false }]);
  for (const id of ['a', 'website', 'payment-service', 'x-1']) {
    const p = plantsFor(id, []);
    expect(p.length).toBeGreaterThanOrEqual(1); expect(p.length).toBeLessThanOrEqual(2);
    expect(p.map(x => x.spot)).not.toContain('bl');
  }
});
});
