import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhoneChatTurn } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { Chat } from '../../src/screens/Chat';
import { session } from '../model/fixtures';
import { chat, snapshot } from '../state/helpers';
import { setup } from './setup';

const QID = '0b1e8f7a-4c1d-4a55-9d0e-2f3a4b5c6d7e';
const UA = Object.getOwnPropertyDescriptor(globalThis.navigator, 'userAgent') ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(globalThis.navigator), 'userAgent');
afterEach(() => { if (UA) Object.defineProperty(globalThis.navigator, 'userAgent', UA); });

function open(turn: Partial<PhoneChatTurn>, confirm = true) {
  const t = setup();
  t.deliver(snapshot([session('a', { name: 'Bix', repo: 'ledge' }), session('b', { name: 'Nova', repo: 'relay' })], 'Atelier', undefined, { confirm, chat: true }));
  t.deliver(chat.history(chat.turn(QID, { answer: 'Fini.', answeredAt: '2026-10-20T10:00:05.000Z', ...turn })));
  render(<Chat store={t.store} />);
  return t;
}
const proposals = [{ project: 'ledge', tool: 'claude' as const, prompt: 'Lance les tests' }, { project: 'relay', tool: 'codex' as const, prompt: 'Corrige le build' }];

describe('the answer', () => {
  it('links a session of the snapshot and leaves an unknown name as text', () => {
    open({ answer: 'Bix attend, Kai aussi.' });
    expect(screen.getByRole('link', { name: 'Bix' })).toHaveAttribute('href', '#/thread/a');
    expect(screen.queryByRole('link', { name: 'Kai' })).toBeNull();
    expect(screen.getByText(/Kai aussi/)).toBeInTheDocument();
  });

  it('reads Markdown', () => {
    open({ answer: 'Un **point** clé.' });
    expect(screen.getByText('point').tagName).toBe('STRONG');
  });

  it('lists the sessions read in « Sources : », linked', () => {
    open({ steps: [{ kind: 'pane', name: 'Nova' }, { kind: 'sessions' }] });
    expect(screen.getByText(/Sources/).textContent).toBe('Sources : Nova');
    expect(screen.getAllByRole('link', { name: 'Nova' })[0]).toHaveAttribute('href', '#/thread/b');
  });
});

describe('the instruction card', () => {
  const relay = { id: 'b', name: 'Nova', tool: 'claude' as const, text: 'Rebase sur main' };

  it('sends on « Envoyer »', async () => {
    const t = open({ relay });
    const spy = vi.spyOn(t.store, 'relay').mockResolvedValue({ status: 'applied' });
    expect(screen.getByRole('region', { name: 'Consigne proposée' })).toHaveTextContent('Envoyer à Nova · relay');
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(spy).toHaveBeenCalledWith(QID);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Envoyer' })).toBeEnabled());
  });

  it('says « Pas envoyé. » when the send fails', async () => {
    const t = open({ relay });
    vi.spyOn(t.store, 'relay').mockResolvedValue({ status: 'rejected', reason: 'invalid' });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(await screen.findByText('Pas envoyé.')).toBeInTheDocument();
  });

  it('shows what became of it: sent with the thread link, or queued', () => {
    open({ relay: { ...relay, status: 'sent' } });
    expect(screen.getByText(/Envoyé à Nova ·/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'voir son fil' })).toHaveAttribute('href', '#/thread/b');
    expect(screen.queryByRole('button', { name: 'Envoyer' })).toBeNull();
  });

  it('queued says the session is busy', () => {
    open({ relay: { ...relay, status: 'queued' } });
    expect(screen.getByText('En attente : Nova est occupé.')).toBeInTheDocument();
  });

  it('« Ignorer » hides the card and sends nothing', () => {
    const t = open({ relay });
    const spy = vi.spyOn(t.store, 'relay');
    fireEvent.click(screen.getByRole('button', { name: 'Ignorer' }));
    expect(screen.queryByRole('region', { name: 'Consigne proposée' })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the launch cards', () => {
  it('has a card and a button per proposal, the second launching row 1', async () => {
    const t = open({ proposals });
    const spy = vi.spyOn(t.store, 'launch').mockResolvedValue({ status: 'applied' });
    expect(screen.getAllByRole('region', { name: 'Session proposée' })).toHaveLength(2);
    expect(screen.getByText('Lancer Claude Code dans ledge')).toBeInTheDocument();
    const go = screen.getAllByRole('button', { name: copy.confirm.go });
    expect(go).toHaveLength(2);
    fireEvent.click(go[1]!);
    expect(spy).toHaveBeenCalledWith(QID, [1]);
    await waitFor(() => expect(go[1]).toBeEnabled());
  });

  it('says the Face ID text on an iPhone', () => {
    Object.defineProperty(globalThis.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', configurable: true });
    open({ proposals });
    expect(screen.getAllByRole('button', { name: copy.confirm.goApple })).toHaveLength(2);
  });

  it('a cancelled check says so and the card stays proposed', async () => {
    const t = open({ proposals });
    vi.spyOn(t.store, 'launch').mockResolvedValue({ status: 'cancelled' });
    fireEvent.click(screen.getAllByRole('button', { name: copy.confirm.go })[0]!);
    expect(await screen.findByText(copy.confirm.cancelled)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: copy.confirm.go })).toHaveLength(2);
  });

  it('shows launched with the thread link, and failed', () => {
    open({ proposals: [{ ...proposals[0]!, launchedId: 'a' }, { ...proposals[1]!, failed: true }] });
    expect(screen.getByRole('link', { name: 'voir son fil' })).toHaveAttribute('href', '#/thread/a');
    expect(screen.getByText('Pas lancée.')).toBeInTheDocument();
  });

  it('without a credential, points to Connexion and disables the button', () => {
    open({ proposals: [proposals[0]!] }, false);
    expect(screen.getByText(/Protégez d'abord vos accords depuis Connexion\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connexion' })).toHaveAttribute('href', '#/connection');
    expect(screen.getByRole('button', { name: copy.confirm.go })).toBeDisabled();
  });
});
