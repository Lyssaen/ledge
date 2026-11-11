import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HumanAsk, PhoneServerMessage, PhoneSession } from '@ledge/protocol';
import { generateIdentity } from '@ledge/seal';
import type { PinnedPc } from '../../src/link/keys';
import { getAssertion, platformAvailable } from '../../src/link/webauthn';
import { Inbox } from '../../src/screens/Inbox';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { app } from './app-setup';
import { setup } from './setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(async () => false), createCredential: vi.fn(), getAssertion: vi.fn(), getDiscoverable: vi.fn() }));

const at = (min: number) => new Date(Date.parse('2026-10-14T10:00:00.000Z') + min * 60_000).toISOString();
const wide = (on: boolean) => { globalThis.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia; };
beforeEach(() => { vi.mocked(platformAvailable).mockResolvedValue(false); vi.mocked(getAssertion).mockReset(); });
afterEach(() => { wide(false); localStorage.clear(); });

const ask = (id: string, extra: Partial<HumanAsk> = {}): HumanAsk => ({
  id, kind: 'decision', alert: false, priority: 'routine', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: 'pilot.lead' },
  summary: 'Fusionner le lot 10 maintenant ?', body: '', bodyTruncated: false, detail: null, evidenceRef: null,
  questions: [{ id: 'q', question: 'Fusionner ?', options: [{ id: 'now', label: 'Fusionner maintenant', recommended: true }, { id: 'wait', label: 'Attendre la relecture', recommended: false }] }],
  createdAt: at(0), updatedAt: at(0), ...extra
} as HumanAsk);
const withOpenRig = (m: PhoneServerMessage, device?: object) => ({ ...m, daemon: { ...(m as { daemon: object }).daemon, openrig: true }, ...(device ? { device } : {}) }) as PhoneServerMessage;
const asks = (list: HumanAsk[], channel: Partial<{ state: string }> = {}, partial = false): PhoneServerMessage =>
  ({ type: 'openrig.asks', channel: { state: 'ready', person: null, slack: false, ...channel }, asks: list, ...(partial ? { partial: true } : {}) }) as PhoneServerMessage;
const perm = (id: string, name: string, extra: Partial<PhoneSession> = {}) =>
  session(id, { name, state: 'waiting_permission', pending: pending({ key: `k${id}`, text: `pnpm build ${id}` }), ...extra });

