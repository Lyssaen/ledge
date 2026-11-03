import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DecidedBy, PhoneServerMessage } from '@ledge/protocol';
import { Gone } from '../../src/screens/Gone';
import { requestsOf } from '../../src/model/requests';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

const kai = session('a', { name: 'Kai', topic: 'Inbox', state: 'waiting_permission', pending: pending({ key: 'k1', text: 'pnpm build' }) });
const item = requestsOf([kai])[0]!;
const AT = '2026-11-03T19:41:00.000Z';
const time = new Date(AT).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** The store knows this device as `fp-self`, then the PC's thread of the session, its permission answered by `by`. */
function answered(by: DecidedBy | undefined, decision: 'accept' | 'deny' | 'unknown' = 'accept') {
  const t = setup();
  act(() => t.deliver({ ...snapshot([kai], 'PC-Desan'), device: { confirm: true, id: 'fp-self' } } as PhoneServerMessage));
  render(<Gone store={t.store} item={item} />);
  act(() => t.deliver({ type: 'session.thread', id: 'a', cut: [], more: false,
    items: [{ kind: 'permission', id: 'p1', at: AT, turn: 1, tool: 'Bash', text: 'pnpm build', decision, ...(by ? { by } : {}) }] } as PhoneServerMessage));
  return t;
}

describe('a request that no longer waits', () => {
  it('asks the session’s thread, and until it says who answered, says « ailleurs », with the way to its thread', () => {
    const t = setup();
    render(<Gone store={t.store} item={item} />);
    expect(t.of('session.thread')).toEqual([{ type: 'session.thread', id: 'a' }]);
    expect(screen.getByRole('heading', { name: 'Déjà traitée ailleurs' })).toBeInTheDocument();
    expect(screen.getByText('pnpm build')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir le fil de Kai' })).toHaveAttribute('href', '#/thread/a');
  });

  it('names another device that answered, by its name, and when', () => {
    answered({ kind: 'device', id: 'fp-ipad', name: 'iPad · Safari' });
    expect(screen.getByRole('heading', { name: 'Déjà traitée sur iPad · Safari' })).toBeInTheDocument();
    expect(screen.getByText(`Acceptée à ${time}. Aucune nouvelle décision n’a été envoyée.`)).toBeInTheDocument();
  });

  it('the PC, and this device (another tab of it)', () => {
    answered({ kind: 'pc' }, 'deny');
    expect(screen.getByRole('heading', { name: 'Déjà traitée sur le PC' })).toBeInTheDocument();
    expect(screen.getByText(`Refusée à ${time}. Aucune nouvelle décision n’a été envoyée.`)).toBeInTheDocument();
  });

  it('this device', () => {
    answered({ kind: 'device', id: 'fp-self', name: 'Android · Chrome' });
    expect(screen.getByRole('heading', { name: 'Déjà traitée sur cet appareil' })).toBeInTheDocument();
  });

  it('answered in the terminal: « ailleurs »', () => {
    answered(undefined, 'unknown');
    expect(screen.getByRole('heading', { name: 'Déjà traitée ailleurs' })).toBeInTheDocument();
  });

  it('the PC’s record of who answered this very request wins, a question included, and no thread is asked', () => {
    const q = session('b', { name: 'Nova', state: 'waiting_input', pending: pending({ kind: 'question', key: 'kq', text: 'Quel schéma ?' }) });
    const qItem = requestsOf([q])[0]!;
    const t = setup();
    const { pending: _, ...rest } = q;
    act(() => t.deliver({ ...snapshot([{ ...rest, state: 'working', lastAnswer: { key: qItem.key, by: { kind: 'device', id: 'fp-ipad', name: 'iPad' }, at: AT } }], 'PC-Desan'), device: { confirm: true, id: 'fp-self' } } as PhoneServerMessage));
    render(<Gone store={t.store} item={qItem} />);
    expect(screen.getByRole('heading', { name: 'Déjà traitée sur iPad' })).toBeInTheDocument();
    expect(screen.getByText(`Répondue à ${time}. Aucune nouvelle réponse n’a été envoyée.`)).toBeInTheDocument();
    expect(t.of('session.thread')).toEqual([]);
  });

  it('offline, says only that it is no longer in the last known state', () => {
    const t = setup('pc_offline');
    render(<Gone store={t.store} stale item={item} />);
    expect(screen.getByRole('heading', { name: 'Cette demande ne figure plus dans le dernier état connu.' })).toBeInTheDocument();
    expect(screen.queryByText(/Déjà traitée/)).not.toBeInTheDocument();
  });
});
