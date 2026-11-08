import { describe, expect, it } from 'vitest';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { fr } from '../../src/i18n/fr';
import { tabTitle } from '../../src/ide/tabs';

const otto = fakeSession('otto', { name: 'Otto' });
const ctx = { session: (id: string) => (id === 'otto' ? otto : undefined), t: fr };

describe('tabTitle', () => {
  it('a known session: its name', () => {
    expect(tabTitle({ kind: 'session', ref: 'otto' }, ctx)).toBe('Otto');
    expect(tabTitle({ kind: 'seat', ref: 'otto' }, ctx)).toBe('Otto');
  });
  it('an unknown session: its ref', () => {
    expect(tabTitle({ kind: 'session', ref: 'gone' }, ctx)).toBe('gone');
  });
  it('the atelier, the settings', () => {
    expect(tabTitle({ kind: 'atelier', ref: 'main' }, ctx)).toBe('Atelier');
    expect(tabTitle({ kind: 'settings', ref: 'main' }, ctx)).toBe('Réglages');
  });
  it('OpenRig names its machine', () => {
    expect(tabTitle({ kind: 'openrig', ref: 'srv-build' }, ctx)).toBe('OpenRig · srv-build');
    expect(tabTitle({ kind: 'openrig', ref: 'local' }, { ...ctx, machine: id => (id === 'local' ? 'WSL' : undefined) })).toBe('OpenRig · WSL');
  });
  it('a Rig tab: « Rig · name », with the machine when it is not the local one', () => {
    const m = (id: string) => (id === 'srv' ? 'srv' : id === 'local' ? 'WSL' : undefined);
    expect(tabTitle({ kind: 'rig', ref: 'local:ledge-dev' }, { ...ctx, machine: m })).toBe('Rig · ledge-dev');
    expect(tabTitle({ kind: 'rig', ref: 'srv:ledge-dev' }, { ...ctx, machine: m })).toBe('Rig · ledge-dev · srv');
    expect(tabTitle({ kind: 'rig', ref: 'gone:ledge-dev' }, ctx)).toBe('Rig · ledge-dev · gone');
    expect(tabTitle({ kind: 'rig', ref: 'bad' }, ctx)).toBe('bad');
  });
  it('the Changes of a session: « Modifications · name »', () => {
    const a = fakeSession('a', { name: 'Otto' });
    expect(tabTitle({ kind: 'changes', ref: 'a' }, { ...ctx, session: id => (id === 'a' ? a : undefined) })).toBe('Modifications · Otto');
  });
});
