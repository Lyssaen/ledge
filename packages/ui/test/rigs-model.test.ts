import { describe, expect, it } from 'vitest';
import { PROJECT_COLORS, type Projects, type Rig, type RigSeat, type Session } from '@ledge/protocol';
import { allSeats, isSeatPlaceholder, kernelFilter, kernelSplit, parseRigFilter, readyCount, rigColor, rigFilter, rigKey, rigPlace, SEAT_ORDER, seatAt, seatSession, workingCount } from '../src/rigs/model';

const seat = (name: string, over: Partial<RigSeat> = {}): RigSeat => ({ ref: `${name}@factory`, address: `@${name}`, name, runtime: 'claude-code', state: 'ready', ...over });
const rig = (over: Partial<Rig> = {}): Rig => ({ id: 'r1', name: 'factory', machine: 'local', cwd: '/w/ledge', projectId: null, offProject: false,
  lifecycle: 'running', kernel: false, seats: [], repos: [], ...over });
const SEAT = seat('design');
const RIG = rig({ seats: [SEAT] });
const KERNEL = rig({ id: 'k', name: 'kernel', kernel: true, seats: [seat('orch'), seat('advisor'), seat('human', { runtime: 'terminal' })] });
const PROJECTS = { projects: [{ id: 'ledge', name: 'Ledge' }], rules: [] } as unknown as Projects;

describe('rigs model', () => {
  it('rigKey et rigFilter qualifient par machine : deux « factory » ne se confondent pas', () => {
    expect(rigKey({ machine: 'local', id: 'r1' })).not.toBe(rigKey({ machine: 'ec2-build', id: 'r1' }));
    expect(rigKey({ machine: 'local', id: 'r1' })).toBe('local/r1');
    expect(parseRigFilter(rigFilter({ machine: 'ec2-build', id: 'r1' }))).toEqual({ kind: 'rig', machine: 'ec2-build', rigId: 'r1' });
    expect(parseRigFilter(kernelFilter('nas'))).toEqual({ kind: 'kernel', machine: 'nas' });
    expect(parseRigFilter('ledge')).toBeNull();
  });

  it('rigColor est stable et vient de PROJECT_COLORS', () => {
    const c = rigColor({ name: 'factory' });
    expect(Object.keys(PROJECT_COLORS)).toContain(c);
    expect(rigColor({ name: 'factory' })).toBe(c);
  });

  it('seatSession : la session appariée quand elle existe', () => {
    const paired = { id: 'local:x', name: 'x' } as Session;
    expect(seatSession({ ...SEAT, sessionId: 'local:x' }, RIG, new Map([['local:x', paired]]))).toBe(paired);
  });

  it('seatSession : sinon un fantôme seat:… non lancé par Ledge', () => {
    const s = seatSession({ ...SEAT, sessionId: undefined, state: 'trust' }, RIG, new Map());
    expect(isSeatPlaceholder(s.id)).toBe(true);
    expect(s.id).toBe('seat:local/r1/design@factory');
    expect(s).toMatchObject({ name: 'design', source: 'hook_only', state: 'starting', tool: 'claude', cwd: '/w/ledge' });
  });

  it('fantôme : outil et état déduits', () => {
    const ph = (over: Partial<RigSeat>) => seatSession({ ...SEAT, sessionId: undefined, ...over }, RIG, new Map());
    expect(ph({ runtime: 'codex' }).tool).toBe('codex');
    expect(ph({ runtime: 'terminal' }).tool).toBe('claude');
    expect(ph({ state: 'working' }).state).toBe('working');
    expect(ph({ state: 'idle' }).state).toBe('idle');
    expect(ph({ state: 'crashed' }).state).toBe('error');
    expect(ph({ state: 'stopped' }).state).toBe('exited');
    expect(ph({ state: 'unreachable' }).offline).toBe(true);
    expect(ph({ state: 'ready' }).offline).toBeUndefined();
  });

  it('kernelSplit range advisor et le terminal humain', () => {
    expect(kernelSplit(KERNEL).shown.map(s => s.name)).toEqual(['orch']);
    expect(kernelSplit(KERNEL).hidden.map(s => s.name)).toEqual(['advisor', 'human']);
  });

  it('workingCount et readyCount', () => {
    const r = rig({ seats: [seat('a', { state: 'working' }), seat('b', { state: 'idle' }), seat('c', { state: 'ready' }), seat('d', { state: 'crashed' }), seat('e', { state: 'trust' })] });
    expect(workingCount(r)).toBe(1);
    expect(readyCount(r)).toBe(3);
  });

  it('rigPlace : dans <projet> si projectId, hors projet si offProject, rien sinon', () => {
    expect(rigPlace(rig({ projectId: 'ledge' }), PROJECTS)).toEqual({ kind: 'project', name: 'Ledge' });
    expect(rigPlace(rig({ offProject: true, cwd: '/tmp/x' }), PROJECTS)).toEqual({ kind: 'off', cwd: '/tmp/x' });
    expect(rigPlace(rig(), PROJECTS)).toEqual({ kind: 'none' });
    expect(rigPlace(rig({ projectId: 'ledge' }), null)).toEqual({ kind: 'project', name: 'ledge' }); // name unknown: the id
  });

  it('SEAT_ORDER', () => {
    expect(SEAT_ORDER).toEqual(['working', 'trust', 'starting', 'ready', 'idle', 'crashed', 'unreachable', 'stopped']);
  });

  it('allSeats exclut le noyau et trie au travail d’abord, puis par nom', () => {
    const r = rig({ seats: [seat('zed', { state: 'idle' }), seat('b', { state: 'working' }), seat('a', { state: 'working' })] });
    expect(allSeats([KERNEL, r]).map(x => x.seat.name)).toEqual(['a', 'b', 'zed']);
  });

  it('seatAt trouve par ref, adresse ou nom, dans la bonne machine', () => {
    const r = rig({ seats: [SEAT] });
    expect(seatAt([r], 'local', 'r1', 'design@factory')).toBe(SEAT);
    expect(seatAt([r], 'local', 'r1', '@design')).toBe(SEAT);
    expect(seatAt([r], 'local', 'r1', 'design')).toBe(SEAT);
    expect(seatAt([r], 'nas', 'r1', 'design')).toBeUndefined();
  });
});
