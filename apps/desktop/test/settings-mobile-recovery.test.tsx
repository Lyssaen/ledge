import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_RELAY_URL, type MobileClientMessage, type MobileState } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { Mobile } from '../src/settings/Mobile';
import { clearDeviceViewRequest, mobileRecovery, requestDeviceView } from '../src/settings/recovery';
import type { SettingsContext } from '../src/settings/SettingsPage';
import { machine } from './fleet-helpers';
import { boot, closeDaemons, TWO_PROJECTS } from './helpers';

// Passkey recovery after a reinstall on Desktop (docs/mockups/ledge-mobile-passkey/passkey-reinstall.html, 5 and 6).

const ONLINE: MobileState = { enabled: true, relayUrl: DEFAULT_RELAY_URL, account: { login: 'octocat', accountId: '42' }, signin: null, signinError: null, link: { state: 'online' }, devices: [], pairings: [] };
const LINKED = '2026-10-16T08:00:00.000Z';
const IPAD = { id: 'fp-ipad', label: 'iPad · Safari', kind: 'tablet' as const, approvedAt: LINKED, online: true };
const IPHONE = { id: 'fp-iphone', label: 'iPhone · Safari', approvedAt: '2026-11-02T08:00:00.000Z', online: false };
/** Today at hh:mm, in local time, as the daemon would send it. */
const todayAt = (h: number, min: number) => { const d = new Date(); d.setHours(h, min, 0, 0); return d.toISOString(); };
/** Another day this year (or the last day of last year, early in January), so the trace shows a date rather than « aujourd'hui ». */
const otherDay = () => { const d = new Date(); d.setDate(d.getDate() === 1 ? 2 : 1); d.setHours(9, 30, 0, 0); return d; };

function show(mobile: MobileState) {
  const sent: MobileClientMessage[] = [];
  const fleet = { sendMobile(msg: MobileClientMessage) { sent.push(msg); } };
  const ctx = (m: MobileState) => ({ fleet, mobile: m, mobileError: undefined, machines: [machine('local', { ready: true })], notify: () => {} }) as unknown as SettingsContext;
  const view = render(<LangProvider lang="fr"><Mobile ctx={ctx(mobile)} /></LangProvider>);
  const update = (m: MobileState) => view.rerender(<LangProvider lang="fr"><Mobile ctx={ctx(m)} /></LangProvider>);
  return { sent, update, user: userEvent.setup() };
}
const row = (name: string) => within(screen.getByRole('article', { name }));

beforeEach(() => { localStorage.clear(); clearDeviceViewRequest(); });
afterEach(async () => { vi.restoreAllMocks(); await closeDaemons(); });

