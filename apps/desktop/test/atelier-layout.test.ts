import { describe, it, expect } from 'vitest';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { projectOf } from '@ledge/fleet';
import type { Helper, Projects, Rig, RigSeat, Session } from '@ledge/protocol';
import type { BotState } from '@ledge/ui/bots/poseFor';
import { mainOrder } from '../src/nav/agents';
import { layoutTable, tableLength, roomWidth, roomTileWidth, noteX, tableBranch, sheetState, helperState, sceneOf, walkOrder, type AtelierScene } from '../src/atelier/layout';
import { widestRow, fitCeiling, clampZoom, stepZoom, wheelZoom, zoomAround, frameZoom, centreOf, centreOn, floorPad } from '../src/atelier/zoom';
import { plantsFor } from '../src/atelier/plantSpots';

describe('atelier geometry', () => {
const main = (id: string, extra: Partial<Session> = {}) => fakeSession(id, { id: `local:${id}`, name: id, machineId: 'local', cwd: '/w/ledge', ...extra });
const helper = (id: string, state: Helper['state'] = 'working'): Helper => ({ id, kind: 'Explore', task: `Task ${id}`, state });

it('a table grows one step per agent, from two, up to six', () => {
  expect([1, 2, 3, 6].map(tableLength)).toEqual([210, 210, 280, 490]);
  expect([1, 6, 9].map(n => roomWidth(n))).toEqual([470, 750, 750]);
  expect([6, 9, 12].map(n => roomWidth(n, 10))).toEqual([750, 960, 1030]);
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
it('the seat count chosen in the settings moves where +N starts', () => {
  const ten = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(id => main(id));
  expect(layoutTable(ten, true, 4)).toMatchObject({ length: tableLength(4), extraCount: 6 });
  const eight = layoutTable(ten, true, 8);
  expect(eight.seats.map(s => s.session.name)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  expect(eight.extra.mains.map(s => s.name)).toEqual(['i', 'j']);
  expect(eight).toMatchObject({ length: tableLength(8), width: roomWidth(10, 8), extraCount: 2 });
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
  const projects: Projects = { projects: ['ledge', 'pay', 'docs'].map(id => ({ id, name: id, color: 'blue' as const, description: '', rigs: [], repos: [{ machine: 'local', path: `/w/${id}` }] })), rules: [] };
  const idOf = (s: Session) => projectOf(s, projects);
  const order = mainOrder([main('otto'), main('nova', { cwd: '/w/pay' }), main('kit', { cwd: '/tmp' })], projects);
  const names = (sc: AtelierScene) => [sc.rooms.map(r => `${r.key}:${r.tables[0]!.mains.map(m => m.name).join(',')}`), sc.unassigned.map(s => s.name), sc.empty?.id ?? null];
  expect(names(sceneOf(order, projects, idOf, 'all'))).toEqual([['ledge:otto', 'pay:nova'], ['kit'], null]);
  expect(names(sceneOf(order, projects, idOf, 'ledge'))).toEqual([['ledge:otto'], [], null]);
  expect(names(sceneOf(order, projects, idOf, 'docs'))).toEqual([[], [], 'docs']);
  expect(names(sceneOf(order, projects, idOf, 'none'))).toEqual([[], ['kit'], null]);
  expect(names(sceneOf(order, null, () => null, 'all'))).toEqual([[], ['otto', 'nova', 'kit'], null]);
  const crowd = mainOrder(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => main(id)), projects);
  expect(walkOrder(sceneOf(crowd, projects, idOf, 'all')).map(s => s.name)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  expect(walkOrder(sceneOf(crowd, projects, idOf, 'all'), 4).map(s => s.name)).toEqual(['a', 'b', 'c', 'd']);
});
it('a project room has one table with all its sessions, whatever their old team or role', () => {
  const projects: Projects = { projects: ['ledge', 'pay'].map(id => ({ id, name: id, color: 'blue' as const, description: '', rigs: [], repos: [{ machine: 'local', path: `/w/${id}` }] })), rules: [] };
  const idOf = (s: Session) => projectOf(s, projects);
  const order = mainOrder([main('otto'), main('nova'), main('pim'), main('kit', { cwd: '/w/pay' }), main('zed', { cwd: '/w/pay' })], projects);
  const scene = sceneOf(order, projects, idOf, 'all');
  expect(scene.rooms.map(r => [r.key, r.tables[0]!.mains.map(m => m.name)])).toEqual([['ledge', ['nova', 'otto', 'pim']], ['pay', ['kit', 'zed']]]);
  expect(walkOrder(scene).map(s => s.name)).toEqual(['nova', 'otto', 'pim', 'kit', 'zed']);
  expect(roomTileWidth(2)).toBe(roomWidth(2) + 220);
});
it('walkOrder goes through rig and kernel tables too, placeholders skipped', () => {
  const projects: Projects = { projects: [{ id: 'ledge', name: 'ledge', color: 'blue', description: '', rigs: [], repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [] };
  const idOf = (s: Session) => projectOf(s, projects);
  const build = main('build', { rig: { machine: 'local', rigId: 'r1', rigName: 'factory', seat: 's', pod: 'p', member: 'm' } });
  const order = mainOrder([main('otto'), build], projects);
  const seat = (name: string, over: Partial<RigSeat> = {}): RigSeat => ({ ref: `${name}@f`, address: `@${name}`, name, runtime: 'claude-code', state: 'ready', ...over });
  const factory: Rig = { id: 'r1', name: 'factory', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'running', kernel: false, repos: [],
    seats: [seat('lead'), seat('build', { sessionId: 'local:build', state: 'working' })] };
  const kernel: Rig = { ...factory, id: 'k', name: 'kernel', kernel: true, seats: [seat('orch')] };
  const scene = sceneOf(order, projects, idOf, 'all', [factory, kernel], new Map(order.map(s => [s.id, s])));
  expect(scene.rooms.map(r => r.kind)).toEqual(['project', 'rig', 'kernel']);
  expect(walkOrder(scene).map(s => s.name)).toEqual(['otto', 'build']);
  expect(walkOrder(sceneOf(order, projects, idOf, 'rig:local/r1', [factory, kernel], new Map(order.map(s => [s.id, s])))).map(s => s.name)).toEqual(['build']);
  // Placeholders do not use up the seats J / K walks: build, after three of them, is still reached on a 2-seat table.
  const crowded: Rig = { ...factory, seats: [seat('a'), seat('b'), seat('c'), seat('build', { sessionId: 'local:build', state: 'working' })] };
  expect(walkOrder(sceneOf(order, projects, idOf, 'rig:local/r1', [crowded], new Map(order.map(s => [s.id, s]))), 2).map(s => s.name)).toEqual(['build']);
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
  // past the floor's padding, the shell starts at `pad`
  expect(centreOn({ x: 400, y: 200 }, 2, view, { width: 3000, height: 2500 }, { left: 300, top: 250 })).toEqual({ left: 700, top: 350 });
});
it('the floor reaches a view beyond the tables on every side, and always keeps a strip of them in sight', () => {
  // A 1000 × 750 shell whose tiles cover 100–700 × 50–550, at zoom 0.5 in an 800 × 600 view: 120 px of the tiles stay visible.
  const pad = floorPad({ width: 800, height: 600 }, { width: 1000, height: 750 }, { x: 100, y: 50, w: 600, h: 500 }, 0.5);
  expect(pad).toEqual({ left: 800 - 120 - 50, right: 800 - 120 - 150, top: 600 - 120 - 25, bottom: 600 - 120 - 100 });
  // Scrolled all the way left, the tiles' left edge sits 120 px before the view's right edge; all the way right, their right
  // edge sits 120 px after the view's left edge.
  const width = pad.left + 1000 * 0.5 + pad.right;
  expect(800 - (pad.left + 100 * 0.5)).toBe(120);
  expect(pad.left + 700 * 0.5 - (width - 800)).toBe(120);
  // Tiles smaller than the strip stay whole; a huge zoom needs no floor at all.
  const small = floorPad({ width: 800, height: 600 }, { width: 1000, height: 750 }, { x: 100, y: 50, w: 100, h: 100 }, 0.5);
  expect([small.left, small.top]).toEqual([800 - 50 - 50, 600 - 50 - 25]);
  expect(floorPad({ width: 800, height: 600 }, { width: 1000, height: 750 }, { x: 100, y: 50, w: 600, h: 500 }, 2.5)).toEqual({ left: 430, right: 0, top: 355, bottom: 0 });
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
