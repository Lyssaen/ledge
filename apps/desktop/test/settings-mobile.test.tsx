import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_RELAY_URL, type MobileClientMessage, type MobileState } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { Mobile } from '../src/settings/Mobile';
import { clearPairingRequest, usePairingRequest } from '../src/settings/pairingRequest';
import type { SettingsContext } from '../src/settings/SettingsPage';
import { openUrl } from '../src/tauri/bridge';
import { machine } from './fleet-helpers';
import { boot, closeDaemons, TWO_PROJECTS } from './helpers';

vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), openUrl: vi.fn() }));

const OFF: MobileState = { enabled: false, relayUrl: DEFAULT_RELAY_URL, account: null, signin: null, signinError: null, link: { state: 'off' }, devices: [], pairings: [] };
const ACCOUNT = { login: 'octocat', accountId: '42' };
const ONLINE: MobileState = { ...OFF, enabled: true, account: ACCOUNT, link: { state: 'online' } };
const IPHONE = { id: 'fp-iphone', label: 'iPhone · Safari', approvedAt: '2026-10-19T08:00:00.000Z', online: true };

/** The section alone, in French, on a fake fleet whose `sendMobile` records (or throws `error`). */
function show(mobile: MobileState | undefined, opts: { error?: string; localUp?: boolean } = {}) {
  const sent: MobileClientMessage[] = [];
  const notes: string[] = [];
  const fleet = { sendMobile(msg: MobileClientMessage) { if (opts.error) throw Object.assign(new Error(opts.error), { name: opts.error }); sent.push(msg); } };
  const ctx = (m: MobileState | undefined) => ({ fleet, mobile: m, machines: [machine('local', { ready: opts.localUp ?? true })], notify: (t: string) => notes.push(t) }) as unknown as SettingsContext;
  const view = render(<LangProvider lang="fr"><Mobile ctx={ctx(mobile)} /></LangProvider>);
  const update = (m: MobileState | undefined) => view.rerender(<LangProvider lang="fr"><Mobile ctx={ctx(m)} /></LangProvider>);
  return { sent, notes, update, user: userEvent.setup() };
}
const field = () => screen.getByRole('textbox', { name: 'Serveur relais' });
const accessSwitch = () => screen.getByRole('switch', { name: 'Accès mobile' });
const card = (name: string) => within(screen.getByRole('region', { name }));

beforeEach(() => { vi.mocked(openUrl).mockClear(); clearPairingRequest(); });
afterEach(async () => { vi.useRealTimers(); await closeDaemons(); });

