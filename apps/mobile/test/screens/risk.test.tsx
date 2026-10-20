import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAssertion, platformAvailable } from '../../src/link/webauthn';
import { RequestDetail } from '../../src/screens/RequestDetail';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(), createCredential: vi.fn(), getAssertion: vi.fn() }));

function opened(p = pending()) {
  const t = setup();
  t.deliver(snapshot([session('a', { name: 'Kai', topic: 'Publication', repo: 'ledge-site', branch: 'main', state: 'waiting_permission', pending: p })]));
  render(<RequestDetail store={t.store} sessionId="a" requestKey={p.key} />);
  return t;
}

beforeEach(() => { vi.mocked(platformAvailable).mockResolvedValue(true); });

describe('a high-impact request', () => {
  it('is accepted on the PC only: the accept button gives way, refusing stays possible', () => {
    const t = opened(pending({ text: 'git push --force origin main', risk: 'high', riskReason: 'pushes' }));
    expect(screen.getByText('Peut remplacer l’historique distant')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Autoriser/ })).not.toBeInTheDocument();
    expect(screen.getByText('À accepter sur le PC')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refuser' }));
    expect(t.of('session.decide')).toMatchObject([{ decision: 'deny' }]);
  });

  it('a PC asking for its own confirmation says the same', () => {
    const t = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Autoriser une fois' }));
    act(() => t.deliver({ type: 'operation.result', op: t.of('session.decide')[0]!.op, status: 'rejected', reason: 'confirm_required' }));
    expect(screen.getByText('À accepter sur le PC')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Autoriser/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refuser' })).toBeEnabled();
  });
});

const assertion = { id: 'AQ', clientDataJSON: 'AQI', authenticatorData: 'Aw', signature: 'BAU' };
const challenge = { type: 'confirm.challenge' as const, purpose: 'decide' as const, challenge: 'Y2hhbGw', rpId: 'relay.example', credentialId: 'AQ', expiresInMs: 60_000 };
const force = () => pending({ text: 'git push --force origin main', risk: 'high', riskReason: 'pushes' });

/** A high-impact request on a PC that checks the device, the challenge delivered unless told otherwise. */
async function guarded(opts: { challenge?: boolean; device?: { confirm: boolean } | null } = {}) {
  const p = force();
  const t = setup();
  t.deliver({ ...snapshot([session('a', { name: 'Kai', state: 'waiting_permission', pending: p })]), ...(opts.device === null ? {} : { device: opts.device ?? { confirm: true } }) } as never);
  render(<RequestDetail store={t.store} sessionId="a" requestKey={p.key} />);
  if (opts.challenge !== false) {
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    act(() => t.deliver(challenge));
  }
  return t;
}

