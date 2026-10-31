import { describe, expect, it } from 'vitest';
import type { Rig, RigSeat } from '@ledge/protocol';
import { seatMentions } from '../src/rigs/model';

const seat = (name: string, rig: string, extra: Partial<RigSeat> = {}): RigSeat => ({ ref: `${name}@${rig}`, address: `@${name}`, name, runtime: 'claude-code', state: 'working', ...extra });
const rig = (id: string, name: string, seats: RigSeat[], extra: Partial<Rig> = {}): Rig =>
  ({ id, name, machine: 'local', cwd: '/w', projectId: null, offProject: false, lifecycle: 'running', kernel: false, seats, repos: [], ...extra });

describe('seatMentions (the @ completion of the Ledge screen, R19)', () => {
  it('lists the seats of running or partial rigs whose address starts with the query, « @build · factory »', () => {
    const factory = rig('r1', 'factory', [seat('build', 'factory'), seat('qa', 'factory'), seat('builder', 'factory')]);
    expect(seatMentions([factory], 'bu')).toEqual([
      { key: 'local/r1/build@factory', label: '@build · factory', insert: '@build' },
      { key: 'local/r1/builder@factory', label: '@builder · factory', insert: '@builder' }
    ]);
    expect(seatMentions([factory], 'BU').map(m => m.insert)).toEqual(['@build', '@builder']);
    expect(seatMentions([factory], '').map(m => m.insert)).toEqual(['@build', '@builder', '@qa']);
  });

  it('an address two live rigs share completes as « @build@factory » (as the daemon resolves it)', () => {
    const factory = rig('r1', 'factory', [seat('build', 'factory')]);
    const starter = rig('r2', 'starter', [seat('dev-build', 'starter', { address: '@build' })]);
    expect(seatMentions([factory, starter], 'bu')).toEqual([
      { key: 'local/r1/build@factory', label: '@build@factory', insert: '@build@factory' },
      { key: 'local/r2/dev-build@starter', label: '@build@starter', insert: '@build@starter' }
    ]);
    // A stopped rig no longer makes it ambiguous, and is not offered.
    expect(seatMentions([factory, { ...starter, lifecycle: 'stopped' }], 'bu')).toEqual([{ key: 'local/r1/build@factory', label: '@build · factory', insert: '@build' }]);
  });

  it('leaves out stopped or crashed seats, other lifecycles, the kernel and remote machines', () => {
    const r = rig('r1', 'factory', [seat('build', 'factory', { state: 'stopped' }), seat('qa', 'factory', { state: 'crashed' }), seat('design', 'factory', { state: 'idle' })]);
    expect(seatMentions([r], '').map(m => m.insert)).toEqual(['@design']);
    expect(seatMentions([{ ...r, lifecycle: 'partial' }], '').map(m => m.insert)).toEqual(['@design']);
    expect(seatMentions([{ ...r, lifecycle: 'launching' }], '')).toEqual([]);
    expect(seatMentions([{ ...r, kernel: true }], '')).toEqual([]);
    expect(seatMentions([{ ...r, machine: 'nas' }], '')).toEqual([]);
  });
});
