import { describe, it, expect } from 'vitest';
import type { Rig } from '@ledge/protocol';
import { completeMention, mentionAt, mentionCandidates, mostActiveRig } from '../src/tui/model/mention.js';
import { mockupRigs } from './tui-fixture.js';

/** The mockup's rigs, starter's dev-build answering to `@build` too (the mockup's « @build · starter · dev-build »). */
const homonyms = (): Rig[] => mockupRigs().map(r => (r.id === 'starter' ? { ...r, seats: r.seats.map(s => (s.name === 'dev-build' ? { ...s, address: '@build' } : s)) } : r));

describe('ledge tui: @seat completion', () => {
  it('mentionAt finds the word under the cursor', () => {
    expect(mentionAt('relance @bu', 11)).toEqual({ start: 8, query: 'bu' });
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionAt('@build relance', 3)).toEqual({ start: 0, query: 'bu' });
    // No `@` at the word's start, or the cursor after a space: no mention.
    expect(mentionAt('relance', 7)).toBeNull();
    expect(mentionAt('mail a@b', 8)).toBeNull();
    expect(mentionAt('@build ', 7)).toBeNull();
  });

  it('a unique address stays short, with its rig as detail', () => {
    expect(mentionCandidates('bu', mockupRigs()).map(m => [m.address, m.rig, m.seat.ref, m.detail]))
      .toEqual([['@build', 'factory', 'build@factory', 'factory']]);
  });

  it('homonyms get their long address', () => {
    const found = mentionCandidates('bu', homonyms());
    expect(found.map(m => m.address)).toEqual(['@build@factory', '@build@starter']);
    // The seat's own name when its address does not say it.
    expect(found[1]!.detail).toBe('starter · dev-build');
    // The long form typed narrows to its rig.
    expect(mentionCandidates('build@st', homonyms()).map(m => m.address)).toEqual(['@build@starter']);
  });

  it('stopped seats and stopped rigs are not offered', () => {
    const rigs = homonyms().map(r => (r.id === 'starter' ? { ...r, seats: r.seats.map(s => (s.name === 'dev-build' ? { ...s, state: 'stopped' as const } : s)) } : r));
    // The stopped homonym gone, factory's build is the only one: its short address again.
    expect(mentionCandidates('bu', rigs).map(m => m.address)).toEqual(['@build']);
    const stoppedRig = mockupRigs().map(r => (r.id === 'factory' ? { ...r, lifecycle: 'stopped' as const } : r));
    expect(mentionCandidates('', stoppedRig).map(m => m.rig)).not.toContain('factory');
    const crashed = mockupRigs().map(r => (r.id === 'factory' ? { ...r, seats: r.seats.map(s => (s.name === 'qa' ? { ...s, state: 'crashed' as const } : s)) } : r));
    expect(mentionCandidates('qa', crashed)).toEqual([]);
    // The kernel's seats are no agents to write to.
    expect(mentionCandidates('op', mockupRigs())).toEqual([]);
  });

  it('completing replaces the word under the cursor with the address and a space', () => {
    expect(completeMention('relance @bu', { start: 8, query: 'bu' }, '@build')).toBe('relance @build ');
    expect(completeMention('@bu les tests', { start: 0, query: 'bu' }, '@build@factory')).toBe('@build@factory les tests');
  });

  it('the most active rig is the one with the most seats at work, kernel aside', () => {
    expect(mostActiveRig(mockupRigs())?.name).toBe('factory');
    expect(mostActiveRig([])).toBeUndefined();
  });
});