describe('a high-impact request with a device check', () => {
  beforeEach(() => {
    vi.mocked(platformAvailable).mockResolvedValue(true);
    vi.mocked(getAssertion).mockReset();
    Object.defineProperty(globalThis.navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 15)', configurable: true });
  });

  it('asks the challenge when the card opens, and a tap signs it and sends the accept with its assertion', async () => {
    vi.mocked(getAssertion).mockResolvedValue(assertion);
    const t = await guarded();
    expect(t.of('confirm.prepare')).toMatchObject([{ purpose: 'decide', id: 'a', expect: { text: 'git push --force origin main', kind: 'permission' } }]);
    expect(screen.getByRole('heading', { name: 'Confirmer l’autorisation' })).toBeInTheDocument();
    expect(screen.getByText(/Une vérification sur votre appareil sera demandée/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer avec mon appareil' }));
    await waitFor(() => expect(t.of('session.decide')).toHaveLength(1));
    expect(getAssertion).toHaveBeenCalledWith({ challenge: 'Y2hhbGw', rpId: 'relay.example', credentialId: 'AQ' });
    expect(t.of('session.decide')).toMatchObject([{ decision: 'accept', assertion }]);
  });

  it('refusing never asks the device', async () => {
    const t = await guarded();
    fireEvent.click(screen.getByRole('button', { name: 'Refuser' }));
    expect(t.of('session.decide')).toMatchObject([{ decision: 'deny' }]);
    expect(t.of('session.decide')[0]).not.toHaveProperty('assertion');
    expect(getAssertion).not.toHaveBeenCalled();
  });

  it('a cancelled verification says nothing was sent and creates no operation', async () => {
    vi.mocked(getAssertion).mockResolvedValue('cancelled');
    const t = await guarded();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer avec mon appareil' }));
    expect(await screen.findByText('Vérification annulée. Rien n’a été envoyé.')).toBeInTheDocument();
    expect(t.of('session.decide')).toEqual([]);
    expect(screen.getByRole('button', { name: 'Confirmer avec mon appareil' })).toBeEnabled();
  });

  it('an expired assertion says so, and « Réessayer » asks a new challenge', async () => {
    vi.mocked(getAssertion).mockResolvedValue(assertion);
    const t = await guarded();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer avec mon appareil' }));
    await waitFor(() => expect(t.of('session.decide')).toHaveLength(1));
    act(() => t.deliver({ type: 'operation.result', op: t.of('session.decide')[0]!.op, status: 'rejected', reason: 'assertion_expired' }));
    expect(await screen.findByText('La vérification a expiré. Recommencez.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(2));
    act(() => t.deliver(challenge));
    expect(await screen.findByRole('button', { name: 'Confirmer avec mon appareil' })).toBeEnabled();
  });

  it.each(['assertion_invalid', 'confirm_required'] as const)('%s says the verification failed, with « Réessayer »', async (reason) => {
    vi.mocked(getAssertion).mockResolvedValue(assertion);
    const t = await guarded();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer avec mon appareil' }));
    await waitFor(() => expect(t.of('session.decide')).toHaveLength(1));
    act(() => t.deliver({ type: 'operation.result', op: t.of('session.decide')[0]!.op, status: 'rejected', reason }));
    expect(await screen.findByText('La vérification de l’appareil n’a pas abouti. Rien n’a été envoyé. Réessayez.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('without device (a lot 5 daemon), or without a platform authenticator, the accept stays on the PC', async () => {
    await guarded({ device: null, challenge: false });
    expect(screen.getByText('À accepter sur le PC')).toBeInTheDocument();
  });

  it('no platform authenticator → on the PC', async () => {
    vi.mocked(platformAvailable).mockResolvedValue(false);
    const t = await guarded({ challenge: false });
    expect(screen.getByText('À accepter sur le PC')).toBeInTheDocument();
    expect(t.of('confirm.prepare')).toEqual([]);
  });

  it('a device without a credential yet keeps the accept on the PC', async () => {
    await guarded({ device: { confirm: false }, challenge: false });
    expect(screen.getByText('À accepter sur le PC')).toBeInTheDocument();
  });

  it('an iPhone is offered Face ID', async () => {
    Object.defineProperty(globalThis.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', configurable: true });
    await guarded();
    expect(await screen.findByRole('button', { name: 'Autoriser avec Face ID' })).toBeInTheDocument();
  });

  it('the challenge arriving after the tap: the button waits, disabled, then the next tap works', async () => {
    vi.mocked(getAssertion).mockResolvedValue(assertion);
    const t = await guarded({ challenge: false });
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    const wait = screen.getByRole('button', { name: 'Préparation de la vérification…' });
    expect(wait).toBeDisabled();
    fireEvent.click(wait);
    expect(getAssertion).not.toHaveBeenCalled();
    act(() => t.deliver(challenge));
    const go = await screen.findByRole('button', { name: 'Confirmer avec mon appareil' });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(t.of('session.decide')).toHaveLength(1));
  });

  it('a challenge that cannot be prepared says so, with « Réessayer »', async () => {
    const t = await guarded({ challenge: false });
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    act(() => t.deliver({ type: 'error', code: 'invalid' }));
    expect(await screen.findByText('La vérification n’a pas pu être préparée. Rien n’a été envoyé.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(2));
  });
});
