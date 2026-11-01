import { describe, expect, it } from 'vitest';
import { relayPill } from '../src/chat/relayPill';

const helper = (state: 'working' | 'idle' | 'exited') => ({ state }) as never;

describe('relayPill', () => {
  it('words the target as the PC and the phone show it', () => {
    expect(relayPill(undefined)).toBe('stopped');
    expect(relayPill({ state: 'exited', helpers: [] })).toBe('stopped');
    expect(relayPill({ state: 'error', helpers: [] })).toBe('stopped');
    expect(relayPill({ state: 'waiting_input', helpers: [] })).toBe('waiting');
    expect(relayPill({ state: 'waiting_permission', helpers: [] })).toBe('waiting');
    expect(relayPill({ state: 'idle', helpers: [helper('idle'), helper('exited')] })).toBe('yours');
    expect(relayPill({ state: 'idle', helpers: [helper('working')] })).toBe('working');
    expect(relayPill({ state: 'working', helpers: [] })).toBe('working');
    expect(relayPill({ state: 'starting', helpers: [] })).toBe('working');
  });
});
