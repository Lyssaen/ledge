// Edge cases of « Fermer » / « Reprendre » added by the tester (task tc26198) on top of session-close.test.tsx.
// D1 to D4 were defects found in the delivery (task tc3f367 fixed them): each test states the expected behaviour (mockup mobile-session-close).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PhoneServerMessage, PhoneSession } from '@ledge/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAssertion, platformAvailable } from '../../src/link/webauthn';
import { Thread } from '../../src/screens/Thread';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(), createCredential: vi.fn(), getAssertion: vi.fn() }));

const assertion = { id: 'AQ', clientDataJSON: 'AQI', authenticatorData: 'Aw', signature: 'BAU' };
const challenge = (purpose: 'close' | 'act'): PhoneServerMessage => ({ type: 'confirm.challenge', purpose, challenge: 'Y2hhbGw', rpId: 'relay.example', credentialId: 'AQ', expiresInMs: 60_000 });
const EXITED = '2026-10-29T18:42:00.000Z';
/** An end `ms` after now: after this phone's close was sent, as a real one is (a close owns only such an end). */
const later = (ms = 1_000) => new Date(Date.now() + ms).toISOString();
/** The run a resume starts: the PC gives the session a new `startedAt`. */
const RESUMED = '2026-10-29T19:30:00.000Z';
const nova = (extra: Partial<PhoneSession> = {}) => session('a', { name: 'Nova', topic: 'Pagination de /invoices', repo: 'billing-api', ...extra });
const snap = (s: PhoneSession) => ({ ...snapshot([s]), daemon: { version: '0.29.0', name: 'PC', sessionClose: true as const }, device: { confirm: true } }) as PhoneServerMessage;

function opened(s: PhoneSession = nova()) {
  const t = setup();
  t.deliver(snap(s));
  render(<Thread store={t.store} sessionId="a" storage={t.storage} />);
  return t;
}
type T = ReturnType<typeof opened>;
const dialog = () => screen.getByRole('dialog');
async function sheetReady(t: T, purpose: 'close' | 'act' = 'close') {
  await waitFor(() => expect(t.of('confirm.prepare').length).toBeGreaterThan(0));
  act(() => t.deliver(challenge(purpose)));
  await waitFor(() => expect(screen.queryByText('Préparation de la vérification…')).not.toBeInTheDocument());
}
const result = (t: T, type: 'session.close' | 'session.resume', status: 'applied' | 'rejected' | 'failed', extra: object = {}) =>
  act(() => t.deliver({ type: 'operation.result', op: t.of(type).at(-1)!.op, status, ...extra } as PhoneServerMessage));
async function sendClose(t: T) {
  fireEvent.click(screen.getByRole('button', { name: 'Fermer Nova' }));
  await sheetReady(t);
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Fermer avec mon appareil' }));
  await waitFor(() => expect(t.of('session.close')).toHaveLength(1));
}

beforeEach(() => {
  vi.mocked(platformAvailable).mockResolvedValue(true);
  vi.mocked(getAssertion).mockReset();
  vi.mocked(getAssertion).mockResolvedValue(assertion);
  Object.defineProperty(globalThis.navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 15)', configurable: true });
});

