import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhoneChatTurn } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { getAssertion } from '../../src/link/webauthn';
import { Chat } from '../../src/screens/Chat';
import { session } from '../model/fixtures';
import { chat, snapshot } from '../state/helpers';
import { setup } from './setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(), createCredential: vi.fn(), getAssertion: vi.fn() }));

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

describe('names in an answer', () => {
  it('does not link a name held by two sessions', () => {
    const t = setup();
    t.deliver(snapshot([session('a', { name: 'Bix' }), session('b', { name: 'Bix' }), session('c', { name: 'Nova' })], 'Atelier', undefined, { confirm: true, chat: true }));
    t.deliver(chat.history(chat.turn(QID, { answer: 'Bix et Nova.', answeredAt: '2026-10-20T10:00:05.000Z' })));
    render(<Chat store={t.store} />);
    expect(screen.queryByRole('link', { name: 'Bix' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Nova' })).toBeInTheDocument();
  });

  it('links whole words only', () => {
    open({ answer: 'Bixby, puis Bix.' });
    expect(screen.getAllByRole('link', { name: 'Bix' })).toHaveLength(1);
    expect(screen.getByText(/Bixby/)).toBeInTheDocument();
  });

  it('matches a name with regex characters literally', () => {
    const t = setup();
    t.deliver(snapshot([session('a', { name: 'a.b' }), session('b', { name: 'C++' })], 'Atelier', undefined, { confirm: true, chat: true }));
    t.deliver(chat.history(chat.turn(QID, { answer: 'a.b, aXb et C++ ici.', answeredAt: '2026-10-20T10:00:05.000Z' })));
    render(<Chat store={t.store} />);
    expect(screen.getByRole('link', { name: 'a.b' })).toHaveAttribute('href', '#/thread/a');
    expect(screen.getByRole('link', { name: 'C++' })).toHaveAttribute('href', '#/thread/b');
    expect(screen.getAllByRole('link').filter(l => /thread/.test(l.getAttribute('href') ?? ''))).toHaveLength(2);
  });

  it('leaves a name inside a code span as text', () => {
    open({ answer: 'Voir `Bix` ici.' });
    expect(screen.queryByRole('link', { name: 'Bix' })).toBeNull();
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
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ignorer' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(spy).toHaveBeenCalledTimes(1);
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

const closes = [
  { id: 'a', name: 'Bix', tool: 'claude' as const },
  { id: 'b', name: 'Nova', tool: 'codex' as const }
];

describe('the close card', () => {
  it('shows one close row per session with its live state', () => {
    const t = setup();
    t.deliver(snapshot([session('a', { name: 'Bix' }), session('b', { name: 'Nova' }), session('c', { name: 'Kai' }), session('d', { name: 'Zed' }), session('e', { name: 'Ina', state: 'exited' })], 'Atelier', undefined, { confirm: true, chat: true }));
    t.deliver(chat.history(chat.turn(QID, {
      answer: 'Fini.', answeredAt: '2026-10-20T10:00:05.000Z',
      closes: [
        { id: 'a', name: 'Bix', tool: 'claude', how: 'exit', closedAt: '2026-10-20T10:00:06.000Z' },
        { id: 'b', name: 'Nova', tool: 'codex', how: 'killed', closedAt: '2026-10-20T10:00:06.000Z' },
        { id: 'c', name: 'Kai', tool: 'claude', failed: true },
        { id: 'd', name: 'Zed', tool: 'claude' },
        { id: 'e', name: 'Ina', tool: 'claude' },
        { id: 'gone', name: 'Rex', tool: 'claude' }
      ]
    })));
    render(<Chat store={t.store} />);
    const card = screen.getByRole('region', { name: copy.chat.closeLabel });
    const rows = within(card).getAllByRole('listitem');
    expect(rows.map(r => r.textContent)).toEqual([
      `Bix · Claude Code${copy.chat.closed}`, `Nova · Codex${copy.chat.killed}`, `Kai · Claude Code${copy.chat.closeFailed}${copy.chat.closeRow}`,
      `Zed · Claude Code${copy.chat.closeRow}`, `Ina · Claude Code${copy.chat.ended}`, `Rex · Claude Code${copy.chat.ended}`
    ]);
    expect(within(card).getAllByRole('button', { name: copy.chat.closeRow })).toHaveLength(2);
    // Two rows are open (the failed one retries): the group button counts them, the ended ones are left out.
    expect(within(card).getByRole('button', { name: copy.chat.closeAll(2) })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: copy.chat.launchLabel })).toBeNull();
  });

  it('Fermer tout sends only the open rows', async () => {
    const t = open({ closes: [{ ...closes[0]!, closedAt: '2026-10-20T10:00:06.000Z', how: 'exit' }, closes[1]!, { id: 'a', name: 'Bix', tool: 'claude' }, { id: 'b', name: 'Nova', tool: 'codex' }] });
    const spy = vi.spyOn(t.store, 'closeSessions').mockResolvedValue({ status: 'applied' });
    fireEvent.click(screen.getByRole('button', { name: copy.chat.closeAll(3) }));
    expect(spy).toHaveBeenCalledWith(QID, [1, 2, 3]);
  });

  it('a refused close marks the sent rows failed, and a retry clears the mark', async () => {
    const t = open({ closes });
    const spy = vi.spyOn(t.store, 'closeSessions').mockResolvedValueOnce({ status: 'rejected', reason: 'invalid' });
    fireEvent.click(screen.getAllByRole('button', { name: copy.chat.closeRow })[0]!);
    expect(await screen.findByText(copy.chat.closeFailed)).toBeInTheDocument();
    expect(screen.getAllByText(copy.chat.closeFailed)).toHaveLength(1);
    let release!: (r: { status: 'cancelled' }) => void;
    spy.mockReturnValueOnce(new Promise(r => { release = r; }));
    fireEvent.click(screen.getAllByRole('button', { name: copy.chat.closeRow })[0]!);
    await waitFor(() => expect(screen.queryByText(copy.chat.closeFailed)).toBeNull());
    release({ status: 'cancelled' });
  });

  it('a row button closes that row alone', () => {
    const t = open({ closes });
    const spy = vi.spyOn(t.store, 'closeSessions').mockResolvedValue({ status: 'cancelled' });
    fireEvent.click(screen.getAllByRole('button', { name: copy.chat.closeRow })[1]!);
    expect(spy).toHaveBeenCalledWith(QID, [1]);
  });

  it('holds the close card while a close or a launch of the turn is live', async () => {
    const t = open({ closes });
    vi.mocked(getAssertion).mockResolvedValue({ id: 'a', clientDataJSON: 'b', authenticatorData: 'c', signature: 'd' });
    // A close of row 0 is under way: its row reads « Fermeture… », and every button is held.
    void t.store.closeSessions(QID, [0]);
    t.deliver({ type: 'confirm.challenge', purpose: 'close', challenge: 'Y2g', rpId: 'pc.local', credentialId: 'Y3I', expiresInMs: 60_000 });
    expect(await screen.findByText(copy.chat.closing)).toBeInTheDocument();
    for (const b of within(screen.getByRole('region', { name: copy.chat.closeLabel })).getAllByRole('button')) expect(b).toBeDisabled();
    // Once final, it lets go: « Fermeture… » only ever comes from the live operation.
    const [sent] = t.of('chat.close');
    t.deliver({ type: 'operation.result', op: sent!.op, status: 'failed' });
    await waitFor(() => expect(screen.queryByText(copy.chat.closing)).toBeNull());
    expect(screen.getAllByRole('button', { name: copy.chat.closeRow })[0]).toBeEnabled();
    // A relay of the same turn holds it as well.
    void t.store.relay(QID);
    await waitFor(() => expect(screen.getAllByRole('button', { name: copy.chat.closeRow })[0]).toBeDisabled());
  });

  it('without a passkey, points to Connexion and disables the buttons', () => {
    open({ closes }, false);
    expect(screen.getByRole('link', { name: 'Connexion' })).toHaveAttribute('href', '#/connection');
    for (const b of within(screen.getByRole('region', { name: copy.chat.closeLabel })).getAllByRole('button')) expect(b).toBeDisabled();
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
    await waitFor(() => expect(go[1]).toBeDisabled());
    fireEvent.click(go[1]!);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(go[0]).toBeEnabled();
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
    expect(screen.getByText(copy.confirm.cancelled)).not.toHaveClass('text-danger-fg');
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
