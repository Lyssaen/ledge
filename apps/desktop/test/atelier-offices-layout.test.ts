import { describe, expect, it } from 'vitest';
import { buildLayout, layout, planRest, roomsOf, type Team } from '../src/atelier/offices/layout';
const team = (id: string, n: number, kind: Team['kind'] = 'project'): Team => ({ id, name: id, kind, sessionIds: Array.from({ length: n }, (_, i) => `${id}-${i}`) });
describe('Bureaux placement', () => {
  it('opens overflow rooms without dropping a session', () => {
    expect(roomsOf(team('p', 13)).map(r => r.sessionIds.length)).toEqual([6, 6, 1]);
    expect(roomsOf(team('free', 25, 'none')).map(r => r.sessionIds.length)).toEqual([12, 12, 1]);
  });
  it('places small offices in the first row with space', () => {
    const floor = buildLayout(500, [team('large', 6), team('medium', 4), team('small', 1)], 0);
    expect(floor.rooms.find(r => r.key === 'small')!.y).toBe(floor.rooms.find(r => r.key === 'medium')!.y);
  });
  it('keeps offices fixed when rest rooms are added', () => {
    const teams = [team('p', 5), team('q', 4)];
    const before = buildLayout(500, teams, 0), after = buildLayout(500, teams, 0, ['rl']);
    expect(after.rooms.filter(r => !r.key.startsWith('__rest')).map(r => [r.key, r.x, r.y])).toEqual(before.rooms.map(r => [r.key, r.x, r.y]));
  });
  it('uses zones before rest rooms and opens a wing when needed', () => {
    const teams = [team('p', 6), team('q', 6)];
    const base = layout(448, teams, 0, 0);
    expect(base.rooms.some(r => r.size === 'rs')).toBe(false);
    const crowded = layout(448, teams, 0, 50);
    expect(crowded.rooms.some(r => r.size === 'rl')).toBe(true);
    expect(crowded.wings).toBeGreaterThan(base.wings);
    expect(planRest(14)).toEqual(['rl', 'rs']);
  });
});

describe('office routes', () => {
  it('connects two wings through the western corridor', async () => {
    const { buildWorld, route } = await import('../src/atelier/offices/presence');
    const floor = buildLayout(448, [team('p', 6), team('q', 6), team('r', 6)], 0);
    const world = buildWorld(floor);
    const a = world.seats.get('p-0')!, b = world.seats.get('r-0')!;
    expect(a.corY).not.toBe(b.corY);
    const path = route(a, b);
    expect(path).toContainEqual({ x: 31, y: a.corY });
    expect(path).toContainEqual({ x: 31, y: b.corY });
  });
});
