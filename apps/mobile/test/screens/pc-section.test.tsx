import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PhoneServerMessage } from '@ledge/protocol';
import { PcSection } from '../../src/screens/PcSection';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

const BOOT = '11111111-1111-4111-8111-111111111111';
/** A PC at `version` that says what it can do. */
const pcAt = (version: string, can: { update?: true; restart?: true } = {}, confirm = true): PhoneServerMessage => {
  const s = snapshot([], 'Atelier', BOOT, { confirm, chat: true });
  return s.type === 'snapshot' ? { ...s, daemon: { ...s.daemon, version, ...can } } : s;
};
function open(version: string, can: { update?: true; restart?: true } = {}, { app = '0.10.0', confirm = true }: { app?: string | null; confirm?: boolean } = {}) {
  const t = setup();
  t.deliver(pcAt(version, can, confirm));
  const view = render(<PcSection store={t.store} appVersion={app} />);
  return { ...t, view };
}

describe('« Le PC » on the Connexion screen', () => {
  it('offers the update when the PC is behind and can install, and the restart when it can', () => {
    open('0.9.0', { update: true, restart: true });
    expect(screen.getByRole('heading', { name: 'Le PC' })).toBeInTheDocument();
    expect(screen.getByText('Le PC a du retard sur l’app')).toBeInTheDocument();
    expect(screen.getByText('PC 0.9.0 · app 0.10.0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mettre à jour le PC' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Redémarrer' })).toBeEnabled();
  });

  it('says a clone must be updated by hand, with no command, and still offers the restart', () => {
    const { view } = open('0.9.0', { restart: true });
    expect(screen.getByText('Le PC ne peut pas se mettre à jour seul')).toBeInTheDocument();
    expect(screen.getByText(/clone git/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mettre à jour le PC' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Redémarrer' })).toBeInTheDocument();
    expect(view.container.textContent).not.toContain('/');
  });

  it('asks an older PC that announces nothing to be updated on the PC', () => {
    open('0.9.0');
    expect(screen.getByText('Mettez Ledge à jour sur le PC.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows only the restart for a PC up to date, and nothing for one that cannot restart', () => {
    const { view } = open('0.10.0', { update: true, restart: true });
    expect(screen.queryByText('Le PC a du retard sur l’app')).toBeNull();
    expect(screen.getByRole('button', { name: 'Redémarrer' })).toBeInTheDocument();
    view.unmount();
    const { view: none } = open('0.10.0', { update: true });
    expect(none.container).toBeEmptyDOMElement();
  });

  it('the update sheet names both versions and the passkey; without a passkey it cannot confirm', () => {
    open('0.9.0', { update: true, restart: true }, { confirm: false });
    fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour le PC' }));
    expect(screen.getByRole('heading', { name: 'Mettre à jour le PC ?' })).toBeInTheDocument();
    expect(screen.getByText(/Atelier passe de 0.9.0 à 0.10.0/)).toBeInTheDocument();
    expect(screen.getByText(/Protégez d’abord les accords/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmer' })).toBeDisabled();
  });

  it('follows a run: the steps while it goes, the restart greyed, then done with « Fermer »', () => {
    const t = open('0.9.0', { update: true, restart: true });
    act(() => t.deliver({ type: 'daemon.progress', version: '0.10.0', step: 'installing' }));
    expect(screen.getByText('Mise à jour vers 0.10.0')).toBeInTheDocument();
    expect(screen.getByText('Installation par npm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redémarrer' })).toBeDisabled();
    act(() => t.deliver(pcAt('0.10.0', { update: true, restart: true })));
    expect(screen.getByText('Le PC est en 0.10.0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByText('Le PC est en 0.10.0')).toBeNull();
  });

  it('a refusal says nothing changed and why; « Réessayer » opens the sheet again', () => {
    const t = open('0.9.0', { update: true, restart: true });
    act(() => t.deliver({ type: 'daemon.progress', version: '0.10.0', step: 'installing' }));
    act(() => t.deliver({ type: 'daemon.failed', version: '0.10.0', reason: 'sessions-at-risk' }));
    expect(screen.getByText('Le PC n’a pas été mis à jour')).toBeInTheDocument();
    expect(screen.getByText(/Rien n’a changé : il reste en 0.9.0. .*OMP/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(screen.getByRole('heading', { name: 'Mettre à jour le PC ?' })).toBeInTheDocument();
  });
});
