import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PinnedPc } from '../../src/link/keys';
import { app } from './app-setup';

const pc: PinnedPc = { publicKey: 'K', fingerprint: '7c41e09aQ2xLmN0pRsTuVw', name: 'PC-Desan', pinnedAt: '2026-10-16T08:00:00.000Z' };

function changed(opts: { hash?: string; name?: string | null } = {}) {
  const t = app('key_changed', opts.hash ? { hash: opts.hash } : {});
  act(() => {
    t.setPinned({ ...pc, name: opts.name === undefined ? pc.name : opts.name });
    t.setReceivedKey('b2f8113dZ9yXwVuTsRqPoN');
  });
  return t;
}

describe('the PC’s key changed', () => {
  it('says so with the known and the received key, whatever the route', () => {
    changed({ hash: '#/thread/a' });
    expect(screen.getByRole('heading', { name: 'La clé de PC-Desan a changé' })).toBeInTheDocument();
    expect(screen.getByText(/Ce téléphone a coupé la connexion/)).toBeInTheDocument();
    const rows = [...document.querySelectorAll('dl dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
    expect(rows).toEqual([['Connue', '7c41 e09a · liée le 16 oct.'], ['Reçue', 'b2f8 113d · inconnue']]);
    expect(screen.getByText('Vous avez réinstallé Ledge ou changé de PC ?')).toBeInTheDocument();
    expect(screen.getByText('Sinon,')).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Refaire la liaison', 'Se déconnecter']);
  });

  it('before the PC was named: « votre PC »', () => {
    changed({ name: null });
    expect(screen.getByRole('heading', { name: 'La clé de votre PC a changé' })).toBeInTheDocument();
  });

  it('« Refaire la liaison » relinks', () => {
    const t = changed();
    fireEvent.click(screen.getByRole('button', { name: 'Refaire la liaison' }));
    expect(t.calls).toEqual(['relink']);
  });

  it('« Se déconnecter » signs out: POST /auth/logout, then the keys forgotten (PhoneLink.signOut)', () => {
    const t = changed();
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(t.calls).toEqual(['signOut']);
  });
});
