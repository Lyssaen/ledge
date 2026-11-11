import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PhoneServerMessage, PhoneSession } from '@ledge/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copy, setLang } from '../../src/copy';
import { getAssertion, platformAvailable } from '../../src/link/webauthn';
import { LAUNCH_TIMEOUT_MS, NewSession } from '../../src/screens/NewSession';
import { href } from '../../src/router';
import { RESEND_MAX_MS } from '../../src/state/operations';
import { Sessions } from '../../src/screens/Sessions';
import { Thread } from '../../src/screens/Thread';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(), createCredential: vi.fn(), getAssertion: vi.fn() }));

const assertion = { id: 'AQ', clientDataJSON: 'AQI', authenticatorData: 'Aw', signature: 'BAU' };
const challenge: PhoneServerMessage = { type: 'confirm.challenge', purpose: 'launch', challenge: 'Y2hhbGw', rpId: 'relay.example', credentialId: 'AQ', expiresInMs: 60_000 };
const ROOT = '/home/u/code/ledge';
const FOLDERS = [
  { machine: 'local', path: ROOT, exists: true, branch: 'main' },
  { machine: 'local', path: '/home/u/code/mobile-refonte', exists: true, branch: 'design/mobile-refonte-m0-m1' },
  { machine: 'local', path: '/home/u/code/dev-back-mobile-launch', exists: false },
  { machine: 'legion', label: 'Legion', path: '/home/u/ledge-legion' }
];

type Pc = { launch?: boolean; confirm?: boolean; sessions?: PhoneSession[]; boot?: string };
const snap = (o: Pc = {}) => ({
  ...snapshot(o.sessions ?? []),
  daemon: { version: '0.30.0', name: 'WSL', models: true, projectFolders: true, ...(o.launch === false ? {} : { launch: true }), ...(o.boot ? { boot: o.boot } : {}) },
  device: { confirm: o.confirm ?? true },
  projects: [{ id: 'ledge', name: 'ledge', color: 'blue' }, { id: 'billing', name: 'billing-api', color: 'green' }]
}) as PhoneServerMessage;

function opened(o: Pc = {}, t = setup()) {
  t.deliver(snap(o));
  const view = render(<NewSession store={t.store} storage={t.storage} />);
  act(() => t.deliver({ type: 'project.folders', id: 'ledge', folders: FOLDERS } as PhoneServerMessage));
  return { ...t, view };
}
const button = () => screen.getByRole('button', { name: /^(Lancer|Écris|Choisis|Aucune|Protège|WSL ne lance|Lancement)/ });
const type = (text: string) => fireEvent.change(screen.getByLabelText('Premier message'), { target: { value: text } });
/** « Lancer », the PC's challenge, the device's assertion: the launch leaves. */
async function launched(t: ReturnType<typeof opened>) {
  vi.mocked(getAssertion).mockResolvedValue(assertion);
  fireEvent.click(button());
  await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
  act(() => t.deliver(challenge));
  await waitFor(() => expect(t.of('session.launch')).toHaveLength(1));
  return t.of('session.launch')[0]!;
}
const result = (t: ReturnType<typeof opened>, op: string, status: 'applied' | 'rejected' | 'failed', extra: object = {}) =>
  act(() => t.deliver({ type: 'operation.result', op, status, ...extra } as PhoneServerMessage));

beforeEach(() => {
  vi.mocked(platformAvailable).mockResolvedValue(true);
  vi.mocked(getAssertion).mockReset();
  Object.defineProperty(globalThis.navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 15)', configurable: true });
  globalThis.location.hash = '#/new';
});
afterEach(() => { vi.useRealTimers(); setLang('fr'); });

