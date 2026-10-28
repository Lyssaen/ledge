import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCredential, platformAvailable } from '../../src/link/webauthn';
import { forgetIfKeysLost } from '../../src/boot';
import { memoryKeys, type PinnedPc } from '../../src/link/keys';
import { LAST_STATE_KEY } from '../../src/state/persist';
import { pending, session } from '../model/fixtures';
import { MemoryStorage, snapshot } from '../state/helpers';
import { app, fakeUpdates } from './app-setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(async () => false), createCredential: vi.fn(), getAssertion: vi.fn() }));

const pc: PinnedPc = { publicKey: 'K', fingerprint: 'abcdEFGHijklMNOPqrstuv', name: 'PC-Desan', pinnedAt: '2026-10-16T08:00:00.000Z' };
const hashChange = () => act(() => { globalThis.dispatchEvent(new HashChangeEvent('hashchange')); });

describe('the app', () => {
  it('PC offline → the inbox says « PC-Desan ne répond plus », and « Réessayer » retries the link', () => {
    const t = app('ready');
    act(() => {
      t.setPinned(pc);
      t.deliver(snapshot([session('a', { state: 'waiting_permission', pending: pending({ key: 'ka' }) })], 'PC-Desan'));
      t.set('pc_offline');
    });
    const notice = screen.getByRole('status');
    expect(within(notice).getByText('PC-Desan ne répond plus')).toBeInTheDocument();
    expect(notice).toHaveTextContent(/Le PC est sans doute en veille depuis \d\d:\d\d\./);
    fireEvent.click(within(notice).getByRole('button', { name: 'Réessayer' }));
    expect(t.calls).toEqual(['retry']);
    expect(screen.queryByText('PC hors ligne')).not.toBeInTheDocument();
  });

  it('PC offline before it was ever named → « Votre PC ne répond plus »', () => {
    app('pc_offline');
    expect(screen.getByText('Votre PC ne répond plus')).toBeInTheDocument();
  });

  it('every other screen reconnects through the same retry', () => {
    const t = app('pc_offline', { hash: '#/agents' });
    expect(screen.getByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnecter et actualiser' }));
    expect(t.calls).toEqual(['retry']);
  });

  it('routes to the agents, a thread, a terminal and a request', () => {
    const t = app('ready', { hash: '#/agents' });
    act(() => t.deliver(snapshot([session('a', { name: 'Kai', topic: 'Inbox mobile', state: 'waiting_permission', pending: pending({ key: 'ka', text: 'pnpm build' }) })], 'PC-Desan')));
    expect(screen.getByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    act(() => { globalThis.location.hash = '#/thread/a'; });
    hashChange();
    expect(screen.getByRole('heading', { name: 'Inbox mobile' })).toBeInTheDocument();
    act(() => { globalThis.location.hash = '#/terminal/a'; });
    hashChange();
    expect(screen.getByText('Terminal de Kai')).toBeInTheDocument();
    act(() => { globalThis.location.hash = '#/request/a/ka'; });
    hashChange();
    expect(screen.getByText('pnpm build', { selector: 'pre' })).toBeInTheDocument();
  });

  it('a request replaced in place keeps « mise à jour » when the app renders the new address again', () => {
    const t = app('ready', { hash: '#/request/a/k1' });
    act(() => t.deliver(snapshot([session('a', { state: 'waiting_permission', pending: pending({ key: 'k1', text: 'pnpm test' }) })])));
    fireEvent.click(screen.getByRole('button', { name: 'Autoriser une fois' }));
    const op = t.of('session.decide')[0]!.op;
    act(() => t.deliver({ type: 'operation.result', op, status: 'rejected', reason: 'stale' }));
    act(() => t.deliver({ type: 'session.pending', id: 'a', pending: pending({ key: 'p2', text: 'pnpm build' }) }));
    expect(globalThis.location.hash).toBe('#/request/a/p2');
    hashChange();
    expect(screen.getByText('pnpm build', { selector: 'pre' })).toBeInTheDocument();
    expect(screen.getByText('La demande a été mise à jour. Relisez-la avant de décider.')).toBeInTheDocument();
  });

  it('the connection screen: account, relay, PC and its fingerprint, the app’s version and fingerprint, and sign out', async () => {
    const t = app('ready', { hash: '#/connection', updates: fakeUpdates({ version: '0.9.1', fingerprint: '0123456789abcdef0123456789abcdef' }).watch });
    act(() => t.setPinned(pc));
    expect(screen.getByText('Connexion')).toBeInTheDocument();
    expect(await screen.findByText('@paradow')).toBeInTheDocument();
    expect(t.fetchImpl.mock.calls.map(([u]) => String(u))).toContain('/auth/me');
    const rows = Object.fromEntries([...document.querySelectorAll('dl dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));
    expect(rows).toEqual({
      'Compte': '@paradow',
      'Serveur': globalThis.location.host,
      'PC': 'PC-Desan',
      'Empreinte du PC': 'abcd EFGH ijkl MNOP qrst uv',
      'État': 'Connecté',
      'Version de l’app': '0.9.1',
      'Empreinte de l’app': '0123 4567 89ab cdef 0123 4567',
      // No snapshot yet: the PC's version is not known.
      'Version du PC': '—'
    });
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    // The PC is asked to remove this phone first; the phone signs out once it said applied.
    const forget = t.of('device.forget')[0]!;
    expect(t.calls).toEqual([]);
    await act(async () => { t.deliver({ type: 'operation.result', op: forget.op, status: 'received' }); });
    expect(t.calls).toEqual([]);
    await act(async () => { t.deliver({ type: 'operation.result', op: forget.op, status: 'applied' }); });
    expect(t.calls).toEqual(['signOut']);
    expect(screen.queryByText(/Le PC n’a pas confirmé/)).toBeNull();
  });

  it('« Se déconnecter » tapped twice: one device.forget, one sign-out on applied, no note', async () => {
    const t = app('ready', { hash: '#/connection' });
    const button = screen.getByRole('button', { name: 'Se déconnecter' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(t.of('device.forget')).toHaveLength(1);
    await act(async () => { t.deliver({ type: 'operation.result', op: t.of('device.forget')[0]!.op, status: 'applied' }); });
    expect(t.calls).toEqual(['signOut']);
    act(() => t.set('signed_out'));
    expect(screen.queryByText(/Le PC n’a pas confirmé/)).toBeNull();
  });

  it('« Se déconnecter » offline: signs out at once, and the screen the user lands on says the PC did not confirm', () => {
    const t = app('pc_offline', { hash: '#/connection' });
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(t.of('device.forget')).toEqual([]);
    expect(t.calls).toEqual(['signOut']);
    act(() => t.set('signed_out'));
    expect(screen.getByText('Le PC n’a pas confirmé. Retirez ce téléphone dans Ledge sur le PC, section Accès mobile.')).toBeInTheDocument();
  });

  it('« Se déconnecter » without an answer from the PC: erased after 5 s, with the note', async () => {
    vi.useFakeTimers();
    try {
      const t = app('ready', { hash: '#/connection' });
      fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
      expect(t.of('device.forget')).toHaveLength(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(4_900); });
      expect(t.calls).toEqual([]);
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(t.calls).toEqual(['signOut']);
      act(() => t.set('signed_out'));
      expect(screen.getByText(/Le PC n’a pas confirmé/)).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it('the connection screen without a service worker: « — » for the build', () => {
    app('pc_offline', { hash: '#/connection', me: null });
    const rows = Object.fromEntries([...document.querySelectorAll('dl dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));
    expect(rows['Version de l’app']).toBe('—');
    expect(rows['Empreinte de l’app']).toBe('—');
    expect(rows['PC']).toBe('Inconnu');
    expect(rows['État']).toBe('Déconnecté');
  });

  it('a build waiting for consent → the Update sheet over the screen, as the board shows it', () => {
    const u = fakeUpdates({ version: '0.5.4', fingerprint: '8e1702af0000000000000000' });
    app('ready', { updates: u.watch });
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => u.set({ waiting: { version: '0.6.0', fingerprint: '3f9ac21e70bd44e19a02d5c8aaaa' } }));
    const sheet = screen.getByRole('dialog', { name: 'Nouvelle version · 0.6.0' });
    expect(sheet).toHaveTextContent('Le serveur propose une mise à jour de l’app. Rien ne change tant que vous ne l’acceptez pas.');
    expect(within(sheet).getByText('Empreinte de cette version')).toBeInTheDocument();
    expect(within(sheet).getByText('3f9a c21e 70bd 44e1 9a02 d5c8')).toBeInTheDocument();
    expect(sheet).toHaveTextContent('Actuelle : 0.5.4 · 8e17 02af');
    expect(within(sheet).getByRole('link', { name: 'Comparer avec la release v0.6.0 sur GitHub' }))
      .toHaveAttribute('href', 'https://github.com/Lyssaen/ledge/releases/tag/v0.6.0');
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent)).toEqual(['Plus tard', 'Mettre à jour']);
    // The screen stays underneath.
    expect(screen.getByText('À traiter', { selector: 'h1' })).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Mettre à jour' }));
    expect(u.accept).toHaveBeenCalledTimes(1);
  });

  it('« Plus tard » hides the sheet for that build; a newer one raises it again', () => {
    const u = fakeUpdates({ version: '0.5.4', fingerprint: '8e1702af' }, { version: '0.6.0', fingerprint: '3f9ac21e' });
    app('ready', { updates: u.watch });
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(u.accept).not.toHaveBeenCalled();
    act(() => u.set({ waiting: { version: '0.6.1', fingerprint: '77aa01bc' } }));
    expect(screen.getByRole('dialog', { name: 'Nouvelle version · 0.6.1' })).toBeInTheDocument();
  });

  it('the sheet takes the focus, Escape is « Plus tard », and the focus comes back where it was', () => {
    const u = fakeUpdates({ version: '0.5.4', fingerprint: '8e1702af' });
    app('ready', { updates: u.watch });
    const gear = screen.getByRole('link', { name: /connexion/i });
    gear.focus();
    act(() => u.set({ waiting: { version: '0.6.0', fingerprint: '3f9ac21e' } }));
    const sheet = screen.getByRole('dialog', { name: 'Nouvelle version · 0.6.0' });
    expect(sheet).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(u.accept).not.toHaveBeenCalled();
    expect(gear).toHaveFocus();
  });

  it('the build on the connection screen follows the service worker', () => {
    const u = fakeUpdates();
    app('ready', { hash: '#/connection', updates: u.watch });
    const row = () => Object.fromEntries([...document.querySelectorAll('dl dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]))['Version de l’app'];
    expect(row()).toBe('—');
    act(() => u.set({ current: { version: '0.11.0', fingerprint: 'abcd' } }));
    expect(row()).toBe('0.11.0');
  });

  it('another tab took the link → said, with the way to take it back', () => {
    app('replaced');
    expect(screen.getByRole('heading', { name: 'Ledge est ouvert ailleurs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Utiliser ici' })).toBeInTheDocument();
  });

  it('keys lost (identity gone, last state kept) → the cache is wiped and the phone says it is no longer linked, pairing again', async () => {
    const storage = new MemoryStorage();
    storage.setItem(LAST_STATE_KEY, JSON.stringify({ sessions: [], previews: {}, daemon: { version: '0.9.0', name: 'PC-Desan' }, syncedAt: null }));
    storage.setItem('ledge.mobile.reads', '{}');
    storage.setItem('other.app', 'kept');
    expect(await forgetIfKeysLost(memoryKeys(storage), storage)).toBe(true);
    expect(storage.getItem(LAST_STATE_KEY)).toBeNull();
    expect(storage.getItem('ledge.mobile.reads')).toBeNull();
    expect(storage.getItem('other.app')).toBe('kept');

    const t = app('unpaired', { lost: true });
    expect(screen.getByText('Ce téléphone n’est plus lié')).toBeInTheDocument();
    expect(t.calls).toEqual(['startPairing']);
  });

  it('keys kept, or nothing cached → nothing wiped', async () => {
    const storage = new MemoryStorage();
    expect(await forgetIfKeysLost(memoryKeys(storage), storage)).toBe(false);
    storage.setItem(LAST_STATE_KEY, '{}');
    const keys = memoryKeys(storage);
    await keys.saveIdentity({ publicKey: 'P', privateKey: {} as CryptoKey });
    expect(await forgetIfKeysLost(keys, storage)).toBe(false);
    expect(storage.getItem(LAST_STATE_KEY)).toBe('{}');
  });

  describe('protecting the high-impact accepts with this device', () => {
    const challenge = { type: 'confirm.challenge' as const, purpose: 'register' as const, challenge: 'Y2hhbGw', rpId: 'relay.example', expiresInMs: 60_000 };
    const credential = { id: 'AQ', publicKey: 'AQID', alg: -7 as const, clientDataJSON: 'AQI', authenticatorData: 'Aw' };
    beforeEach(() => { vi.mocked(platformAvailable).mockResolvedValue(true); vi.mocked(createCredential).mockReset(); });
    const withDevice = (confirm: boolean) => ({ ...snapshot([], 'PC-Desan'), device: { confirm } }) as never;

    it('Connection without a credential offers « Protéger les accords », and a tap creates the passkey and registers it', async () => {
      vi.mocked(createCredential).mockResolvedValue(credential);
      const t = app('ready', { hash: '#/connection' });
      act(() => t.deliver(withDevice(false)));
      await waitFor(() => expect(t.of('confirm.prepare')).toMatchObject([{ purpose: 'register' }]));
      expect(screen.getByText('Accords à impact élevé')).toBeInTheDocument();
      act(() => t.deliver(challenge));
      fireEvent.click(await screen.findByRole('button', { name: 'Protéger les accords' }));
      expect(createCredential).toHaveBeenCalledWith({ challenge: 'Y2hhbGw', rpId: 'relay.example' }, { label: expect.any(String) });
      await waitFor(() => expect(t.of('credential.register')).toMatchObject([{ credential }]));
      act(() => t.deliver({ type: 'operation.result', op: t.of('credential.register')[0]!.op, status: 'applied' }));
      act(() => t.deliver(withDevice(true)));
      expect(await screen.findByText('Protégés par cet appareil')).toBeInTheDocument();
    });

    it('Connection with a credential says « Protégés par cet appareil »', async () => {
      const t = app('ready', { hash: '#/connection' });
      act(() => t.deliver(withDevice(true)));
      expect(await screen.findByText('Protégés par cet appareil')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Protéger les accords' })).not.toBeInTheDocument();
    });

    it('a cancelled passkey says nothing was sent, and registers nothing', async () => {
      vi.mocked(createCredential).mockResolvedValue('cancelled');
      const t = app('ready', { hash: '#/connection' });
      act(() => t.deliver(withDevice(false)));
      await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
      act(() => t.deliver(challenge));
      fireEvent.click(await screen.findByRole('button', { name: 'Protéger les accords' }));
      expect(await screen.findByText('Vérification annulée. Rien n’a été envoyé.')).toBeInTheDocument();
      expect(t.of('credential.register')).toEqual([]);
    });

    it('a PC of lot 5 (no device) shows no row', async () => {
      const t = app('ready', { hash: '#/connection' });
      act(() => t.deliver(snapshot([], 'PC-Desan')));
      expect(screen.queryByText('Accords à impact élevé')).not.toBeInTheDocument();
    });

    it('after the pairing, the step offers the protection, and « Plus tard » leads to the inbox', async () => {
      const t = app('pairing');
      act(() => { t.setPairing({ step: 'linked', pc }); t.setPinned(pc); t.set('ready'); });
      act(() => t.deliver(withDevice(false)));
      expect(await screen.findByRole('heading', { name: 'Protéger les accords' })).toBeInTheDocument();
      expect(screen.getByText('Face ID ou le code de ce téléphone sera demandé pour autoriser une commande à impact élevé.')).toBeInTheDocument();
      await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
      fireEvent.click(screen.getByRole('link', { name: 'Plus tard' }));
      expect(screen.getByRole('heading', { name: 'À traiter' })).toBeInTheDocument();
    });

    it('after the pairing, a PC with no device offers nothing but the way in', () => {
      const t = app('pairing');
      act(() => { t.setPairing({ step: 'linked', pc }); t.setPinned(pc); t.set('ready'); });
      act(() => t.deliver(snapshot([], 'PC-Desan')));
      expect(screen.queryByRole('heading', { name: 'Protéger les accords' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Voir ce qui attend' })).toBeInTheDocument();
    });
  });

  describe('notifications', () => {
    const linked = (push?: 'on' | 'off' | 'stale' | 'unavailable', confirm = true) => ({ ...snapshot([], 'PC-Desan'), device: { confirm, ...(push ? { push } : {}) } }) as never;
    beforeEach(() => {
      vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn(async () => 'denied') });
      vi.stubGlobal('PushManager', class {});
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('after « Protéger les accords », the step « Être prévenu quand un agent attend » comes, and « Plus tard » leads to the inbox', async () => {
      const t = app('pairing');
      act(() => { t.setPairing({ step: 'linked', pc }); t.setPinned(pc); t.set('ready'); });
      act(() => t.deliver(linked('off')));
      fireEvent.click(screen.getByRole('link', { name: 'Voir ce qui attend' }));
      expect(await screen.findByRole('heading', { name: 'Être prévenu quand un agent attend' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Activer les notifications' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('link', { name: 'Plus tard' }));
      expect(screen.getByRole('heading', { name: 'À traiter' })).toBeInTheDocument();
    });

    it('a refused permission says so and keeps the step', async () => {
      const t = app('pairing');
      act(() => { t.setPairing({ step: 'linked', pc }); t.setPinned(pc); t.set('ready'); });
      act(() => t.deliver(linked('off')));
      fireEvent.click(screen.getByRole('link', { name: 'Voir ce qui attend' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Activer les notifications' }));
      expect(await screen.findByText(/Notifications refusées/)).toBeInTheDocument();
      expect(t.of('push.subscribe')).toEqual([]);
    });

    it('a PC without push, or notifications already on, goes straight to the inbox', () => {
      for (const push of ['unavailable', 'on', undefined] as const) {
        const t = app('pairing');
        act(() => { t.setPairing({ step: 'linked', pc }); t.setPinned(pc); t.set('ready'); });
        act(() => t.deliver(linked(push)));
        fireEvent.click(screen.getByRole('link', { name: 'Voir ce qui attend' }));
        expect(screen.queryByRole('heading', { name: 'Être prévenu quand un agent attend' })).not.toBeInTheDocument();
        cleanup();
      }
    });
  });

  describe('a notification tap (ledge.open from the service worker)', () => {
    let sw: EventTarget;
    beforeEach(() => {
      sw = new EventTarget();
      Object.defineProperty(globalThis.navigator, 'serviceWorker', { configurable: true, value: sw });
    });
    afterEach(() => { Reflect.deleteProperty(globalThis.navigator, 'serviceWorker'); });
    const post = (data: unknown) => act(() => { sw.dispatchEvent(new MessageEvent('message', { data })); });

    it('goes to the url it names', () => {
      app('ready');
      post({ type: 'ledge.open', url: '/#/thread/s1' });
      expect(globalThis.location.hash).toBe('#/thread/s1');
    });

    it('ignores every other message and any url outside the app', () => {
      app('ready');
      for (const data of [
        { type: 'ledge.open', url: 'https://evil.example/#/x' }, { type: 'ledge.open', url: '//evil.example' }, { type: 'ledge.open', url: '/#/a b' },
        { type: 'ledge.open', url: 7 }, { type: 'other', url: '/#/agents' }, 'ledge.open', null
      ]) post(data);
      expect(globalThis.location.hash).toBe('#/');
    });
  });
});
