import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PinnedPc } from '../../src/link/keys';
import { LAST_STATE_KEY } from '../../src/state/persist';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { app } from './app-setup';

const pc: PinnedPc = { publicKey: 'K', fingerprint: '7c41e09aQ2xLmN0pRsTuVw', name: 'PC-Desan', pinnedAt: '2026-10-16T08:00:00.000Z' };

/** A phone that was ready with the PC's state, then denied by it. */
function denied(opts: { hash?: string } = {}) {
  const t = app('ready', opts.hash ? { hash: opts.hash } : {});
  act(() => {
    t.setPinned(pc);
    t.deliver(snapshot([session('a', { state: 'waiting_permission', pending: pending({ key: 'ka' }) })], 'PC-Desan'));
  });
  act(() => t.set('denied'));
  return t;
}

describe('the PC no longer knows this phone', () => {
  it('says so, whatever the route, with « Refaire la liaison » and « Se déconnecter »', () => {
    denied({ hash: '#/thread/a' });
    expect(screen.getByRole('heading', { name: 'PC-Desan ne reconnaît plus ce téléphone' })).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Refaire la liaison', 'Se déconnecter']);
  });

  it('before the PC was named: « Votre PC »', () => {
    app('denied');
    expect(screen.getByRole('heading', { name: 'Votre PC ne reconnaît plus ce téléphone' })).toBeInTheDocument();
  });

  it('erases nothing and starts no pairing until the user chooses', () => {
    const t = denied();
    expect(t.calls).toEqual([]);
    expect(t.storage.getItem(LAST_STATE_KEY)).not.toBeNull();
    expect(t.store.getState().sessions.size).toBe(1);
  });

  it('« Refaire la liaison » relinks, once', () => {
    const t = denied();
    fireEvent.click(screen.getByRole('button', { name: 'Refaire la liaison' }));
    act(() => { t.setPinned(null); t.set('pairing'); });
    expect(t.calls).toEqual(['relink']);
  });

  it('« Se déconnecter » signs out', () => {
    const t = denied();
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(t.calls).toEqual(['signOut']);
  });
});