describe('double send', () => {
  it('two quick taps on the sheet’s button send one close and ask the device once', async () => {
    const t = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Fermer Nova' }));
    await sheetReady(t);
    const go = within(dialog()).getByRole('button', { name: 'Fermer avec mon appareil' });
    fireEvent.click(go);
    fireEvent.click(go);
    await waitFor(() => expect(t.of('session.close')).toHaveLength(1));
    expect(getAssertion).toHaveBeenCalledTimes(1);
  });

  it('a close another phone already makes (« busy ») shows « Fermeture… », then the ended card once the session exits: never an error', async () => {
    const t = opened();
    await sendClose(t);
    result(t, 'session.close', 'rejected', { reason: 'busy' });
    expect(screen.getByText('Fermeture de Nova…')).toBeInTheDocument();
    act(() => t.deliver({ type: 'session.updated', session: nova({ state: 'exited', exitedAt: EXITED }) }));
    expect(screen.getByRole('heading', { name: 'Session terminée' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('the link lost after the send (uncertain)', () => {
  it('says « Fermeture non confirmée » with « Reconnecter », gives the composer back with its draft, and the same op goes again once the link is back', async () => {
    const onReconnect = vi.fn();
    const t = setup();
    t.deliver(snap(nova()));
    render(<Thread store={t.store} sessionId="a" storage={t.storage} onReconnect={onReconnect} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ajoute un test' } });
    await sendClose(t as T);
    const first = t.of('session.close')[0]!;
    act(() => t.set('pc_offline'));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Fermeture non confirmée')).toBeInTheDocument();
    fireEvent.click(within(alert).getByRole('button', { name: 'Reconnecter' }));
    expect(onReconnect).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox')).toHaveValue('Ajoute un test');
    // Back on the PC, which says the session is still running: the same op is sent again, as itself (the PC replays or applies it once).
    act(() => t.set('ready'));
    act(() => t.deliver(snap(nova())));
    await waitFor(() => expect(t.of('session.close').length).toBeGreaterThan(1));
    expect(t.of('session.close').every(m => m.op === first.op)).toBe(true);
  });
});

describe('an ended session the phone cannot resume', () => {
  // Mockup 3b: « Session démarrée hors de Ledge (readOnly) : ni texte de reprise ni bouton, seulement le titre ».
  it('D1 — a read-only ended session shows only the title, no « reprenez-la depuis le PC » text', () => {
    opened(nova({ state: 'exited', exitedAt: EXITED, readOnly: true }));
    expect(screen.getByRole('heading', { name: 'Session terminée' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reprendre Nova' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Sa conversation est gardée/)).not.toBeInTheDocument();
  });
});

describe('what this phone’s close keeps saying after the session moved on', () => {
  // The session was closed from this phone, then started again from the PC (the phone holds no resume op for it).
  it('D2 — a session resumed on the PC within a minute of this phone’s close does not read « Fermeture… » while it runs', async () => {
    const t = opened();
    await sendClose(t);
    result(t, 'session.close', 'applied', { how: 'exit' });
    act(() => t.deliver({ type: 'session.updated', session: nova({ state: 'exited', exitedAt: later() }) }));
    expect(screen.getByRole('heading', { name: 'Session terminée' })).toBeInTheDocument();
    act(() => t.deliver({ type: 'session.updated', session: nova({ state: 'idle', startedAt: RESUMED }) }));
    expect(screen.queryByText('Fermeture de Nova…')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('D3 — a later exit the agent made itself is not read as « fermée depuis le téléphone » (nor « de force »)', async () => {
    const t = opened();
    await sendClose(t);
    result(t, 'session.close', 'applied', { how: 'killed' });
    act(() => t.deliver({ type: 'session.updated', session: nova({ state: 'exited', exitedAt: later() }) }));
    // Resumed on the PC, then the agent quit by itself two hours later.
    act(() => t.deliver({ type: 'session.updated', session: nova({ state: 'idle', startedAt: RESUMED }) }));
    act(() => t.deliver({ type: 'session.updated', session: nova({ state: 'exited', exitedAt: later(7_200_000), startedAt: RESUMED }) }));
    expect(screen.queryByText(/Session fermée depuis le téléphone/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Fermée de force/)).not.toBeInTheDocument();
  });

  it('D4 — a session that exits again within a minute of this phone’s resume shows its ended card, not « Reprise… »', async () => {
    const t = opened(nova({ state: 'exited', exitedAt: EXITED }));
    fireEvent.click(screen.getByRole('button', { name: 'Reprendre Nova' }));
    await sheetReady(t, 'act');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reprendre avec mon appareil' }));
    await waitFor(() => expect(t.of('session.resume')).toHaveLength(1));
    result(t, 'session.resume', 'applied');
    act(() => t.deliver({ type: 'session.updated', session: nova({ state: 'idle', startedAt: RESUMED }) }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    // The agent crashed on start: it is exited again.
    act(() => t.deliver({ type: 'session.updated', session: nova({ state: 'exited', exitedAt: new Date().toISOString(), startedAt: RESUMED }) }));
    expect(screen.queryByText('Reprise de Nova…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reprendre Nova' })).toBeInTheDocument();
  });
});

describe('a close whose outcome is unknown (S1)', () => {
  it('holds « Fermer » while the close may still go again by itself: no second passkey for a close the phone would not send', async () => {
    const t = opened();
    await sendClose(t);
    act(() => t.set('pc_offline'));
    await screen.findByRole('alert');
    const held = screen.getByRole('button', { name: 'Fermeture de Nova en cours' });
    expect(held).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(held);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(getAssertion).toHaveBeenCalledTimes(1);
  });
});

describe('a close the PC says the session already ended (D5)', () => {
  it('shows the ended card, not the composer, before the session’s own update comes', async () => {
    const t = opened();
    await sendClose(t);
    result(t, 'session.close', 'rejected', { reason: 'ended' });
    expect(screen.getByRole('heading', { name: 'Session terminée' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
