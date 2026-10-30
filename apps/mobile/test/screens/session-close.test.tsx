import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PhoneServerMessage, PhoneSession } from '@ledge/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAssertion, platformAvailable } from '../../src/link/webauthn';
import { Agents } from '../../src/screens/Agents';
import { Thread } from '../../src/screens/Thread';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(), createCredential: vi.fn(), getAssertion: vi.fn() }));

const assertion = { id: 'AQ', clientDataJSON: 'AQI', authenticatorData: 'Aw', signature: 'BAU' };
const challenge = (purpose: 'close' | 'act'): PhoneServerMessage => ({ type: 'confirm.challenge', purpose, challenge: 'Y2hhbGw', rpId: 'relay.example', credentialId: 'AQ', expiresInMs: 60_000 });
const EXITED = '2026-10-29T18:42:00.000Z';

const nova = (extra: Partial<PhoneSession> = {}) => session('a', { name: 'Nova', topic: 'Pagination de /invoices', repo: 'billing-api', ...extra });
/** A PC that closes from a phone (unless `old`), with a protected device (unless `confirm` is false). */
const snap = (s: PhoneSession, o: { old?: true; confirm?: boolean } = {}) => ({
  ...snapshot([s]), daemon: { version: '0.29.0', name: 'PC', ...(o.old ? {} : { sessionClose: true as const }) }, device: { confirm: o.confirm ?? true }
}) as PhoneServerMessage;

function opened(s: PhoneSession = nova(), o: Parameters<typeof snap>[1] & { onReconnect?: () => void } = {}) {
  const t = setup();
  t.deliver(snap(s, o));
  const view = render(<Thread store={t.store} sessionId="a" storage={t.storage} {...(o.onReconnect ? { onReconnect: o.onReconnect } : {})} />);
  return { ...t, view };
}
const closeButton = () => screen.getByRole('button', { name: 'Fermer Nova' });
const dialog = () => screen.getByRole('dialog', { name: 'Fermer Nova ?' });
/** Opens the sheet and hands it the PC's challenge. */
async function sheetReady(t: ReturnType<typeof opened>, purpose: 'close' | 'act' = 'close') {
  await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
  act(() => t.deliver(challenge(purpose)));
  await waitFor(() => expect(screen.queryByText('Préparation de la vérification…')).not.toBeInTheDocument());
}
const result = (t: ReturnType<typeof opened>, type: 'session.close' | 'session.resume', status: 'applied' | 'rejected' | 'failed', extra: object = {}) =>
  act(() => t.deliver({ type: 'operation.result', op: t.of(type).at(-1)!.op, status, ...extra } as PhoneServerMessage));

beforeEach(() => {
  vi.mocked(platformAvailable).mockResolvedValue(true);
  vi.mocked(getAssertion).mockReset();
  Object.defineProperty(globalThis.navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 15)', configurable: true });
});

describe('« Fermer » on a session’s page', () => {
  it('is offered for a session Ledge launched, by a PC that closes from a phone, and named for the agent', () => {
    opened();
    expect(closeButton()).toHaveAttribute('title', 'Fermer Nova');
  });

  it('is not offered for a session started outside Ledge, an ended one, nor by an older PC', () => {
    for (const [s, o] of [[nova({ readOnly: true }), {}], [nova({ state: 'exited' }), {}], [nova(), { old: true as const }]] as const) {
      const t = opened(s, o);
      expect(screen.queryByRole('button', { name: 'Fermer Nova' })).not.toBeInTheDocument();
      t.view.unmount();
    }
  });

  it('is offered for a session in error: it is the way to clean it up', () => {
    opened(nova({ state: 'error' }));
    expect(closeButton()).toBeInTheDocument();
  });
});

