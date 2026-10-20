import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_RELAY_URL, type MobileClientMessage, type MobilePairing, type MobileState } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { PairingDialog, usePairingDialogState } from '../src/settings/PairingDialog';
import { clearPairingRequest, requestPairingDialog, usePairingDialogOpen } from '../src/settings/pairingRequest';
import { usePairingAlerts } from '../src/notify/useAlerts';
import { resetDndForTests, setDnd } from '../src/notify/prefs';
import { boot, closeDaemons } from './helpers';

const ONLINE: MobileState = {
  enabled: true, relayUrl: DEFAULT_RELAY_URL, account: { login: 'octocat', accountId: '42' }, signin: null, signinError: null,
  link: { state: 'online' }, devices: [], pairings: []
};
const inMin = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const pairing = (id: string, extra: Partial<MobilePairing> = {}): MobilePairing =>
  ({ id, label: 'Pixel · Chrome', code: '482 913', expiresAt: inMin(4.5), state: 'confirm', ...extra });
const withPairings = (...pairings: MobilePairing[]): MobileState => ({ ...ONLINE, pairings });

/** The dialog alone, in French, on a fake fleet whose `sendMobile` records (or throws `error`); `open` mirrors the published state. */
function show(mobile: MobileState, opts: { error?: string } = {}) {
  const sent: MobileClientMessage[] = [];
  const notes: string[] = [];
  const fleet = { sendMobile(msg: MobileClientMessage) { if (opts.error) throw Object.assign(new Error(opts.error), { name: opts.error }); sent.push(msg); } };
  const open: boolean[] = [];
  function Probe() { open.push(usePairingDialogOpen()); return null; }
  // As the shell mounts it: the state decided at render, the application behind inert while the dialog shows.
  function Host({ m }: { m: MobileState }) {
    const shown = usePairingDialogState(m);
    return <><div className="application" inert={shown !== null}><button type="button">Behind</button></div><PairingDialog shown={shown} mobile={m} fleet={fleet} notify={t => notes.push(t)} /></>;
  }
  const tree = (m: MobileState) => <LangProvider lang="fr"><Host m={m} /><Probe /></LangProvider>;
  const view = render(tree(mobile));
  return { sent, notes, open, update: (m: MobileState) => view.rerender(tree(m)), user: userEvent.setup() };
}
const dialog = () => screen.queryByRole('dialog', { name: 'Lier un appareil' });

beforeEach(() => { clearPairingRequest(); localStorage.clear(); resetDndForTests(); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await closeDaemons(); });

/** The browser refuses focus() on an element under an `inert` ancestor (WebView2 does; jsdom does not, hence this). */
function refuseFocusUnderInert() {
  const real = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, o?: FocusOptions) { if (this.closest('[inert]')) return; real.call(this, o); });
}

