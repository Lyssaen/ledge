import { describe, expect, it } from 'vitest';
import type { Project, Projects, Rig, RigSeat, Session } from '@ledge/protocol';
import { sceneOf, tableSeats, type AtelierScene } from '../src/rigs/scene';

const seat = (name: string, over: Partial<RigSeat> = {}): RigSeat => ({ ref: `${name}@x`, address: `@${name}`, name, runtime: 'claude-code', state: 'ready', ...over });
const rig = (machine: string, id: string, over: Partial<Rig> = {}): Rig => ({ id, name: id, machine, cwd: '/w', projectId: null, offProject: false,
  lifecycle: 'running', kernel: false, seats: [], repos: [], ...over });
const project = (id: string): Project => ({ id, name: id, color: 'blue', description: '', repos: [] }) as Project;
const twoProjects = { projects: [project('ledge'), project('pay'), project('docs')], rules: [] } as unknown as Projects;
const sess = (id: string, cwd: string, r?: Session['rig']): Session => ({ id, name: id, state: 'idle', cwd, ...(r ? { rig: r } : {}) } as Session);
const R = (machine: string, rigId: string) => ({ machine, rigId, rigName: rigId, seat: 's', pod: 'p', member: 'm' });

// Sessions: two in projects, one unassigned, one paired to factory's « build » seat, one paired to the kernel's orchestrator.
const otto = sess('local:otto', '/w/ledge');
const nova = sess('local:nova', '/w/pay');
const kit = sess('local:kit', '/tmp');
const build = sess('local:build', '/w/ledge', R('local', 'r1'));
const orch = sess('local:orch', '/w', R('local', 'k'));
const order = [otto, nova, kit, build, orch];
const byId = new Map(order.map(s => [s.id, s]));
const pid = (s: Session) => (s.cwd.startsWith('/w/ledge') ? 'ledge' : s.cwd.startsWith('/w/pay') ? 'pay' : null);

const FACTORY = rig('local', 'r1', { name: 'factory', projectId: 'ledge', seats: [
  seat('orch-lead', { state: 'working' }), seat('build', { sessionId: 'local:build', state: 'working' }), seat('review-a'), seat('review-b'),
  seat('gone', { state: 'stopped' }), seat('qa'), seat('design')
] });
const ALPHA = rig('nas', 'r2', { name: 'alpha', offProject: true, seats: [seat('dev')] });
const KERNEL = rig('local', 'k', { name: 'kernel', kernel: true, seats: [
  seat('orchestrator', { sessionId: 'local:orch' }), seat('advisor'), seat('human', { runtime: 'terminal' }), seat('watch', { state: 'stopped' })
] });
const KERNEL_2 = rig('local', 'k2', { name: 'kernel2', kernel: true, seats: [seat('other')] });
const RIGS = [FACTORY, KERNEL, ALPHA, KERNEL_2];

const kinds = (sc: AtelierScene) => sc.rooms.map(r => r.kind);
const names = (sc: AtelierScene) => sc.rooms.map(r => r.tables.flatMap(t => t.mains.map(m => m.name)));

describe('sceneOf', () => {
  it('a room per project (standalone sessions), one per rig by name, the kernel last', () => {
    const scene = sceneOf(order, twoProjects, pid, 'all', RIGS, byId);
    expect(kinds(scene)).toEqual(['project', 'project', 'rig', 'rig', 'kernel']);
    expect(scene.rooms.map(r => r.key)).toEqual(['ledge', 'pay', 'nas/r2', 'local/r1', 'local/k']);
    expect(names(scene)[0]).toEqual(['local:otto']);
    expect(names(scene)[3]).toEqual(['orch-lead', 'local:build', 'review-a', 'review-b', 'qa', 'design']);
    expect(scene.rooms[3]).toMatchObject({ kind: 'rig', place: { kind: 'project', name: 'ledge' } });
    expect(scene.rooms[2]).toMatchObject({ kind: 'rig', place: { kind: 'off', cwd: '/w' } });
    expect(scene.rooms[3]!.tables).toHaveLength(1);
    expect(scene.rooms[3]!.tables[0]).toMatchObject({ key: 'local/r1', kind: 'rig' });
    expect(scene.rooms[4]!.tables[0]).toMatchObject({ key: 'local/k', kind: 'kernel', hidden: 2 });
    expect(names(scene)[4]).toEqual(['local:orch']);
    expect(scene.unassigned.map(s => s.name)).toEqual(['local:kit']);
    expect(scene.empty).toBeNull();
  });
  it('project rooms keep one common table', () => {
    const scene = sceneOf(order, twoProjects, pid, 'all', RIGS, byId);
    expect(scene.rooms[0]).toMatchObject({ kind: 'project', key: 'ledge', project: { id: 'ledge' }, tables: [{ key: 'ledge', kind: 'common' }] });
  });
  it('without rigs: the rooms of lot 1, rig sessions back in their project', () => {
    const scene = sceneOf(order, twoProjects, pid, 'all');
    expect(kinds(scene)).toEqual(['project', 'project']);
    expect(names(scene)).toEqual([['local:otto', 'local:build'], ['local:nova']]);
    expect(scene.unassigned.map(s => s.name)).toEqual(['local:kit', 'local:orch']);
  });
  it('rig:local/r1 shows the factory room only', () => {
    const scene = sceneOf(order, twoProjects, pid, 'rig:local/r1', RIGS, byId);
    expect(scene.rooms.map(r => r.key)).toEqual(['local/r1']);
    expect(scene.unassigned).toEqual([]);
    expect(scene.empty).toBeNull();
  });
  it('kernel:local shows that kernel only; an unknown rig shows nothing', () => {
    expect(sceneOf(order, twoProjects, pid, 'kernel:local', RIGS, byId).rooms.map(r => r.kind)).toEqual(['kernel']);
    expect(sceneOf(order, twoProjects, pid, 'rig:local/zz', RIGS, byId)).toEqual({ rooms: [], unassigned: [], empty: null });
  });
  it('a project filter shows that project only; none shows « Sans projet »; an empty project is the empty state', () => {
    expect(sceneOf(order, twoProjects, pid, 'ledge', RIGS, byId).rooms.map(r => r.key)).toEqual(['ledge']);
    expect(sceneOf(order, twoProjects, pid, 'none', RIGS, byId)).toMatchObject({ rooms: [], unassigned: [{ id: 'local:kit' }] });
    expect(sceneOf(order, twoProjects, pid, 'docs', RIGS, byId)).toMatchObject({ rooms: [], empty: { id: 'docs' } });
  });
});

describe('tableSeats', () => {
  const ph = (n: string) => ({ id: `seat:local/r1/${n}`, name: n } as Session);
  const real = (n: string) => ({ id: `local:${n}`, name: n } as Session);
  it('les sièges appariés passent avant les fantômes, l’ordre du rig gardé, le reste en « +N »', () => {
    const mains = [ph('a'), ph('b'), real('c'), ph('d'), real('e')];
    const { seated, extra } = tableSeats(mains, 3);
    expect(seated.map(s => s.name)).toEqual(['a', 'c', 'e']);
    expect(extra.map(s => s.name)).toEqual(['b', 'd']);
  });
  it('sans fantôme, c’est un simple découpage', () => {
    const mains = [real('a'), real('b'), real('c')];
    expect(tableSeats(mains, 2)).toEqual({ seated: [mains[0], mains[1]], extra: [mains[2]] });
  });
});
