import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAST_STATE_KEY } from '../../src/state/persist';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { app } from './app-setup';

afterEach(() => { vi.unstubAllGlobals(); });

/** The app with the last state cached, then a key store the link could not read. */
function unreadable() {
  const t = app('ready');
  act(() => t.deliver(snapshot([session('a')], 'PC-Desan')));
  act(() => t.set('storage_unavailable'));
  return t;
}

describe('a key store that cannot be read', () => {
  it('says so, with « Réessayer » and « Recharger », and starts no pairing', () => {
    const t = unreadable();
    expect(screen.getByRole('heading', { name: 'Stockage du téléphone illisible' })).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Réessayer', 'Recharger']);
    expect(t.calls).toEqual([]);
  });

  it('erases nothing: the cached state stays', () => {
    const t = unreadable();
    expect(t.storage.getItem(LAST_STATE_KEY)).not.toBeNull();
    expect(t.store.getState().sessions.size).toBe(1);
  });

  it('« Réessayer » reads the store again through the link', () => {
    const t = unreadable();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(t.calls).toEqual(['retry']);
  });

  it('« Recharger » reloads the page', () => {
    unreadable();
    const reload = vi.fn();
    // jsdom's location cannot be spied on: replaced for the click only.
    vi.stubGlobal('location', { reload });
    fireEvent.click(screen.getByRole('button', { name: 'Recharger' }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