describe('« Lier un appareil »', () => {
  it('a pairing to confirm opens the dialog: the label, the code in large, the account and the countdown', () => {
    show(withPairings(pairing('p1')));
    const d = dialog()!;
    expect(d).toBeVisible();
    expect(d).toHaveTextContent('Pixel · Chrome');
    expect(d).toHaveTextContent('@octocat');
    const code = screen.getByLabelText('Code de liaison : 4 8 2, 9 1 3');
    expect(code).toHaveTextContent('482913');
    expect(d).toHaveTextContent(/expire dans 4:(29|30)/);
    expect(screen.getByRole('button', { name: 'Refuser' })).toHaveFocus();
  });

  it('nothing to confirm (waiting, or mobile access off): no dialog', () => {
    const { update } = show(withPairings(pairing('p1', { state: 'waiting', code: null })));
    expect(dialog()).toBeNull();
    update({ ...withPairings(pairing('p1')), enabled: false });
    expect(dialog()).toBeNull();
  });

  it('« Approuver » sends mobile.pairing.approve; approved shows the wait in a live region, linked says the device is linked', async () => {
    const { sent, update, user } = show(withPairings(pairing('p1')));
    await user.click(screen.getByRole('button', { name: 'Approuver' }));
    expect(sent).toEqual([{ type: 'mobile.pairing.approve', id: 'p1' }]);
    update(withPairings(pairing('p1', { state: 'approved' })));
    const wait = screen.getByText(/Confirmez maintenant sur le téléphone\./);
    expect(wait.closest('[aria-live]')).toHaveTextContent('Approuvé sur ce PC. Confirmez maintenant sur le téléphone.');
    expect(screen.queryByRole('button', { name: 'Approuver' })).toBeNull();
    update(withPairings(pairing('p1', { state: 'linked' })));
    expect(dialog()).toHaveTextContent('Pixel · Chrome est lié.');
    // The linked pairing leaves the state after a while: the result stays until « Fermer ».
    update(withPairings());
    expect(dialog()).toHaveTextContent('Pixel · Chrome est lié.');
    await user.click(screen.getAllByRole('button', { name: 'Fermer' }).at(-1)!);   // the result's « Fermer », not the title's
    expect(dialog()).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it('expired: « La demande a expiré » and « Fermer »', async () => {
    const { update, user } = show(withPairings(pairing('p1')));
    update(withPairings(pairing('p1', { state: 'expired' })));
    expect(screen.getByRole('alert')).toHaveTextContent('La demande a expiré. Recommencez depuis le téléphone.');
    await user.click(screen.getAllByRole('button', { name: 'Fermer' }).at(-1)!);   // the result's « Fermer », not the title's
    expect(dialog()).toBeNull();
  });

  it('« Refuser » sends mobile.pairing.deny and closes; refused from elsewhere closes too', async () => {
    const { sent, update, user } = show(withPairings(pairing('p1')));
    await user.click(screen.getByRole('button', { name: 'Refuser' }));
    expect(sent).toEqual([{ type: 'mobile.pairing.deny', id: 'p1' }]);
    expect(dialog()).toBeNull();
    update(withPairings(pairing('p1', { state: 'refused' })));
    expect(dialog()).toBeNull();

    update(withPairings(pairing('p2')));
    expect(dialog()).toBeVisible();
    update(withPairings(pairing('p2', { state: 'refused' })));
    expect(dialog()).toBeNull();
  });

  it('Escape only closes (nothing is sent); « Comparer le code » opens it again', async () => {
    const { sent, open, user } = show(withPairings(pairing('p1')));
    expect(open.at(-1)).toBe(true);
    await user.keyboard('{Escape}');
    expect(dialog()).toBeNull();
    expect(sent).toEqual([]);
    expect(open.at(-1)).toBe(false);
    act(() => requestPairingDialog('p1'));
    expect(dialog()).toBeVisible();
    expect(open.at(-1)).toBe(true);
  });

  it('a click outside only closes; nothing is sent', async () => {
    const { sent, user } = show(withPairings(pairing('p1')));
    await user.click(document.querySelector('.modal-backdrop')!);
    expect(dialog()).toBeNull();
    expect(sent).toEqual([]);
  });

  it('two pairings to confirm: the oldest first, the second after the decision', async () => {
    const older = pairing('p-old', { label: 'iPhone · Safari', code: '111 222', expiresAt: inMin(2) });
    const newer = pairing('p-new', { label: 'Pixel · Chrome', code: '482 913', expiresAt: inMin(4) });
    const { sent, update, user } = show(withPairings(newer, older));
    expect(dialog()).toHaveTextContent('iPhone · Safari');
    expect(screen.getByLabelText('Code de liaison : 1 1 1, 2 2 2')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Refuser' }));
    expect(sent).toEqual([{ type: 'mobile.pairing.deny', id: 'p-old' }]);
    update(withPairings(newer, { ...older, state: 'refused' }));
    expect(dialog()).toHaveTextContent('Pixel · Chrome');
    expect(screen.getByLabelText('Code de liaison : 4 8 2, 9 1 3')).toBeVisible();
  });

  it('a refused send (daemon offline) says so in the toast and keeps the dialog', async () => {
    const { sent, notes, user } = show(withPairings(pairing('p1')), { error: 'DaemonOffline' });
    await user.click(screen.getByRole('button', { name: 'Refuser' }));
    expect(sent).toEqual([]);
    expect(notes).toEqual(['Le daemon local est hors ligne : rien n’a changé.']);
    expect(dialog()).toBeVisible();
  });
});

describe('the focus goes back where it was when the dialog goes away (the application behind is inert while it shows)', () => {
  /** Focuses « Behind », then a pairing comes to confirm: the dialog takes the focus. */
  function opened() {
    refuseFocusUnderInert();
    const v = show(withPairings());
    const behind = screen.getByRole('button', { name: 'Behind' });
    act(() => behind.focus());
    v.update(withPairings(pairing('p1')));
    expect(dialog()).toBeVisible();
    expect(behind.closest('[inert]')).not.toBeNull();
    expect(document.activeElement).not.toBe(behind);
    return { ...v, behind };
  }

  it('Escape', async () => {
    const { behind, user } = opened();
    await user.keyboard('{Escape}');
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(behind);
  });

  it('the backdrop, and the title\'s close', async () => {
    const { behind, user, update } = opened();
    await user.click(document.querySelector('.modal-backdrop')!);
    expect(document.activeElement).toBe(behind);
    update(withPairings(pairing('p1'), pairing('p2')));
    expect(dialog()).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: 'Fermer' })[0]!);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(behind);
  });

  it('« Refuser », and « Fermer » after linked', async () => {
    const { behind, user, update } = opened();
    await user.click(screen.getByRole('button', { name: 'Refuser' }));
    expect(document.activeElement).toBe(behind);
    update(withPairings(pairing('p2')));
    update(withPairings(pairing('p2', { state: 'linked' })));
    await user.click(screen.getAllByRole('button', { name: 'Fermer' }).at(-1)!);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(behind);
  });

  it('the daemon refuses the pairing, or forgets it', () => {
    const { behind, update } = opened();
    update(withPairings(pairing('p1', { state: 'refused' })));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(behind);
    update(withPairings(pairing('p2')));
    expect(document.activeElement).not.toBe(behind);
    update(withPairings());
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(behind);
  });

  it('in the app: the dialog opens over the atelier, and Escape or the daemon\'s refusal gives the focus back', async () => {
    refuseFocusUnderInert();
    const { d, user } = await boot();
    const behind = screen.getAllByRole('button', { name: /^Local/ })[0]!;
    act(() => behind.focus());
    d.push({ type: 'mobile', state: { ...ONLINE, pairings: [pairing('p1')] } });
    expect(await screen.findByRole('dialog', { name: 'Link a device' })).toBeVisible();
    expect(behind.closest('[inert]')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Link a device' })).toBeNull();
    expect(document.activeElement).toBe(behind);
    d.push({ type: 'mobile', state: { ...ONLINE, pairings: [pairing('p2')] } });
    expect(await screen.findByRole('dialog', { name: 'Link a device' })).toBeVisible();
    d.push({ type: 'mobile', state: { ...ONLINE, pairings: [pairing('p2', { state: 'refused' })] } });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Link a device' })).toBeNull());
    expect(document.activeElement).toBe(behind);
  });
});

describe('the Windows notification', () => {
  function setup(focused: boolean) {
    const deps = { toast: vi.fn(), focused: vi.fn(() => focused) };
    const h = renderHook((m: MobileState) => usePairingAlerts(m, deps), { initialProps: withPairings(pairing('p1', { state: 'waiting', code: null })) });
    return { deps, h };
  }

  it('once per pairing, when it comes to confirm and the window has no focus', () => {
    const { deps, h } = setup(false);
    expect(deps.toast).not.toHaveBeenCalled();
    h.rerender(withPairings(pairing('p1')));
    expect(deps.toast).toHaveBeenCalledTimes(1);
    expect(deps.toast).toHaveBeenCalledWith("A device asks for access", 'Pixel · Chrome');
    h.rerender(withPairings(pairing('p1', { label: 'Pixel · Chrome', expiresAt: inMin(3) })));
    h.rerender(withPairings(pairing('p1', { state: 'approved' })));
    h.rerender(withPairings(pairing('p1')));
    expect(deps.toast).toHaveBeenCalledTimes(1);
    h.rerender(withPairings(pairing('p1'), pairing('p2', { label: 'iPhone · Safari' })));
    expect(deps.toast).toHaveBeenCalledTimes(2);
    expect(deps.toast).toHaveBeenLastCalledWith("A device asks for access", 'iPhone · Safari');
  });

  it('not while the window has the focus', () => {
    const { deps, h } = setup(true);
    h.rerender(withPairings(pairing('p1')));
    expect(deps.toast).not.toHaveBeenCalled();
  });

  it('never in Do not disturb', () => {
    setDnd(true);
    const { deps, h } = setup(false);
    h.rerender(withPairings(pairing('p1')));
    expect(deps.toast).not.toHaveBeenCalled();
  });

  it('in French, the mockup\'s words', () => {
    const toast = vi.fn();
    renderHook(() => usePairingAlerts(withPairings(pairing('p1')), { toast, focused: () => false }), { wrapper: ({ children }) => <LangProvider lang="fr">{children}</LangProvider> });
    expect(toast).toHaveBeenCalledWith("Un appareil demande l'accès", 'Pixel · Chrome');
  });
});
