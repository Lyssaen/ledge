import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { forgetIfKeysLost } from '../../src/boot';
import { memoryKeys, type PinnedPc } from '../../src/link/keys';
import { LAST_STATE_KEY } from '../../src/state/persist';
import { pending, session } from '../model/fixtures';
import { MemoryStorage, snapshot } from '../state/helpers';
import { app } from './app-setup';

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
    const t = app('ready', { hash: '#/connection', build: { version: '0.9.1', fingerprint: '0123456789abcdef0123456789abcdef' } });
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
      'Empreinte de l’app': '0123 4567 89ab cdef 0123 4567'
    });
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(t.calls).toEqual(['signOut']);
  });

  it('the connection screen before Task 11 gives the build: « — »', () => {
    app('pc_offline', { hash: '#/connection', me: null });
    const rows = Object.fromEntries([...document.querySelectorAll('dl dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));
    expect(rows['Version de l’app']).toBe('—');
    expect(rows['Empreinte de l’app']).toBe('—');
    expect(rows['PC']).toBe('Inconnu');
    expect(rows['État']).toBe('Déconnecté');
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
});