describe('Settings › Accès mobile', () => {
  it('disabled: the switch is off, the relay field and the GitHub button are disabled', () => {
    show(OFF);
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['Connexion', 'Appareils']);
    expect(accessSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(field()).toBeDisabled();
    expect(field()).toHaveValue(DEFAULT_RELAY_URL);
    expect(screen.getByRole('button', { name: 'Se connecter avec GitHub' })).toBeDisabled();
    expect(card('Connexion').getByRole('status')).toHaveTextContent('Désactivé');
  });

  it('the switch sends mobile.set with the relay URL the daemon holds', async () => {
    const { sent, user } = show(OFF);
    await user.click(accessSwitch());
    expect(sent).toEqual([{ type: 'mobile.set', enabled: true, relayUrl: DEFAULT_RELAY_URL }]);
  });

  it('sign-in: the code is shown, « Ouvrir… » opens the verification URI, « Copier le code » copies it, « Annuler » cancels', async () => {
    const expiresAt = new Date(Date.now() + 14 * 60_000).toISOString();
    const { sent, user } = show({ ...OFF, enabled: true, signin: { userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresAt } });
    expect(screen.getByLabelText('Code à saisir sur GitHub : W D J B, M J H T')).toHaveTextContent('WDJB-MJHT');
    expect(screen.getByText(/En attente de la confirmation sur GitHub… · expire dans 14 min/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Ouvrir github.com/login/device' }));
    expect(openUrl).toHaveBeenCalledWith('https://github.com/login/device');
    await user.click(screen.getByRole('button', { name: 'Copier le code' }));
    expect(await navigator.clipboard.readText()).toBe('WDJB-MJHT');
    expect(await screen.findByRole('button', { name: 'Copié' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(sent).toEqual([{ type: 'mobile.signin.cancel' }]);
  });

  it('signed in and online: the account, « Se déconnecter », « Connecté au relais »; no device: the empty note names the relay', async () => {
    const { sent, user } = show(ONLINE);
    expect(screen.getByText('@octocat')).toBeVisible();
    expect(screen.getByText('Connecté au relais')).toBeVisible();
    expect(card('Connexion').getByText('server.ledge.paradow.dev')).toBeVisible();
    expect(card('Appareils').getByText('Aucun appareil lié.')).toBeVisible();
    expect(card('Appareils').getByText('server.ledge.paradow.dev').tagName).toBe('CODE');
    await user.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(sent).toEqual([{ type: 'mobile.signout' }]);
  });

  it('link offline: « Hors ligne » with the countdown to retryAt, then the raw error in code; « Réessayer » sends mobile.retry', async () => {
    const retryAt = new Date(Date.now() + 30_000).toISOString();
    const { sent, user } = show({ ...ONLINE, link: { state: 'offline', retryAt, error: 'connect ECONNREFUSED 104.21.48.12:443' } });
    expect(screen.getByText(/^Hors ligne · nouvel essai dans (29|30) s$/)).toBeVisible();
    const raw = screen.getByText('connect ECONNREFUSED 104.21.48.12:443');
    expect(raw.tagName).toBe('CODE');
    expect(raw.parentElement).toHaveTextContent("Le serveur relais ne répond pas. Vérifiez l'adresse et votre connexion ; Ledge réessaie tout seul.");
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(sent).toEqual([{ type: 'mobile.retry' }]);
  });

  it('account not allowed: the refusal and « Réessayer avec un autre compte » (mobile.signin)', async () => {
    const { sent, user } = show({ ...OFF, enabled: true, signinError: 'not_allowed' });
    expect(screen.getByRole('alert')).toHaveTextContent("n'est pas autorisé sur ce serveur. Demandez à son administrateur de l'ajouter.");
    expect(screen.getByText('Le serveur a refusé ce compte.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Réessayer avec un autre compte' }));
    expect(sent).toEqual([{ type: 'mobile.signin' }]);
  });

  it('signed out by the relay: another PC, or a session no longer valid; « Se reconnecter » signs in again', async () => {
    const { sent, update, user } = show({ ...ONLINE, link: { state: 'signed_out', reason: 'other_pc' } });
    expect(screen.getByRole('alert')).toHaveTextContent("Ce PC a été déconnecté : un autre PC s'est connecté avec ce compte. Un compte n'a qu'un PC.");
    expect(screen.getByText('Un autre PC a pris la place de celui-ci.')).toBeVisible();
    update({ ...ONLINE, link: { state: 'signed_out', reason: 'session_invalid' } });
    expect(screen.getByRole('alert')).toHaveTextContent("Ce PC a été déconnecté : la session n'est plus valide.");
    expect(screen.getByText("La session n'est plus valide.")).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Se reconnecter' }));
    expect(sent).toEqual([{ type: 'mobile.signin' }]);
  });

  it('a device: « Révoquer » asks inline, « Annuler » sends nothing, « Révoquer » in the confirmation sends mobile.device.revoke', async () => {
    const { sent, user } = show({ ...ONLINE, devices: [IPHONE, { id: 'fp-ipad', label: 'iPad · Safari', approvedAt: '2026-10-02T08:00:00.000Z', online: false, lastSeenAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }] });
    const iphone = within(screen.getByRole('article', { name: 'iPhone · Safari' }));
    expect(iphone.getByText('En ligne')).toBeVisible();
    expect(iphone.getByText('Lié le 19 oct. 2026')).toBeVisible();
    expect(within(screen.getByRole('article', { name: 'iPad · Safari' })).getByText('Vu il y a 3 j')).toBeVisible();
    await user.click(iphone.getByRole('button', { name: 'Révoquer' }));
    expect(screen.getByRole('alert')).toHaveTextContent("Révoquer iPhone · Safari ? Il perd l'accès tout de suite et devra être lié à nouveau pour revenir.");
    await user.click(iphone.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(sent).toEqual([]);
    await user.click(iphone.getByRole('button', { name: 'Révoquer' }));
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Révoquer' }));
    expect(sent).toEqual([{ type: 'mobile.device.revoke', id: 'fp-iphone' }]);
    expect(screen.getByText(/est révoqué/).closest('[role=status]')).toHaveTextContent('iPhone · Safari est révoqué.');
  });

  it('disabled with linked devices: they are said unable to connect, and none shows online', () => {
    show({ ...OFF, devices: [IPHONE] });
    expect(card('Appareils').getByText("L'accès mobile est désactivé : vos appareils liés ne peuvent pas se connecter.")).toBeVisible();
    expect(within(screen.getByRole('article', { name: 'iPhone · Safari' })).queryByText('En ligne')).toBeNull();
  });

  it('a pairing waiting for the code: « Comparer le code » asks for the dialog of that pairing', async () => {
    const seen: (string | undefined)[] = [];
    function Probe() { seen.push(usePairingRequest()?.id); return null; }
    render(<Probe />);
    const { user } = show({ ...ONLINE, pairings: [{ id: 'p1', label: 'Pixel · Chrome', code: '482913', expiresAt: new Date(Date.now() + 272_000).toISOString(), state: 'confirm' }] });
    const row = within(screen.getByRole('article', { name: "Pixel · Chrome demande l'accès" }));
    expect(row.getByText('En attente')).toBeVisible();
    expect(row.getByText('Connecté avec @octocat')).toBeVisible();
    await user.click(row.getByRole('button', { name: 'Comparer le code' }));
    expect(seen.at(-1)).toBe('p1');
  });

  it('relay URL: an http address is refused under the field and nothing is sent; a valid one is sent on Enter as its origin', async () => {
    const { sent, user } = show(ONLINE);
    await user.clear(field());
    await user.type(field(), 'http://relay.example');
    await user.tab();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toBeVisible();
    expect(sent).toEqual([]);
    await user.clear(field());
    await user.type(field(), 'https://relay.example/{Enter}');
    expect(sent).toEqual([{ type: 'mobile.set', enabled: true, relayUrl: 'https://relay.example' }]);
    expect(field()).toHaveAttribute('aria-invalid', 'false');
    await user.tab();
    expect(sent).toHaveLength(1);
  });

  it('a daemon that does not know mobile access: one card says to update it', () => {
    show(undefined);
    expect(screen.getByRole('status')).toHaveTextContent('Le daemon local est trop ancien pour l’accès mobile : mettez-le à jour.');
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('a command the fleet refuses is said in a toast', async () => {
    const { notes, user } = show(OFF, { error: 'DaemonOffline' });
    await user.click(accessSwitch());
    expect(notes).toEqual(['Le daemon local est hors ligne : rien n’a changé.']);
  });

  it('the offline countdown ticks', () => {
    vi.useFakeTimers({ now: new Date('2026-10-19T10:00:00.000Z') });
    show({ ...ONLINE, link: { state: 'offline', retryAt: '2026-10-19T10:00:30.000Z', error: 'x' } });
    expect(screen.getByText('Hors ligne · nouvel essai dans 30 s')).toBeVisible();
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.getByText('Hors ligne · nouvel essai dans 25 s')).toBeVisible();
  });
});

describe('the Mobile access section in the app', () => {
  it('sits between Machines and Projects, with its dots; its commands reach the local daemon', async () => {
    const { d, user } = await boot({ projects: TWO_PROJECTS });
    const retryAt = new Date(Date.now() + 30_000).toISOString();
    d.push({ type: 'mobile', state: { ...ONLINE, link: { state: 'offline', retryAt, error: 'x' }, pairings: [{ id: 'p1', label: 'Pixel · Chrome', code: '482913', expiresAt: retryAt, state: 'confirm' }] } });
    await user.keyboard('{Control>},{/Control}');
    await screen.findByRole('heading', { level: 1, name: 'General' });
    const nav = within(screen.getByRole('navigation', { name: 'Settings sections' }));
    expect(nav.getAllByRole('button').map(b => b.textContent).slice(6, 9)).toEqual(['Machines', 'Mobile access', 'Projects']);
    const tab = nav.getByRole('button', { name: /^Mobile access/ });
    await waitFor(() => expect(within(tab).getAllByRole('img').map(i => i.getAttribute('aria-label'))).toEqual(['Mobile access is offline', 'A device asks for access']));
    await user.click(tab);
    expect(await screen.findByRole('heading', { level: 1, name: 'Mobile access' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Mobile access' })).toHaveTextContent('Drive your agents from your phone, through the relay server.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'mobile.retry' }));
  });
});
