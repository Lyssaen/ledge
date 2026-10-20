import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PinnedPc } from '../../src/link/keys';
import { snapshot } from '../state/helpers';
import { app } from './app-setup';

const pc: PinnedPc = { publicKey: 'K', fingerprint: '7c41e09a00000000000000', name: null, pinnedAt: '2026-10-16T08:00:00.000Z' };
const compare = (over: { pcConfirmed?: boolean; phoneConfirmed?: boolean } = {}) =>
  ({ step: 'compare' as const, code: '123 456', pcConfirmed: false, phoneConfirmed: false, ...over });

describe('comparing the code', () => {
  it('unpaired → a pairing starts at once', () => {
    const t = app('unpaired');
    expect(t.calls).toEqual(['startPairing']);
  });

  it('waits for the PC’s code, then shows it as « 123 456 », with the account signed in', async () => {
    const t = app('pairing');
    act(() => t.setPairing({ step: 'committing' }));
    expect(screen.getByRole('status')).toHaveTextContent('En attente du code du PC…');
    act(() => t.setPairing(compare()));
    expect(screen.getByRole('heading', { name: 'Comparez ce code' })).toBeInTheDocument();
    expect(screen.getByText(/Ledge vient d’afficher un code sur/)).toHaveTextContent('Ledge vient d’afficher un code sur votre PC. Il doit être identique à celui-ci.');
    expect(screen.getByLabelText('Code de liaison 123 456')).toHaveTextContent('123456');
    expect([...screen.getByLabelText('Code de liaison 123 456').children].map((c) => c.textContent)).toEqual(['123', '456']);
    expect(screen.getByText('Calculé à partir des clés du PC et de ce téléphone')).toBeInTheDocument();
    expect(await screen.findByText('@paradow')).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Les codes sont identiques', 'Ils sont différents']);
  });

  it('same → « Confirmez sur le PC » while pair_ok is missing, then « Téléphone lié à <nom> » until « Voir ce qui attend »', () => {
    const t = app('pairing');
    act(() => t.setPairing(compare()));
    fireEvent.click(screen.getByRole('button', { name: 'Les codes sont identiques' }));
    expect(t.calls).toContain('confirmOnPhone');
    expect(screen.getByRole('heading', { name: 'Confirmez sur le PC' })).toBeInTheDocument();
    expect(screen.getByText(/cliquez sur Approuver/)).toHaveTextContent('Dans Ledge sur votre PC, cliquez sur Approuver sous le même code 123 456.');
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();

    // pair_ok: the link pins the PC, says hello, and the first snapshot names it.
    act(() => {
      t.setPairing({ step: 'linked', pc });
      t.setPinned(pc);
      t.set('ready');
    });
    act(() => t.deliver(snapshot([], 'PC-Desan')));
    expect(screen.getByRole('heading', { name: 'Téléphone lié à PC-Desan' })).toBeInTheDocument();
    expect(screen.getByText('Vous pouvez lire, approuver et écrire. Retirez ce téléphone à tout moment depuis Ledge sur le PC.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Voir ce qui attend' }));
    expect(screen.getByRole('heading', { name: 'À traiter' })).toBeInTheDocument();
  });

  it('the PC confirmed first: the code stays until the phone says it is the same', () => {
    const t = app('pairing');
    act(() => t.setPairing(compare({ pcConfirmed: true })));
    expect(screen.getByRole('heading', { name: 'Comparez ce code' })).toBeInTheDocument();
  });

  it('different → « Liaison annulée », nothing confirmed, and « Recommencer » pairs again', () => {
    const t = app('pairing');
    act(() => t.setPairing(compare()));
    fireEvent.click(screen.getByRole('button', { name: 'Ils sont différents' }));
    expect(t.calls).toEqual(['cancel']);
    expect(t.sent).toEqual([]);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Liaison annulée');
    expect(alert).toHaveTextContent('Des codes différents signifient que ce téléphone et le PC ne voient pas les mêmes clés.');
    fireEvent.click(screen.getByRole('button', { name: 'Recommencer' }));
    expect(t.calls).toEqual(['cancel', 'startPairing']);
  });

  it('cancelled while waiting for the PC → cancelled, without the warning about other keys', () => {
    const t = app('pairing');
    act(() => t.setPairing(compare({ phoneConfirmed: true })));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.getByRole('heading', { name: 'Liaison annulée' })).toBeInTheDocument();
    expect(screen.queryByText(/Quelqu’un tente peut-être/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recommencer' })).toBeInTheDocument();
  });

  it.each([
    ['expired', 'Code expiré'],
    ['refused', 'Liaison refusée sur le PC']
  ] as const)('%s → said, and « Recommencer » pairs again', (step, title) => {
    const t = app('pairing');
    act(() => t.setPairing({ step }));
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recommencer' }));
    expect(t.calls).toEqual(['startPairing']);
  });
});