describe('« Nouvelle session » (m2-sessions.html §9)', () => {
  it('fills itself: the first project and its machine, its folder on its branch, Claude Code, the default model', () => {
    opened();
    expect(screen.getByRole('banner')).toHaveTextContent('Nouvelle session');
    expect(screen.getByRole('button', { name: /ledge.*WSL/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sur main, dans le dossier du projet/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Claude Code/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Par défaut/ })).toBeInTheDocument();
    expect(screen.queryByText('Permissions')).not.toBeInTheDocument();
  });

  it('says what is missing until there is an instruction, then launches with the device', () => {
    opened();
    expect(button()).toHaveTextContent('Écris la consigne');
    expect(button()).toBeDisabled();
    type('Corrige les tests');
    expect(button()).toHaveTextContent('Lancer avec mon appareil');
    expect(button()).toBeEnabled();
    expect(screen.getByText('Claude Code sur WSL, dans ledge')).toBeInTheDocument();
  });

  it('an idea fills the first message', () => {
    opened();
    fireEvent.click(screen.getByRole('button', { name: 'Corriger les tests qui échouent' }));
    expect(screen.getByLabelText('Premier message')).toHaveValue('Corriger les tests qui échouent');
  });

  it.each([
    [{ launch: false }, 'WSL ne lance pas encore depuis le téléphone', /arrive avec une prochaine version/],
    [{ confirm: false }, 'Protège d’abord tes accords', /Lancer demande la passkey de cet appareil/]
  ] as const)('a PC or a device that cannot launch: the button says why (%o)', (o, label, body) => {
    opened(o);
    type('Corrige les tests');
    expect(button()).toHaveTextContent(label);
    expect(button()).toBeDisabled();
    expect(screen.getByText(body)).toBeInTheDocument();
  });

  it('without protected agreements, a way to Réglages', () => {
    opened({ confirm: false });
    expect(screen.getByRole('link', { name: 'Ouvrir Réglages' })).toHaveAttribute('href', '#/connection/link');
  });

  it('offline: the project greyed « hors ligne », the button « Aucune machine en ligne »', () => {
    const t = opened();
    type('Corrige les tests');
    act(() => t.set('pc_offline'));
    expect(button()).toHaveTextContent('Aucune machine en ligne');
    expect(screen.getByRole('button', { name: /WSL · hors ligne/ })).toBeInTheDocument();
  });

  it('Où travailler keeps a missing folder and another machine’s, disabled, with their reason (m2-lancement.html §1)', () => {
    opened();
    fireEvent.click(screen.getByRole('button', { name: /Sur main/ }));
    const sheet = within(screen.getByRole('dialog', { name: 'Où travailler' }));
    expect(sheet.getByText('Les dossiers que le projet ledge déclare')).toBeInTheDocument();
    expect(sheet.getByRole('button', { name: /Le dossier du projet/ })).toHaveAttribute('aria-pressed', 'true');
    expect(sheet.getByRole('button', { name: /dev-back-mobile-launch.*Introuvable sur WSL/ })).toBeDisabled();
    expect(sheet.getByRole('button', { name: /ledge-legion.*Sur Legion : ce téléphone ne lance que sur WSL/ })).toBeDisabled();
    expect(sheet.getByText(/Codex et Cursor Agent ne prennent qu’un dossier/)).toBeInTheDocument();
  });

  it('Claude Code takes several folders, « + 1 » in the field; Codex keeps the first only', async () => {
    const t = opened();
    fireEvent.click(screen.getByRole('button', { name: /Sur main/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /mobile-refonte/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('Sur main, dans le dossier du projet et 1 autre dossier')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Codex/ }));
    expect(screen.queryByText(/et 1 autre dossier/)).not.toBeInTheDocument();
    type('Corrige les tests');
    const m = await launched(t);
    expect(m.launch).toEqual({ project: 'ledge', tool: 'codex', folders: [ROOT], prompt: 'Corrige les tests' });
  });

  it('OMP adds Permissions, « Demander » by default and not sent; another choice is (Q78 B)', async () => {
    const t = opened();
    fireEvent.click(screen.getByRole('button', { name: /OMP/ }));
    expect(screen.getByText('Avant chaque écriture ou commande')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Fichiers auto' }));
    expect(screen.getByText('Écrit sans demander, demande avant les commandes')).toBeInTheDocument();
    type('Corrige les tests');
    const m = await launched(t);
    expect(m.launch.approval).toBe('write');
  });

  it('the device check covers this very launch, then « Lancement… », then the new session’s thread', async () => {
    const t = opened();
    type('  Corrige les tests  ');
    const m = await launched(t);
    expect(t.of('confirm.prepare')[0]).toMatchObject({ purpose: 'launch', launch: { project: 'ledge', tool: 'claude', folders: [ROOT], prompt: 'Corrige les tests' } });
    expect(m).toMatchObject({ launch: t.of('confirm.prepare')[0]!.launch, assertion });
    expect(button()).toHaveTextContent('Lancement…');
    result(t, m.op, 'applied', { id: 's9' });
    expect(globalThis.location.hash).toBe('#/thread/s9');
    expect(t.storage.getItem('ledge.mobile.launch.draft')).toBeNull();
  });

  it('the new session’s thread starts with where it sits, kept on this phone', async () => {
    const t = opened();
    type('Corrige les tests');
    const m = await launched(t);
    result(t, m.op, 'applied', { id: 's9' });
    t.view.unmount();
    act(() => t.deliver(snap({ sessions: [session('s9', { name: 'Nova', project: 'ledge' })] })));
    render(<Thread store={t.store} sessionId="s9" storage={t.storage} />);
    act(() => t.deliver({ type: 'session.thread', id: 's9', items: [], cut: [], more: false }));
    expect(screen.getByText('Nova démarre à la table ledge.')).toBeInTheDocument();
  });

  it('the last choice is kept per project and said under it', async () => {
    const t = opened();
    fireEvent.click(screen.getByRole('button', { name: /Codex/ }));
    type('Corrige les tests');
    result(t, (await launched(t)).op, 'applied', { id: 's9' });
    t.view.unmount();
    render(<NewSession store={t.store} storage={t.storage} />);
    expect(screen.getByRole('button', { name: /Codex/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /WSL · Dernier choix pour ce projet retenu/ })).toBeInTheDocument();
  });

  it('« Fermer » keeps the draft for the next opening', () => {
    const t = opened();
    type('Corrige les tests');
    t.view.unmount();
    render(<NewSession store={t.store} storage={t.storage} />);
    expect(screen.getByLabelText('Premier message')).toHaveValue('Corrige les tests');
  });

  it('the check cancelled: said under the button, nothing sent', async () => {
    const t = opened();
    type('Corrige les tests');
    vi.mocked(getAssertion).mockResolvedValue('cancelled');
    fireEvent.click(button());
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    act(() => t.deliver(challenge));
    expect(await screen.findByText('Vérification annulée. Rien n’a été lancé.')).toBeInTheDocument();
    expect(t.of('session.launch')).toHaveLength(0);
  });

  describe('a refusal keeps the form and says why (m2-lancement.html §2)', () => {
    it.each([
      ['not_found', 'Démarrage refusé : le dossier est introuvable', 'Rien n’a été lancé. Ton message est conservé.'],
      ['invalid', 'Démarrage refusé : le PC n’accepte pas ces choix', /ne convient pas à Claude Code/],
      ['unavailable', 'Démarrage refusé : WSL ne lance pas depuis le téléphone', 'Mets à jour Ledge sur le PC. Ton message est conservé.'],
      ['conflict', 'Démarrage refusé', 'Rien n’a été lancé. Ton message est conservé.']
    ] as const)('%s', async (reason, title, body) => {
      const t = opened();
      type('Corrige les tests');
      result(t, (await launched(t)).op, 'rejected', { reason });
      const receipt = screen.getByText(title).closest('[data-receipt]')!;
      expect(within(receipt as HTMLElement).getByText(body)).toBeInTheDocument();
      expect(screen.getByLabelText('Premier message')).toHaveValue('Corrige les tests');
    });

    it('stale reloads the projects’ folders by itself', async () => {
      const t = opened();
      type('Corrige les tests');
      const before = t.of('project.folders').length;
      result(t, (await launched(t)).op, 'rejected', { reason: 'stale' });
      expect(screen.getByText('Démarrage refusé : le projet a changé sur le PC')).toBeInTheDocument();
      expect(t.of('project.folders').length).toBe(before + 1);
    });

    it('confirm_required leads to Réglages', async () => {
      const t = opened();
      type('Corrige les tests');
      result(t, (await launched(t)).op, 'rejected', { reason: 'confirm_required' });
      expect(screen.getByRole('link', { name: 'Réglages' })).toHaveAttribute('href', '#/connection/link');
    });

    it('a failed start: Réessayer checks again and sends a new launch', async () => {
      const t = opened();
      type('Corrige les tests');
      const first = await launched(t);
      result(t, first.op, 'failed');
      expect(screen.getByText('Le PC n’a pas pu démarrer Claude Code')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(2));
      act(() => t.deliver(challenge));
      await waitFor(() => expect(t.of('session.launch')).toHaveLength(2));
      expect(t.of('session.launch')[1]!.op).not.toBe(first.op);
    });

    it('a field changed clears the receipt', async () => {
      const t = opened();
      type('Corrige les tests');
      result(t, (await launched(t)).op, 'rejected', { reason: 'not_found' });
      type('Corrige les tests du terminal');
      expect(screen.queryByText('Démarrage refusé : le dossier est introuvable')).not.toBeInTheDocument();
    });
  });

  it('no answer in 20 s: « n’a pas répondu », and Réessayer sends the same launch again, without a check', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t = opened();
    type('Corrige les tests');
    const m = await launched(t);
    act(() => { vi.advanceTimersByTime(LAUNCH_TIMEOUT_MS - 100); });
    expect(screen.queryByText('Le démarrage n’a pas répondu.')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText('Le démarrage n’a pas répondu.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(t.of('session.launch')).toHaveLength(2);
    expect(t.of('session.launch')[1]).toEqual(m);
    expect(t.of('confirm.prepare')).toHaveLength(1);
    expect(button()).toHaveTextContent('Lancement…');
  });

  describe('a launch the PC took, then lost with its answer, is never presented as refused (review 688eb599)', () => {
    /** Sent (and `received`, unless that was lost too) under `b1`, the link lost before the outcome, back on a PC that booted `boot`. */
    async function lostAfterReceipt(boot: string, received = true) {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const t = opened({ boot: 'b1' });
      type('Corrige les tests');
      const m = await launched(t);
      if (received) act(() => t.deliver({ type: 'operation.result', op: m.op, status: 'received' } as PhoneServerMessage));
      act(() => t.set('pc_offline'));
      act(() => t.set('ready'));
      act(() => t.deliver(snap({ boot })));
      act(() => { vi.advanceTimersByTime(LAUNCH_TIMEOUT_MS + 100); });
      expect(screen.getByText(copy.launch.timeout)).toBeInTheDocument();
      return { t, m };
    }

    it('the PC restarted: the same launch is not sent again, no new one is checked, no Réessayer', async () => {
      const { t } = await lostAfterReceipt('b2');
      expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
      expect(t.of('session.launch')).toHaveLength(1);
      expect(t.of('confirm.prepare')).toHaveLength(1);
      expect(screen.queryByText(/Démarrage refusé/)).not.toBeInTheDocument();
    });

    it('its receipt (Q88): check Sessions before launching again, « Voir les sessions » opens Sessions, the form stays filled', async () => {
      await lostAfterReceipt('b2');
      expect(screen.getByText('La session a peut-être démarré : vérifie dans Sessions avant de relancer.')).toBeInTheDocument();
      expect(screen.queryByText('Vérifie la machine puis réessaie.')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Voir les sessions' })).toHaveAttribute('href', href({ name: 'sessions' }));
      expect(screen.getByLabelText('Premier message')).toHaveValue('Corrige les tests');
    });

    it('its receipt in English', () => {
      setLang('en');
      expect(copy.launch.lostBody).toBe('The session may have started: check Sessions before launching again.');
      expect(copy.atoi.seeSessions).toBe('See the sessions');
    });

    it('the PC restarted and its « received » was lost too: not sent again, by itself or by Réessayer', async () => {
      const { t } = await lostAfterReceipt('b2', false);
      expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
      expect(t.of('session.launch')).toHaveLength(1);
      expect(t.of('confirm.prepare')).toHaveLength(1);
    });

    it('control: the same PC process, Réessayer sends the same launch again', async () => {
      const { t, m } = await lostAfterReceipt('b1');
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      expect(t.of('session.launch').at(-1)).toEqual(m);
      expect(t.of('confirm.prepare')).toHaveLength(1);
    });

    it('past the replay window, Réessayer neither sends it again nor checks a new one, and goes', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const t = opened({ boot: 'b1' });
      type('Corrige les tests');
      const m = await launched(t);
      act(() => t.deliver({ type: 'operation.result', op: m.op, status: 'received' } as PhoneServerMessage));
      act(() => { vi.advanceTimersByTime(LAUNCH_TIMEOUT_MS + 100); });
      expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(RESEND_MAX_MS); });
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      expect(t.of('session.launch')).toHaveLength(1);
      expect(t.of('confirm.prepare')).toHaveLength(1);
      expect(screen.getByText('Le démarrage n’a pas répondu.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
    });
  });

  it('in English, Desktop’s words', () => {
    setLang('en');
    opened();
    expect(screen.getByRole('button', { name: /On main, in the project folder/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review the latest pull request' })).toBeInTheDocument();
  });
});

describe('« Nouvelle » in Sessions (m2-sessions.html §1)', () => {
  it('in the head, and in an empty list', () => {
    const t = setup();
    t.deliver(snap());
    render(<Sessions store={t.store} storage={t.storage} />);
    expect(screen.getByRole('link', { name: 'Nouvelle' })).toHaveAttribute('href', '#/new');
    expect(screen.getByRole('link', { name: 'Nouvelle session' })).toHaveAttribute('href', '#/new');
  });
});