describe('« À toi » on a phone (m1-a-toi.html §1)', () => {
  it('shows the sessions\' requests as cards, the oldest first, with the count', () => {
    const t = setup();
    t.deliver(snapshot([
      perm('a', 'Kai', { lastActivityAt: at(5) }),
      session('b', { name: 'Ada', state: 'waiting_input', lastActivityAt: at(0), pending: pending({ key: 'kb', kind: 'question', text: 'Quelle base ?', options: ['sqlite', 'postgres'] }) }),
      session('c', { name: 'Idle' })
    ]));
    render(<Inbox store={t.store} />);
    const cards = screen.getAllByRole('article');
    expect(cards.map(c => c.getAttribute('aria-label'))).toEqual(['Question de Ada, x', 'Autorisation de Kai, x']);
    expect(screen.getByText('2 demandes')).toBeInTheDocument();
    expect(within(cards[0]!).getByRole('button', { name: 'sqlite' })).toBeInTheDocument();
    expect(within(cards[1]!).getByRole('button', { name: 'Toujours dans ce projet' })).toBeInTheDocument();
  });

  it('decides in place: the card turns into a receipt that says so', () => {
    const t = setup();
    t.deliver(snapshot([perm('a', 'Kai')]));
    render(<Inbox store={t.store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Autoriser' }));
    const [sent] = t.of('session.decide');
    expect(sent).toMatchObject({ id: 'a', decision: 'accept', expect: { key: 'ka' } });
    expect(screen.getByText('Transmission au PC…')).toBeInTheDocument();
    act(() => t.deliver({ type: 'operation.result', op: sent!.op, status: 'applied' }));
    expect(screen.getByRole('status')).toHaveTextContent('Autorisée · Kai');
    expect(screen.getByRole('link', { name: 'Voir le fil' })).toHaveAttribute('href', '#/thread/a');
  });

  it('a high-impact accept is left to the PC without protected accepts; refusing stays here', () => {
    const t = setup();
    t.deliver(snapshot([session('a', { name: 'Pim', state: 'waiting_permission', pending: pending({ key: 'ka', text: 'git push --force', risk: 'high', riskReason: 'pushes' }) })]));
    render(<Inbox store={t.store} />);
    expect(screen.getByRole('button', { name: 'À accepter sur le PC' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refuser' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Toujours dans ce projet' })).toBeNull();
  });

  it('a request replaced while on screen keeps its place, read again before deciding (§6)', () => {
    const t = setup();
    t.deliver(snapshot([perm('a', 'Pim')]));
    render(<Inbox store={t.store} />);
    act(() => t.deliver(snapshot([session('a', { name: 'Pim', state: 'waiting_permission', pending: pending({ key: 'ka2', text: 'pnpm build e2e' }) })])));
    expect(screen.getByText('pnpm build e2e')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Autoriser' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /J’ai relu|J'ai relu/ }));
    expect(screen.getByRole('button', { name: 'Autoriser' })).toBeEnabled();
  });

  it('nothing waiting and nothing working: the calm state and the way to Sessions (§7)', () => {
    const t = setup();
    t.deliver(snapshot([session('c')]));
    render(<Inbox store={t.store} />);
    expect(screen.getByRole('heading', { name: 'Rien ne t’attend.' })).toBeInTheDocument();
    expect(screen.getByText('Aucune session ne travaille non plus pour l’instant.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Voir les sessions/ })).toHaveAttribute('href', '#/sessions');
  });

  it('nothing waiting while sessions work: « En cours », five at most, then the others (Q13)', () => {
    const t = setup();
    const working = Array.from({ length: 7 }, (_, i) => session(`w${i}`, { name: `W${i}`, state: 'working', lastActivityAt: at(i), lastReply: { text: `étape ${i}\nsuite`, at: at(i) } }));
    t.deliver(snapshot(working));
    render(<Inbox store={t.store} />);
    expect(screen.getByText(/Les nouvelles demandes arrivent ici/)).toBeInTheDocument();
    const lines = within(screen.getByRole('region', { name: 'En cours' })).getAllByRole('link');
    expect(lines.map(l => l.getAttribute('href'))).toEqual(['#/thread/w6', '#/thread/w5', '#/thread/w4', '#/thread/w3', '#/thread/w2', '#/sessions']);
    expect(screen.getByText('étape 6')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Voir les 2 autres/ })).toBeInTheDocument();
  });

  it('brings the filter chips back from 6 requests, « Rigs » among them (Q16)', () => {
    const t = setup();
    t.deliver(withOpenRig(snapshot([1, 2, 3, 4].map(i => perm(`p${i}`, `P${i}`)).concat(session('q', { name: 'Ada', state: 'waiting_input', pending: pending({ key: 'kq', kind: 'question', text: 'Quelle base ?' }) })))));
    render(<Inbox store={t.store} />);
    expect(screen.queryByRole('group', { name: 'Filtrer les demandes' })).toBeNull();
    act(() => t.deliver(asks([ask('r1')])));
    const chips = screen.getByRole('group', { name: 'Filtrer les demandes' });
    expect(within(chips).getAllByRole('button').map(b => b.textContent)).toEqual(['Tout6', 'Autorisations4', 'Questions1', 'Rigs OpenRig1']);
    fireEvent.click(within(chips).getByRole('button', { name: /Questions/ }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Quelle base ?')).toBeInTheDocument();
  });

  it('offline: the last known requests, nothing can be sent', () => {
    const t = setup();
    t.deliver(snapshot([perm('a', 'Kai')]));
    render(<Inbox store={t.store} />);
    act(() => t.set('pc_offline'));
    expect(screen.getByText('pnpm build a')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Autoriser' })).toBeDisabled();
    expect(screen.getByText('Tu peux consulter les demandes. Aucune décision ne sera envoyée hors connexion.')).toBeInTheDocument();
  });
});

describe('OpenRig\'s asks in « À toi » (§2, m1-reponses-rig.html)', () => {
  it('lists them under « Rigs OpenRig », the recommended option first', () => {
    const t = setup();
    t.deliver(withOpenRig(snapshot([])));
    t.deliver(asks([ask('r1')]));
    render(<Inbox store={t.store} />);
    expect(screen.getByRole('heading', { name: /Rigs OpenRig/ })).toBeInTheDocument();
    const card = screen.getByRole('article', { name: 'Demande de pilot-lead, ledge-dev' });
    expect(within(card).getAllByRole('button').map(b => b.textContent)).toEqual(['Fusionner maintenantrecommandé', 'Attendre la relecture', 'Répondre autrement…']);
  });

  it('without protected accepts: the options are greyed, the card says where to answer (Q64)', () => {
    const t = setup();
    t.deliver(withOpenRig(snapshot([]), { confirm: false }));
    t.deliver(asks([ask('r1')]));
    render(<Inbox store={t.store} />);
    expect(screen.getByRole('button', { name: /Fusionner maintenant/ })).toBeDisabled();
    expect(screen.getByText('Une réponse à un rig se confirme avec cet appareil. Tu peux la donner sur le PC.')).toBeInTheDocument();
  });

  it('with protected accepts: a choice asks the device\'s check over that exact answer, then sends it (Q63)', async () => {
    vi.mocked(platformAvailable).mockResolvedValue(true);
    const assertion = { id: 'AQ', clientDataJSON: 'AQ', authenticatorData: 'AQ', signature: 'AQ' };
    vi.mocked(getAssertion).mockResolvedValue(assertion as never);
    const t = setup();
    t.deliver(withOpenRig(snapshot([]), { confirm: true }));
    t.deliver(asks([ask('r1')]));
    render(<Inbox store={t.store} />);
    const option = await screen.findByRole('button', { name: /Fusionner maintenant/ });
    await waitFor(() => expect(option).toBeEnabled());
    fireEvent.click(option);
    // The passkey update card asks its own (`register`) challenge beside it.
    await waitFor(() => expect(t.of('confirm.prepare').filter(m => m.purpose === 'rig')).toEqual([expect.objectContaining({ purpose: 'rig', qitem: 'r1', answer: { kind: 'choice', questionId: 'q', optionId: 'now' } })]));
    act(() => t.deliver({ type: 'confirm.challenge', purpose: 'rig', challenge: 'Y2hhbGw', rpId: 'relay.example', credentialId: 'AQ', expiresInMs: 60_000 }));
    await waitFor(() => expect(t.of('openrig.answer')).toEqual([expect.objectContaining({ qitemId: 'r1', answer: { kind: 'choice', questionId: 'q', optionId: 'now' }, assertion })]));
    const sent = t.of('openrig.answer')[0]!;
    act(() => t.deliver({ type: 'openrig.answered', op: sent.op, qitemId: 'r1', ok: true, outcome: 'answered' }));
    expect(await screen.findByText('Envoyé à pilot-lead')).toBeInTheDocument();
  });

  it('« Vu » goes without a check, even on a device without protected accepts', () => {
    const t = setup();
    t.deliver(withOpenRig(snapshot([]), { confirm: false }));
    t.deliver(asks([ask('n1', { kind: 'update', summary: 'Lot 9 relu', questions: [] })]));
    render(<Inbox store={t.store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Vu' }));
    expect(t.of('confirm.prepare')).toEqual([]);
    expect(t.of('openrig.answer')).toEqual([expect.objectContaining({ qitemId: 'n1', answer: { kind: 'seen' } })]);
  });

  it('says why no ask can come, with Desktop\'s words (Q66)', () => {
    const t = setup();
    t.deliver(withOpenRig(snapshot([])));
    t.deliver(asks([], { state: 'no_person' }));
    render(<Inbox store={t.store} />);
    expect(screen.getByText('Ledge n’est pas encore le canal humain d’OpenRig.')).toBeInTheDocument();
    act(() => t.deliver(asks([], { state: 'not_installed' })));
    expect(screen.getByText('OpenRig n’est pas installé sur Atelier.')).toBeInTheDocument();
  });

  it('a ready channel with nothing asked shows no section', () => {
    const t = setup();
    t.deliver(withOpenRig(snapshot([])));
    t.deliver(asks([]));
    render(<Inbox store={t.store} />);
    expect(screen.queryByRole('heading', { name: /Rigs OpenRig/ })).toBeNull();
  });
});

describe('« À toi » on a tablet (§12)', () => {
  beforeEach(() => wide(true));

  it('lists compact rows grouped Demandes, Rigs OpenRig, En cours, the open one lit', () => {
    globalThis.history.replaceState(null, '', '/#/request/a/ka');
    const t = setup();
    t.deliver(withOpenRig(snapshot([perm('a', 'Pim'), session('w', { name: 'Nova', state: 'working' })])));
    t.deliver(asks([ask('r1', { priority: 'urgent' })]));
    render(<Inbox store={t.store} />);
    const requests = screen.getByRole('region', { name: 'Demandes' });
    expect(within(requests).getByRole('link', { name: /Pim/ })).toHaveAttribute('aria-current', 'page');
    expect(within(screen.getByRole('region', { name: 'Rigs OpenRig' })).getByRole('link', { name: /pilot-lead/ })).toHaveAttribute('href', '#/ask/r1');
    expect(within(screen.getByRole('region', { name: 'En cours' })).getByRole('link', { name: /Nova/ })).toHaveAttribute('href', '#/thread/w');
    expect(screen.queryByRole('article')).toBeNull();
    globalThis.history.replaceState(null, '', '/#/');
  });
});

describe('« Mettre à jour ta passkey » stays at the top of « À toi »', () => {
  const pc: PinnedPc = { publicKey: 'K', fingerprint: 'abcdEFGHijklMNOPqrstuv', name: 'WSL', pinnedAt: '2026-10-16T08:00:00.000Z' };
  const withDevice = (sessions: PhoneSession[]) => ({ ...snapshot(sessions, 'WSL'), device: { id: 'dev1', confirm: true } }) as never;

  it.each([['a phone', false], ['a tablet', true]])('on %s, above the requests', async (_, isWide) => {
    wide(isWide);
    vi.mocked(platformAvailable).mockResolvedValue(true);
    const t = app('ready', { hash: '#/' });
    const real = { ...pc, publicKey: (await generateIdentity()).publicKey };
    act(() => t.setPinned(real));
    act(() => t.deliver(withDevice([perm('a', 'Kai')])));
    const card = await screen.findByRole('heading', { name: 'Mettre à jour ta passkey' });
    const first = isWide ? screen.getByRole('region', { name: 'Demandes' }) : screen.getByRole('article', { name: /Autorisation de Kai/ });
    expect(card.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
