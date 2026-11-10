import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateIdentity } from '@ledge/seal';
import { createCredential, platformAvailable } from '../../src/link/webauthn';
import type { PinnedPc } from '../../src/link/keys';
import type { RecoveryState } from '../../src/link/recover';
import { snapshot } from '../state/helpers';
import { app } from './app-setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(async () => true), createCredential: vi.fn(), getAssertion: vi.fn(), getDiscoverable: vi.fn() }));

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
beforeEach(() => { vi.mocked(platformAvailable).mockResolvedValue(true); vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

const pc: PinnedPc = { publicKey: 'K', fingerprint: 'abcdEFGHijklMNOPqrstuv', name: 'WSL', pinnedAt: '2026-10-16T08:00:00.000Z' };
const failed = (why: Extract<RecoveryState, { step: 'failed' }>['why'], extra: object = {}): RecoveryState => ({ step: 'failed', why, pcName: 'WSL', ...extra });
const buttons = () => screen.getAllByRole('button').map(b => b.textContent);

describe('the app without a key (passkey-reinstall.html, 1 a)', () => {
  it('offers the passkey first, with its three notes, then the code', async () => {
    const t = app('unpaired');
    expect(screen.getByRole('heading', { name: 'Relier cet iPhone' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Se reconnecter avec ma passkey' })).toBeInTheDocument();
    expect(screen.getByText('Ta passkey est restée dans le trousseau iCloud, même si l’app a été supprimée.')).toBeInTheDocument();
    expect(buttons()).toEqual(['Se reconnecter avec ma passkey', 'Appairer avec un code']);
    fireEvent.click(screen.getByRole('button', { name: 'Se reconnecter avec ma passkey' }));
    expect(t.calls).toEqual(['startRecovery']);
  });

  it('offers only the code, without the notes, on a device that cannot verify its user (P4)', async () => {
    vi.mocked(platformAvailable).mockResolvedValue(false);
    app('unpaired');
    await waitFor(() => expect(buttons()).toEqual(['Appairer avec un code']));
    expect(screen.queryByText(/trousseau iCloud/)).not.toBeInTheDocument();
    expect(screen.getByText('Tu as déjà utilisé Ledge sur cet appareil ? Ta passkey peut le reconnecter à ton PC, sans code.')).toBeInTheDocument();
  });

  it('names a passkey manager, not iCloud, on a device that is not an iPhone or an iPad (P16)', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36');
    app('unpaired');
    expect(await screen.findByText('Ta passkey est restée dans ton gestionnaire de passkeys, même si l’app a été supprimée.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Relier cet appareil' })).toBeInTheDocument();
    expect(screen.queryByText(/trousseau iCloud/)).not.toBeInTheDocument();
  });
});

describe('the recovery under way and back (1 c, 1 d)', () => {
  it('says each step, and « Annuler » gives up', () => {
    const t = app('pairing');
    act(() => t.setRecovery({ step: 'reaching' }));
    const steps = () => within(screen.getByRole('list')).getAllByRole('listitem').map(li => li.textContent);
    expect(screen.getByRole('heading', { name: 'Vérification de ta passkey' })).toBeInTheDocument();
    expect(steps()).toEqual(['Connexion à ton PC…', 'Face ID', 'Ton PC vérifie la passkey…']);
    act(() => t.setRecovery({ step: 'checking', pcName: 'WSL' }));
    expect(steps()).toEqual(['WSL joint', 'Face ID', 'WSL vérifie la passkey…']);
    expect(screen.getByText('WSL vérifie que cette passkey est celle d’un de ses appareils.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(t.calls).toContain('cancelRecovery');
  });

  it('back: « iPhone reconnecté à WSL », what WSL kept, then the notifications step', () => {
    const t = app('pairing');
    act(() => { t.setRecovery({ step: 'done', pc, name: 'iPhone' }); t.setPinned(pc); t.set('ready'); });
    expect(screen.getByRole('heading', { name: 'iPhone reconnecté à WSL' })).toBeInTheDocument();
    expect(screen.getByText(/WSL a gardé le nom de cet appareil/)).toBeInTheDocument();
    expect(screen.getByText('WSL affiche cette reconnexion et peut révoquer l’appareil.')).toBeInTheDocument();
    expect(screen.getByText('La réinstallation a coupé les notifications. Réactive-les pour ouvrir une demande depuis ton écran verrouillé.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Plus tard' }));
    expect(screen.getByRole('heading', { name: 'À toi' })).toBeInTheDocument();
  });
});

describe('each way a recovery stops (2 a–i)', () => {
  const cases: Array<[string, RecoveryState, string, string, (string | null)[]]> = [
    ['none', failed('none'), 'Aucune passkey n’a été utilisée', 'Première fois sur cet appareil ?', ['Réessayer', 'Appairer avec un code']],
    ['revoked', failed('revoked', { revokedAt: '2026-11-03T10:00:00.000Z' }), 'Cet iPhone a été révoqué', 'révoqué dans Ledge sur WSL le 3 nov. Sa passkey', ['Appairer avec un code']],
    ['revoked, no date', failed('revoked'), 'Cet iPhone a été révoqué', 'Il a été révoqué dans Ledge sur WSL. Sa passkey n’ouvre plus rien.', ['Appairer avec un code']],
    ['old', failed('old'), 'Ta passkey est trop ancienne', 'Une dernière fois avec un code.', ['Appairer avec un code']],
    ['offline', { step: 'failed', why: 'offline', pcName: null }, 'Ton PC est hors ligne', 'Ouvre Ledge sur ton PC et active l’accès mobile : la reconnexion reprend dès qu’il est en ligne.', ['Réessayer', 'Annuler']],
    ['otherPc', failed('otherPc', { tags: ['7F3A 91C2', 'D044 18EB'] }), 'Cette passkey n’est pas celle de WSL', '7F3A 91C2 · PC attendu', ['Appairer avec un code', 'Se déconnecter']],
    ['connected', failed('connected', { device: 'iPad' }), 'Cette passkey est celle de l’iPad, connecté en ce moment', 'Ferme Ledge dans Safari sur l’iPad, puis réessaie.', ['Appairer avec un code', 'Réessayer']],
    ['connected, a name it was given (P17)', failed('connected', { device: 'Tablette salon' }), 'Cette passkey est celle de l’appareil « Tablette salon », connecté en ce moment', 'Ferme Ledge dans Safari sur l’appareil « Tablette salon », puis réessaie.', ['Appairer avec un code', 'Réessayer']],
    ['connected, no model (P17)', failed('connected', { device: 'Android' }), 'Cette passkey est celle de l’appareil, connecté en ce moment', 'Tu as réinstallé l’appareil ?', ['Appairer avec un code', 'Réessayer']],
    ['rate', failed('rate', { retryInMs: 2_500_000 }), 'Trop d’essais', '5 reconnexions en une heure : WSL en refuse d’autres pour l’instant. Réessaie dans 42 min, ou appaire avec un code.', ['Appairer avec un code', 'Réessayer dans 42 min']],
    ['blocked', failed('blocked'), 'Reconnexion bloquée sur WSL', 'Débloquer', ['Appairer avec un code']],
    ['timeout', failed('timeout'), 'WSL n’a pas répondu', 'La vérification n’a pas abouti à temps. Rien n’a été enregistré sur cet appareil.', ['Réessayer', 'Appairer avec un code']]
  ];
  for (const [name, state, title, text, actions] of cases) {
    it(`${name}: « ${title} »`, () => {
      const t = app('unpaired');
      act(() => t.setRecovery(state));
      expect(within(screen.getByRole('alert')).getByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
      expect(buttons()).toEqual(actions);
    });
  }

  it('« Annuler » on the PC-offline screen goes back to the choice', () => {
    const t = app('unpaired');
    act(() => t.setRecovery({ step: 'failed', why: 'offline', pcName: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(t.calls).toEqual(['cancelRecovery']);
    expect(screen.getByRole('heading', { name: 'Relier cet iPhone' })).toBeInTheDocument();
  });

  it('the PC took the device back but its key could not be kept (2 j): said under the account, with « Réessayer » and the code', async () => {
    const t = app('unpaired');
    act(() => t.setRecovery(failed('unsaved')));
    expect(within(screen.getByRole('alert')).getByRole('heading', { name: 'Reconnexion non enregistrée' })).toBeInTheDocument();
    expect(screen.getByText('WSL a accepté ta passkey, mais cet iPhone n’a pas pu enregistrer la clé de WSL : son stockage est peut-être plein. Rien n’est encore relié.')).toBeInTheDocument();
    expect(await screen.findByText('@paradow')).toBeInTheDocument();
    expect(buttons()).toEqual(['Réessayer', 'Appairer avec un code']);
    // The mockup's lead button is the red one (`.btn.primary`), in both themes; the other way stays outlined.
    expect(screen.getByRole('button', { name: 'Réessayer' })).toHaveClass('bg-primary');
    expect(screen.getByRole('button', { name: 'Appairer avec un code' })).not.toHaveClass('bg-primary');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(t.calls.at(-1)).toBe('startRecovery');
  });

  it('a failure whose only way out is the code leads with it, in red', () => {
    const t = app('unpaired');
    act(() => t.setRecovery(failed('revoked')));
    expect(screen.getByRole('button', { name: 'Appairer avec un code' })).toHaveClass('bg-primary');
  });

  it('« Réessayer » after Face ID was cancelled opens the sheet again on the same offer', () => {
    const t = app('unpaired');
    act(() => t.setRecovery(failed('none')));
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(t.calls).toEqual(['again']);
  });

  it('the rate screen without a delay says « plus tard » and offers no disabled button', () => {
    const t = app('unpaired');
    act(() => t.setRecovery(failed('rate')));
    expect(screen.getByText(/Réessaie plus tard, ou appaire avec un code/)).toBeInTheDocument();
    expect(buttons()).toEqual(['Appairer avec un code']);
  });

  it('a relay out of reach says Compare\'s words', () => {
    const t = app('unpaired');
    act(() => { t.setReach('relay_unreachable'); t.setRecovery({ step: 'failed', why: 'offline', pcName: null }); });
    expect(screen.getByRole('heading', { name: 'Relais injoignable' })).toBeInTheDocument();
  });

  it('« Appairer avec un code » after an old passkey: the step after pairing offers the update (4 i)', async () => {
    const t = app('unpaired');
    act(() => t.setRecovery(failed('old')));
    fireEvent.click(screen.getByRole('button', { name: 'Appairer avec un code' }));
    expect(t.calls).toEqual(['startPairing']);
    const real = { ...pc, publicKey: (await generateIdentity()).publicKey };
    act(() => { t.setPairing({ step: 'linked', pc: real }); t.setPinned(real); t.set('ready'); });
    act(() => t.deliver({ ...snapshot([], 'WSL'), device: { confirm: false } } as never));
    expect(await screen.findByRole('heading', { name: 'Mettre à jour ta passkey' })).toBeInTheDocument();
    expect(screen.getByText('Elle protégera tes accords à impact élevé, et permettra à cet iPhone de revenir sans code après une réinstallation.')).toBeInTheDocument();
  });
});

describe('a paired device with an old passkey (4)', () => {
  const challenge = { type: 'confirm.challenge' as const, purpose: 'register' as const, challenge: 'Y2hhbGw', rpId: 'relay.example', expiresInMs: 60_000 };
  const credential = { id: 'AQ', publicKey: 'AQID', alg: -7 as const, clientDataJSON: 'AQI', authenticatorData: 'Aw' };
  const withDevice = (device: object) => ({ ...snapshot([], 'WSL'), device: { id: 'dev1', ...device } }) as never;
  let real: PinnedPc;
  beforeEach(async () => { vi.mocked(createCredential).mockReset(); real = { ...pc, publicKey: (await generateIdentity()).publicKey }; });

  it('« À toi » shows the card; the update registers a passkey that names the PC, then a receipt', async () => {
    vi.mocked(createCredential).mockResolvedValue(credential);
    const t = app('ready', { hash: '#/' });
    act(() => t.setPinned(real));
    act(() => t.deliver(withDevice({ confirm: true })));
    expect(await screen.findByRole('heading', { name: 'Mettre à jour ta passkey' })).toBeInTheDocument();
    expect(screen.getByText('Avec une passkey à jour, cet iPhone pourra revenir sans code après une réinstallation. Face ID sera demandé une fois.')).toBeInTheDocument();
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    act(() => t.deliver(challenge));
    fireEvent.click(await screen.findByRole('button', { name: 'Mettre à jour la passkey' }));
    await waitFor(() => expect(t.of('credential.register')).toMatchObject([{ credential, userId: expect.stringMatching(/^TD/) }]));
    act(() => t.deliver({ type: 'operation.result', op: t.of('credential.register')[0]!.op, status: 'applied' }));
    expect(await screen.findByText('Passkey mise à jour')).toBeInTheDocument();
    expect(screen.getByText('Cet iPhone pourra se reconnecter sans code après une réinstallation.')).toBeInTheDocument();
  });

  it('a cancelled sheet says the old passkey still protects, with « Réessayer » and « Plus tard »', async () => {
    vi.mocked(createCredential).mockResolvedValue('cancelled');
    const t = app('ready', { hash: '#/' });
    act(() => t.setPinned(real));
    act(() => t.deliver(withDevice({ confirm: true })));
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    act(() => t.deliver(challenge));
    fireEvent.click(await screen.findByRole('button', { name: 'Mettre à jour la passkey' }));
    expect(await screen.findByText('Mise à jour annulée. Ton ancienne passkey protège toujours tes accords.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plus tard' })).toBeInTheDocument();
    expect(t.of('credential.register')).toEqual([]);
  });

  it('« Plus tard » hides the card for this device, and Connection keeps the row', async () => {
    const t = app('ready', { hash: '#/' });
    act(() => t.setPinned(real));
    act(() => t.deliver(withDevice({ confirm: true })));
    fireEvent.click(await screen.findByRole('button', { name: 'Plus tard' }));
    expect(screen.queryByRole('heading', { name: 'Mettre à jour ta passkey' })).not.toBeInTheDocument();
    expect(localStorage.getItem('ledge.mobile.passkeyUpdateLater')).toBe('dev1');
  });

  it('Connection: « Reconnexion sans code » to update, then « Prête »; no card for a passkey that is up to date', async () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.setPinned(real));
    act(() => t.deliver(withDevice({ confirm: true })));
    expect(await screen.findByText('Ta passkey doit être mise à jour une fois')).toBeInTheDocument();
    act(() => t.deliver(withDevice({ confirm: true, recover: true })));
    expect(await screen.findByText('Prête')).toBeInTheDocument();
    expect(screen.queryByText('Ta passkey doit être mise à jour une fois')).not.toBeInTheDocument();
  });

  it('Connection: after a challenge that never came, or a passkey the PC refused, « Mettre à jour » asks for a new challenge', async () => {
    vi.mocked(createCredential).mockResolvedValue(credential);
    const t = app('ready', { hash: '#/connection' });
    act(() => t.setPinned(real));
    act(() => t.deliver(withDevice({ confirm: true })));
    const update = () => screen.getByRole('button', { name: 'Mettre à jour' });
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    act(() => t.deliver({ type: 'error', code: 'invalid' }));
    await waitFor(() => expect(update()).toBeEnabled());
    fireEvent.click(update());
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(2));
    act(() => t.deliver(challenge));
    await waitFor(() => expect(update()).toBeEnabled());
    fireEvent.click(update());
    await waitFor(() => expect(t.of('credential.register')).toHaveLength(1));
    act(() => t.deliver({ type: 'operation.result', op: t.of('credential.register')[0]!.op, status: 'rejected', reason: 'invalid' } as never));
    await waitFor(() => expect(update()).toBeEnabled());
    fireEvent.click(update());
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(3));
  });
});