describe('the close sheet', () => {
  it('on a session at rest says what happens, cuts nothing, and asks the challenge as it opens', async () => {
    const t = opened();
    fireEvent.click(closeButton());
    expect(dialog()).toHaveFocus();
    expect(within(dialog()).getByText(/Ledge quitte l’agent proprement, comme \/exit/)).toBeInTheDocument();
    expect(within(dialog()).queryByText('Ce que la fermeture coupe')).not.toBeInTheDocument();
    expect(within(dialog()).queryByText(/Si l’agent ne répond pas/)).not.toBeInTheDocument();
    expect(within(dialog()).getByText('Une vérification sur votre appareil sera demandée.')).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Préparation de la vérification…' })).toBeDisabled();
    await sheetReady(t);
    expect(t.of('confirm.prepare')).toEqual([{ type: 'confirm.prepare', purpose: 'close', id: 'a' }]);
    // The primary button first, then « Annuler ».
    expect(within(dialog()).getAllByRole('button').map(b => b.textContent)).toEqual(['Fermer avec mon appareil', 'Annuler']);
  });

  it('on a session with an accord waiting says its turn and its request, and that a stuck agent is forced', () => {
    opened(nova({ state: 'waiting_permission', pending: pending({ text: 'rm -rf build' }), helpers: [{ id: 'h1', kind: 'Explore', task: 't', state: 'working' }, { id: 'h2', kind: 'Explore', task: 't', state: 'working' }] }));
    fireEvent.click(closeButton());
    const cuts = within(dialog()).getByText('Ce que la fermeture coupe').parentElement!;
    expect(within(cuts).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Le tour en cours de Nova sera interrompu. Ce qui est déjà fait reste fait.', 'La demande en attente sera refusée.', '2 sous-agents s’arrêtent avec la session.']);
    expect(within(dialog()).getByText('Si l’agent ne répond pas, Ledge ferme son terminal de force. Une vérification sur votre appareil sera demandée.')).toBeInTheDocument();
  });

  it('says Face ID on an iPhone', async () => {
    Object.defineProperty(globalThis.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', configurable: true });
    const t = opened();
    fireEvent.click(closeButton());
    await sheetReady(t);
    expect(within(dialog()).getByRole('button', { name: 'Fermer avec Face ID' })).toBeEnabled();
  });

  it('Annuler, Escape, the dim and a cancelled check send nothing', async () => {
    const t = opened();
    fireEvent.click(closeButton());
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(closeButton());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(closeButton());
    fireEvent.click(document.querySelector('[aria-hidden="true"].bg-black\\/50')!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    vi.mocked(getAssertion).mockResolvedValue('cancelled');
    fireEvent.click(closeButton());
    await waitFor(() => expect(t.of('confirm.prepare').length).toBeGreaterThan(0));
    act(() => t.deliver(challenge('close')));
    fireEvent.click(await within(dialog()).findByRole('button', { name: 'Fermer avec mon appareil' }));
    expect(await within(dialog()).findByText('Vérification annulée. Rien n’a été envoyé.')).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Fermer avec mon appareil' })).toBeEnabled();
    expect(t.of('session.close')).toEqual([]);
  });

  it('offline, offers only to reconnect, and turns into the confirmation once the PC is back', async () => {
    const onReconnect = vi.fn();
    const t = opened(nova(), { onReconnect });
    t.set('pc_offline');
    fireEvent.click(closeButton());
    expect(within(dialog()).getByText('PC injoignable')).toBeInTheDocument();
    expect(within(dialog()).getByText('Reconnectez-vous pour fermer Nova. Rien n’a été envoyé.')).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reconnecter' }));
    expect(onReconnect).toHaveBeenCalledOnce();
    expect(t.of('confirm.prepare')).toEqual([]);
    t.set('ready');
    act(() => t.deliver(snap(nova())));
    await sheetReady(t);
    expect(within(dialog()).getByRole('button', { name: 'Fermer avec mon appareil' })).toBeEnabled();
    expect(t.of('session.close')).toEqual([]);
  });

  it('without a passkey, sends the way to Connexion and asks nothing', () => {
    const t = opened(nova(), { confirm: false });
    fireEvent.click(closeButton());
    expect(within(dialog()).getByText('Vérification impossible')).toBeInTheDocument();
    expect(within(dialog()).getByText('Protégez d’abord vos accords depuis Connexion. Vous pouvez aussi fermer Nova sur le PC.')).toBeInTheDocument();
    expect(within(dialog()).getByRole('link', { name: 'Ouvrir Connexion' })).toHaveAttribute('href', '#/connection');
    expect(t.of('confirm.prepare')).toEqual([]);
  });
});

describe('a close from the phone, as the page follows it', () => {
  it('sends the close with the assertion, follows it in the footer, then shows the session ended with its resume', async () => {
    vi.mocked(getAssertion).mockResolvedValue(assertion);
    const t = opened();
    fireEvent.click(closeButton());
    await sheetReady(t);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Fermer avec mon appareil' }));
    await waitFor(() => expect(t.of('session.close')).toHaveLength(1));
    expect(t.of('session.close')).toEqual([{ type: 'session.close', op: expect.any(String), id: 'a', assertion }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Under way: the footer says so and takes the focus; the button is held, a second close impossible.
    const footer = screen.getByText('Fermeture de Nova…').closest('footer')!;
    expect(footer).toHaveAttribute('role', 'status');
    await waitFor(() => expect(footer).toHaveFocus());
    expect(screen.getByText('L’agent termine ce qu’il tape, puis quitte. Cela peut prendre jusqu’à 30 s.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    const held = screen.getByRole('button', { name: 'Fermeture de Nova en cours' });
    expect(held).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(held);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // The PC forced it: the session ended, said so with the time it ended.
    act(() => t.deliver({ type: 'session.updated', session: nova({ state: 'exited', exitedAt: EXITED }) }));
    result(t, 'session.close', 'applied', { how: 'killed' });
    expect(screen.queryByRole('button', { name: /Fermer/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Session terminée' })).toBeInTheDocument();
    expect(screen.getByText('Fermée de force : l’agent ne répondait pas. Son dernier tour peut manquer.')).toBeInTheDocument();
    expect(screen.getByText('Sa conversation est gardée. Reprendre relance l’agent sur cette conversation, dans le même dossier.')).toBeInTheDocument();
    const time = new Date(EXITED).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    expect(screen.getByText(`Session fermée depuis le téléphone · ${time}`)).toBeInTheDocument();
    // The primary button, with the resume icon before its words.
    expect(screen.getByRole('button', { name: 'Reprendre Nova' }).firstElementChild?.tagName).toBe('svg');
  });

  it('a refusal of the PC says why above the composer, keeps the draft, and « Réessayer » opens the sheet again', async () => {
    vi.mocked(getAssertion).mockResolvedValue(assertion);
    const t = opened();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ajoute un test' } });
    fireEvent.click(closeButton());
    await sheetReady(t);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Fermer avec mon appareil' }));
    await waitFor(() => expect(t.of('session.close')).toHaveLength(1));
    result(t, 'session.close', 'failed');
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Nova n’a pas été fermée')).toBeInTheDocument();
    expect(within(alert).getByText('Le PC n’a pas pu arrêter l’agent. Vérifiez sur le PC, ou réessayez.')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Ajoute un test');
    fireEvent.click(within(alert).getByRole('button', { name: 'Réessayer' }));
    expect(dialog()).toBeInTheDocument();
    // The next gesture puts the error away.
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByText('Nova n’a pas été fermée')).not.toBeInTheDocument();
  });

  it('a session the PC says is read-only is closed on the PC: no retry', async () => {
    vi.mocked(getAssertion).mockResolvedValue(assertion);
    const t = opened();
    fireEvent.click(closeButton());
    await sheetReady(t);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Fermer avec mon appareil' }));
    await waitFor(() => expect(t.of('session.close')).toHaveLength(1));
    result(t, 'session.close', 'rejected', { reason: 'read_only' });
    expect(within(screen.getByRole('alert')).getByText('Elle a été démarrée hors de Ledge : fermez-la dans son terminal sur le PC.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
  });

  it('a close another window makes reads as under way, not as an error', async () => {
    vi.mocked(getAssertion).mockResolvedValue(assertion);
    const t = opened();
    fireEvent.click(closeButton());
    await sheetReady(t);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Fermer avec mon appareil' }));
    await waitFor(() => expect(t.of('session.close')).toHaveLength(1));
    result(t, 'session.close', 'rejected', { reason: 'busy' });
    expect(screen.getByText('Fermeture de Nova…')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('« Reprendre » an ended session', () => {
  it('confirms with the device, follows the resume, and gives the composer back once the agent runs', async () => {
    vi.mocked(getAssertion).mockResolvedValue(assertion);
    const t = opened(nova({ state: 'exited', exitedAt: EXITED }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reprendre Nova' }));
    const sheet = screen.getByRole('dialog', { name: 'Reprendre Nova ?' });
    expect(within(sheet).getByText('L’agent repart sur sa conversation, dans le même dossier et sur la même branche.')).toBeInTheDocument();
    await sheetReady(t, 'act');
    expect(t.of('confirm.prepare')).toEqual([{ type: 'confirm.prepare', purpose: 'act', id: 'a' }]);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reprendre avec mon appareil' }));
    await waitFor(() => expect(t.of('session.resume')).toEqual([{ type: 'session.resume', op: expect.any(String), id: 'a', assertion }]));
    expect(screen.getByText('Reprise de Nova…')).toBeInTheDocument();
    result(t, 'session.resume', 'applied');
    expect(screen.getByText('Reprise de Nova…')).toBeInTheDocument();
    act(() => t.deliver({ type: 'session.updated', session: nova({ state: 'idle' }) }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(closeButton()).toBeInTheDocument();
  });

  it('a session with no conversation says so over the ended card', async () => {
    vi.mocked(getAssertion).mockResolvedValue(assertion);
    const t = opened(nova({ state: 'exited' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reprendre Nova' }));
    await sheetReady(t, 'act');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reprendre avec mon appareil' }));
    await waitFor(() => expect(t.of('session.resume')).toHaveLength(1));
    result(t, 'session.resume', 'rejected', { reason: 'no_conversation' });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Nova n’a pas repris')).toBeInTheDocument();
    expect(within(alert).getByText('Aucune conversation à reprendre pour cette session.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Session terminée' })).toBeInTheDocument();
  });

  it('an older PC: the conversation is kept, resumed from the PC', () => {
    opened(nova({ state: 'exited' }), { old: true });
    expect(screen.getByText('Sa conversation est gardée : reprenez-la depuis le PC.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reprendre Nova' })).not.toBeInTheDocument();
  });
});

describe('the list while a session closes and once it ended', () => {
  it('says « Fermeture… » over the session’s state, then « Terminée » with when', () => {
    const t = setup();
    t.deliver(snap(nova({ state: 'working' })));
    render(<Agents store={t.store} />);
    expect(screen.getByText('Au travail')).toBeInTheDocument();
    act(() => { t.store.sessionClose('a', assertion); });
    expect(screen.getByText('Fermeture…')).toBeInTheDocument();
    expect(screen.queryByText('Au travail')).not.toBeInTheDocument();
    act(() => t.deliver({ type: 'session.updated', session: nova({ state: 'exited', exitedAt: new Date().toISOString() }) }));
    expect(screen.getByText('Terminée')).toBeInTheDocument();
    expect(screen.getByText(/^à \d\d:\d\d$/)).toBeInTheDocument();
    // Resuming is done from the session's page: the row is a link and nothing else.
    expect(screen.queryByRole('button', { name: /Reprendre/ })).not.toBeInTheDocument();
  });
});