describe('Settings › Accès mobile › Appareils: passkey recovery', () => {
  it('6 a: a pending recovery shows the tag, the trace « aujourd’hui à 18:04 », the key well and its two buttons, not Renommer', () => {
    show({ ...ONLINE, devices: [{ ...IPAD, recovered: { at: todayAt(18, 4), pending: true } }, IPHONE] });
    const ipad = row('iPad · Safari');
    expect(ipad.getByText('Reconnecté')).toHaveClass('set-tag', 'info');
    expect(ipad.getByText(/^Lié le .* · reconnecté avec sa passkey aujourd'hui à 18:04$/)).toBeVisible();
    expect(ipad.getByText("Cet iPad s'est reconnecté sans code, avec sa passkey, après une réinstallation de l'app. Si ce n'était pas vous, révoquez-le : il perd l'accès tout de suite.")).toBeVisible();
    expect(ipad.getAllByRole('button').map(b => b.textContent)).toEqual(["C'était bien moi", 'Révoquer']);
    // The other device keeps its ordinary row.
    expect(row('iPhone · Safari').queryByText('Reconnecté')).toBeNull();
    expect(row('iPhone · Safari').getAllByRole('button').map(b => b.textContent)).toEqual(['Renommer', 'Révoquer']);
  });

  it('« C’était bien moi » sends mobile.device.ack recovered', async () => {
    const { sent, user } = show({ ...ONLINE, devices: [{ ...IPAD, recovered: { at: todayAt(18, 4), pending: true } }] });
    await user.click(screen.getByRole('button', { name: "C'était bien moi" }));
    expect(sent).toEqual([{ type: 'mobile.device.ack', id: 'fp-ipad', what: 'recovered' }]);
  });

  it('6 b: « Révoquer » in the well opens today’s inline confirmation; « Annuler » brings the well back, the confirmation revokes', async () => {
    const { sent, user } = show({ ...ONLINE, devices: [{ ...IPAD, recovered: { at: todayAt(18, 4), pending: true } }] });
    await user.click(screen.getByRole('button', { name: 'Révoquer' }));
    expect(screen.getByRole('alert')).toHaveTextContent("Révoquer iPad · Safari ? Il perd l'accès tout de suite");
    expect(screen.getByText('Reconnecté')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: "C'était bien moi" })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Révoquer' }));
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Révoquer' }));
    expect(sent).toEqual([{ type: 'mobile.device.revoke', id: 'fp-ipad' }]);
  });

  it('6 c: once acknowledged, an ordinary row whose line keeps the trace with its date', () => {
    const day = otherDay();
    show({ ...ONLINE, devices: [{ ...IPAD, recovered: { at: day.toISOString() } }] });
    const ipad = row('iPad · Safari');
    const date = new Intl.DateTimeFormat('fr', { day: 'numeric', month: 'short' }).format(day);
    expect(ipad.getByText(`Lié le 16 oct. 2026 · reconnecté avec sa passkey le ${date}`)).toBeVisible();
    expect(ipad.queryByText('Reconnecté')).toBeNull();
    expect(ipad.getAllByRole('button').map(b => b.textContent)).toEqual(['Renommer', 'Révoquer']);
  });

  it('6 d: a refused attempt shows its warn tag and well; « Compris » sends mobile.device.ack refused, « Révoquer » confirms', async () => {
    const { sent, user } = show({ ...ONLINE, devices: [{ ...IPAD, refused: { at: todayAt(18, 12) } }] });
    const ipad = row('iPad · Safari');
    expect(ipad.getByText('Tentative refusée')).toHaveClass('set-tag', 'warn');
    expect(ipad.getByText('Lié le 16 oct. 2026')).toBeVisible();
    expect(ipad.getByText("À 18:12, un autre appareil a tenté de prendre la place de l'iPad avec sa passkey. Refusé : l'iPad était connecté. Une passkey synchronisée par iCloud marche sur tous les appareils Apple du compte ; si ce n'était pas vous, révoquez cet iPad.")).toBeVisible();
    await user.click(ipad.getByRole('button', { name: 'Compris' }));
    expect(sent).toEqual([{ type: 'mobile.device.ack', id: 'fp-ipad', what: 'refused' }]);
    await user.click(ipad.getByRole('button', { name: 'Révoquer' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Révoquer iPad · Safari ?');
  });

  it('6 e: recovery blocked: the lock well at the top of Appareils; « Débloquer » sends mobile.recovery.unblock', async () => {
    const { sent, user } = show({ ...ONLINE, devices: [IPAD], recovery: { blocked: { since: todayAt(18, 20), failures: 3 } } });
    const well = screen.getByRole('alert');
    expect(well).toHaveTextContent("Reconnexion par passkey bloquée : 3 vérifications ont échoué depuis 18:20. Les appareils liés continuent de marcher, l'appairage avec un code aussi.");
    // It comes before the devices' rows.
    expect(well.compareDocumentPosition(screen.getByRole('article', { name: 'iPad · Safari' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(within(well).getByRole('button', { name: 'Débloquer' }));
    expect(sent).toEqual([{ type: 'mobile.recovery.unblock' }]);
  });

  it('a name the user gave is said bare in the wells', () => {
    show({ ...ONLINE, devices: [{ ...IPAD, name: 'Tablette', recovered: { at: todayAt(18, 4), pending: true } }] });
    expect(screen.getByText(/^Tablette s'est reconnecté sans code/)).toBeVisible();
  });

  it('a « Voir » request brings the device’s row into view', async () => {
    const into = vi.fn();
    Element.prototype.scrollIntoView = into;
    requestDeviceView('fp-iphone');
    show({ ...ONLINE, devices: [IPAD, IPHONE] });
    await waitFor(() => expect(into).toHaveBeenCalledTimes(1));
    expect(into.mock.contexts[0]).toBe(screen.getByRole('article', { name: 'iPhone · Safari' }));
  });

  it('the tab’s dot: a pending recovery or a refused attempt, not an acknowledged one nor a block', () => {
    expect(mobileRecovery({ ...ONLINE, devices: [{ ...IPAD, recovered: { at: LINKED, pending: true } }] })).toBe(true);
    expect(mobileRecovery({ ...ONLINE, devices: [{ ...IPAD, refused: { at: LINKED } }] })).toBe(true);
    expect(mobileRecovery({ ...ONLINE, devices: [{ ...IPAD, recovered: { at: LINKED } }] })).toBe(false);
    expect(mobileRecovery({ ...ONLINE, devices: [IPAD], recovery: { blocked: { since: LINKED, failures: 3 } } })).toBe(false);
    expect(mobileRecovery(undefined)).toBe(false);
  });
});

describe('passkey recovery in the app', () => {
  it('5 a: « recovered » toasts 10 s with « View », which opens Mobile access on the device; the tab has its dot', async () => {
    const into = vi.fn();
    Element.prototype.scrollIntoView = into;
    const { d } = await boot({ projects: TWO_PROJECTS });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      d.push({ type: 'mobile', state: { ...ONLINE, devices: [{ ...IPAD, recovered: { at: todayAt(18, 4), pending: true } }, IPHONE] } });
      d.push({ type: 'mobile.recovery', event: 'recovered', id: 'fp-ipad', at: todayAt(18, 4) });
      const text = await screen.findByText('The iPad reconnected with its passkey');
      expect(text.parentElement).not.toHaveClass('warn');
      act(() => { vi.advanceTimersByTime(9_000); });
      expect(screen.getByText('The iPad reconnected with its passkey')).toBeVisible();
    } finally { vi.useRealTimers(); }
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Mobile access' })).toBeVisible();
    await waitFor(() => expect(into).toHaveBeenCalled());
    expect(into.mock.contexts.at(-1)).toBe(screen.getByRole('article', { name: 'iPad · Safari' }));
    const tab = within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: /^Mobile access/ });
    expect(within(tab).getAllByRole('img').map(i => i.getAttribute('aria-label'))).toEqual(['A passkey reconnection to check']);
    // The well's « Revoke » opens the confirmation inside Settings, where Escape cancels it and leaves the page open.
    const ipad = () => within(screen.getByRole('article', { name: 'iPad · Safari' }));
    fireEvent.click(ipad().getByRole('button', { name: 'Revoke' }));
    expect(ipad().getByRole('alert')).toHaveTextContent('Revoke iPad · Safari?');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(ipad().queryByRole('alert')).toBeNull());
    expect(screen.getByRole('button', { name: 'It was me' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Mobile access' })).toBeVisible();
  });

  it('5 b: « refused » toasts with the warn look and goes after 10 s; « blocked » toasts nothing', async () => {
    const { d } = await boot({ projects: TWO_PROJECTS });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      d.push({ type: 'mobile', state: { ...ONLINE, devices: [{ ...IPAD, refused: { at: todayAt(18, 12) } }] } });
      d.push({ type: 'mobile.recovery', event: 'blocked', at: todayAt(18, 20) });
      d.push({ type: 'mobile.recovery', event: 'refused', id: 'fp-ipad', at: todayAt(18, 12) });
      const text = await screen.findByText("Passkey reconnection as the iPad refused: it's connected");
      expect(text.parentElement).toHaveClass('undo-toast', 'warn');
      expect(screen.getByRole('button', { name: 'View' })).toBeVisible();
      act(() => { vi.advanceTimersByTime(10_100); });
      expect(screen.queryByText("Passkey reconnection as the iPad refused: it's connected")).toBeNull();
    } finally { vi.useRealTimers(); }
    expect(screen.queryByText(/Passkey reconnection blocked/)).toBeNull();
  });
});
