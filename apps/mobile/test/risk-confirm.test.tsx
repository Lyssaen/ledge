import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ClientMessage, Session } from '@ledge/protocol';
import { RequestDetail } from '../src/screens/RequestDetail';
import { RiskConfirm } from '../src/screens/RiskConfirm';
import { requestsOf } from '../src/model/requests';
import { mobileStore } from '../src/state/store';

const session = (extra: Record<string, unknown> = {}, risk: 'low' | 'high' = 'high'): Session => ({
  id: 's', name: 'Kai', tool: 'claude', cwd: '/w/ledge-site', project: 'ledge-site', repo: 'ledge-site', branch: 'main', topic: 'Publication du site', title: 'Kai', tmuxSession: 'ledge-s', state: 'waiting_permission', helpers: [],
  startedAt: '2026-10-14T10:00:00Z', lastActivityAt: '2026-10-14T10:00:00Z', source: 'launcher',
  pending: { id: 'p', version: 1, since: '2026-10-14T10:00:00Z', kind: 'permission', text: 'git push --force origin main', source: 'hook', risk, riskReason: 'pushes', ...extra }
} as Session);
const item = () => requestsOf([session()])[0]!;
const challenge = (expiresAt = new Date(Date.now() + 60_000).toISOString()) => ({ type: 'decide.challenge' as const, id: 's', pendingId: 'p', pendingVersion: 1, decision: 'accept' as const, options: { challenge: 'c' }, expiresAt });
const assertion = { id: 'a', rawId: 'a', type: 'public-key', response: {}, clientExtensionResults: {} };

let sent: ClientMessage[];
beforeEach(() => {
  localStorage.clear(); mobileStore.reset();
  sent = [];
  mobileStore.setSender(m => { sent.push(m); });
  mobileStore.setLink('online');
  act(() => mobileStore.apply({ type: 'snapshot', sessions: [session()] }));
});
const prepares = () => sent.filter(m => m.type === 'decide.prepare');
const decides = () => sent.filter(m => m.type === 'session.decide');
const flush = () => act(async () => { await Promise.resolve(); });

describe('RiskConfirm', () => {
  it('asks for the challenge when it opens, and names the dialog after the consequence', async () => {
    render(<RiskConfirm item={item()} onClose={() => {}} />);
    expect(prepares()).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Confirmer : Peut remplacer l’historique distant' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Autoriser ce push forcé ?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmer avec mon appareil' })).toBeDisabled();
    act(() => mobileStore.apply(challenge()));
    await flush();
    expect(screen.getByRole('button', { name: 'Confirmer avec mon appareil' })).toBeEnabled();
  });
  it('the confirming tap calls startAuthentication before any await, then sends one decide with the assertion', async () => {
    const start = vi.fn(async () => assertion);
    const onClose = vi.fn();
    render(<RiskConfirm item={item()} onClose={onClose} startAuthentication={start as never} />);
    act(() => mobileStore.apply(challenge()));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer avec mon appareil' }));
    expect(start).toHaveBeenCalledTimes(1); // synchronously, nothing flushed yet
    expect(decides()).toHaveLength(0);
    await flush();
    expect(decides()).toHaveLength(1);
    expect(decides()[0]).toMatchObject({ decision: 'accept', pendingVersion: 1, assertion });
    expect(onClose).toHaveBeenCalled();
  });
  it('a cancelled device check says nothing was sent and the held challenge still works', async () => {
    const start = vi.fn().mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' })).mockResolvedValue(assertion);
    render(<RiskConfirm item={item()} onClose={() => {}} startAuthentication={start as never} />);
    act(() => mobileStore.apply(challenge()));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer avec mon appareil' }));
    await flush();
    expect(screen.getByText('Vérification annulée. Rien n’a été envoyé.')).toBeInTheDocument();
    expect(decides()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer avec mon appareil' }));
    await flush();
    expect(decides()).toHaveLength(1);
  });
  it('an expired held challenge is not used: a new one is fetched and another tap is required', async () => {
    const start = vi.fn(async () => assertion);
    render(<RiskConfirm item={item()} onClose={() => {}} startAuthentication={start as never} />);
    act(() => mobileStore.apply(challenge(new Date(Date.now() - 1000).toISOString())));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer avec mon appareil' }));
    await flush();
    expect(start).not.toHaveBeenCalled();
    expect(prepares()).toHaveLength(2);
    expect(screen.getByText('La vérification a expiré. Recommencez.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmer avec mon appareil' })).toBeDisabled();
    act(() => mobileStore.apply(challenge()));
    await flush();
    expect(screen.getByRole('button', { name: 'Confirmer avec mon appareil' })).toBeEnabled();
    expect(decides()).toHaveLength(0);
  });
  it('a refused prepare shows a message and offers a retry', async () => {
    render(<RiskConfirm item={item()} onClose={() => {}} />);
    act(() => mobileStore.apply({ type: 'error', id: 's', message: 'invalid' }));
    await flush();
    expect(screen.getByText('La vérification n’a pas pu être préparée. Rien n’a été envoyé.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(prepares()).toHaveLength(2);
  });
  it('closing sends nothing but the challenge request', () => {
    const onClose = vi.fn();
    render(<RiskConfirm item={item()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer la confirmation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revenir à la demande' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(decides()).toHaveLength(0);
  });
});

describe('a high-impact request in the detail', () => {
  it('shows the consequence and destination, then opens the confirmation from the danger button', () => {
    render(<RequestDetail sessionId="s" pendingId="p" onReconnect={() => {}} />);
    expect(screen.getByText('Peut remplacer l’historique distant')).toBeInTheDocument();
    expect(screen.getByText('origin/main')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier et autoriser' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(prepares()).toHaveLength(1);
    expect(decides()).toHaveLength(0);
  });
});

describe('a question in the detail', () => {
  const asQuestion = () => act(() => mobileStore.apply({ type: 'snapshot', sessions: [session({ kind: 'question', text: 'Quel thème ?', options: ['Sombre', 'Clair', 'Système'], risk: 'low', riskReason: 'question' }, 'low')] }));
  it('has no preselected option, sends nothing from a choice alone, and sends the option number on Send', () => {
    asQuestion();
    render(<RequestDetail sessionId="s" pendingId="p" onReconnect={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios.every(r => !(r as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('button', { name: 'Envoyer ma réponse' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Clair' }));
    expect(sent.filter(m => m.type === 'session.reply')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer ma réponse' }));
    const replies = sent.filter(m => m.type === 'session.reply');
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ id: 's', text: '2', pendingId: 'p', pendingVersion: 1 });
    expect(screen.queryByText('Autre réponse')).toBeNull();
  });
});

describe('RiskConfirm re-renders', () => {
  it('does not ask for a new challenge when the parent rebuilds an equal item', () => {
    const { rerender } = render(<RiskConfirm item={item()} onClose={() => {}} />);
    rerender(<RiskConfirm item={item()} onClose={() => {}} />);
    rerender(<RiskConfirm item={item()} onClose={() => {}} />);
    expect(prepares()).toHaveLength(1);
  });
});
