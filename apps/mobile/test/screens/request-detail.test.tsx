import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MESSAGE_MAX, type PhonePending, type PhoneSession } from '@ledge/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAssertion, platformAvailable } from '../../src/link/webauthn';
import { RequestDetail } from '../../src/screens/RequestDetail';
import type { MobileStore } from '../../src/state/store';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(), createCredential: vi.fn(), getAssertion: vi.fn() }));
beforeEach(() => { vi.mocked(platformAvailable).mockResolvedValue(false); });

function opened(p: PhonePending, extra: Partial<PhoneSession> = {}, props: { store?: (s: MobileStore) => MobileStore; onReconnect?: () => void } = {}) {
  const t = setup();
  const s = session('a', { name: 'Kai', topic: 'Inbox mobile', repo: 'ledge', branch: 'feat/x', state: 'waiting_permission', pending: p, ...extra });
  t.deliver(snapshot([s]));
  const store = props.store ? props.store(t.store) : t.store;
  const view = render(<RequestDetail store={store} sessionId="a" requestKey={p.key} {...(props.onReconnect ? { onReconnect: props.onReconnect } : {})} />);
  return { ...t, s, view };
}

/** The footer's parts in the order a reader meets them. */
const footerOrder = () => [...document.querySelectorAll('footer button, footer a, footer p')].map(e => e.textContent);

const question = (extra: Partial<PhonePending> = {}) => pending({ kind: 'question', text: 'Quel thème ?', options: ['Sombre', 'Clair'], riskReason: 'question', ...extra });

describe('the request detail', () => {
  it('asks the whole body of a shortened request, and shows it once it comes', () => {
    const t = opened(pending({ kind: 'plan', text: 'Plan', body: 'Étape 1', cut: true, riskReason: 'plan' }));
    expect(t.of('session.pending')).toEqual([{ type: 'session.pending', id: 'a' }]);
    act(() => t.deliver({ type: 'session.pending', id: 'a', pending: pending({ kind: 'plan', text: 'Plan', body: 'Étape 1\nÉtape 2 complète', riskReason: 'plan' }) }));
    expect(screen.getByText(/Étape 2 complète/)).toBeInTheDocument();
  });

  it('does not ask again a request it already has whole', () => {
    const t = opened(pending());
    expect(t.of('session.pending')).toEqual([]);
  });

  it('decides a low-risk command in one tap, then shows the result board', () => {
    const t = opened(pending({ text: 'pnpm test' }));
    expect(screen.getByText('pnpm test', { selector: 'pre' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Autoriser une fois' }));
    const [sent] = t.of('session.decide');
    expect(sent).toMatchObject({ id: 'a', decision: 'accept', expect: { key: 'p1', kind: 'permission', text: 'pnpm test' } });
    expect(screen.getByText('Transmission au PC…')).toBeInTheDocument();
    act(() => t.deliver({ type: 'operation.result', op: sent!.op, status: 'applied' }));
    expect(screen.getByRole('heading', { name: 'Autorisation prise en compte' })).toBeInTheDocument();
    expect(screen.getByText('Une décision transmise ne peut pas être annulée.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Retour aux demandes' })[0]).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir le fil de Kai' })).toHaveAttribute('href', '#/thread/a');
  });

  it('says a refusal was taken', () => {
    const t = opened(pending());
    fireEvent.click(screen.getByRole('button', { name: 'Refuser' }));
    act(() => t.deliver({ type: 'operation.result', op: t.of('session.decide')[0]!.op, status: 'applied' }));
    expect(screen.getByRole('heading', { name: 'Refus pris en compte' })).toBeInTheDocument();
  });

  it('goes to the new request when the PC says the one decided is stale, and asks to read it first', () => {
    const t = opened(pending({ text: 'pnpm test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Autoriser une fois' }));
    const op = t.of('session.decide')[0]!.op;
    act(() => t.deliver({ type: 'operation.result', op, status: 'rejected', reason: 'stale' }));
    act(() => t.deliver({ type: 'session.pending', id: 'a', pending: pending({ key: 'p2', text: 'pnpm build' }) }));
    expect(screen.getByText('pnpm build', { selector: 'pre' })).toBeInTheDocument();
    expect(screen.getByText('La demande a été mise à jour. Relisez-la avant de décider.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Autoriser une fois' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'J’ai relu la demande' }));
    fireEvent.click(screen.getByRole('button', { name: 'Autoriser une fois' }));
    expect(t.of('session.decide').at(-1)).toMatchObject({ decision: 'accept', expect: { key: 'p2', text: 'pnpm build' } });
  });

  it('says a request resolved on the PC was handled there', () => {
    const t = opened(pending());
    const { pending: _, ...rest } = t.s;
    act(() => t.deliver({ type: 'session.updated', session: { ...rest, state: 'idle' } }));
    expect(screen.getByRole('heading', { name: 'Déjà traitée sur le PC' })).toBeInTheDocument();
  });

  it('offline, keeps the last known request but sends nothing', () => {
    const t = opened(pending());
    act(() => t.set('pc_offline'));
    expect(screen.getByText('Connexion au PC perdue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refuser' })).toBeDisabled();
    expect(screen.getByText('Aucune décision ne sera envoyée hors connexion.')).toBeInTheDocument();
  });
});

describe('a question', () => {
  it('offers a free answer when the tool takes one, and sends it as typed', () => {
    const t = opened(question());
    expect(screen.getByRole('radio', { name: 'Sombre' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Autre réponse' }));
    fireEvent.change(screen.getByLabelText('Votre réponse à Kai'), { target: { value: '  Bleu nuit ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer ma réponse' }));
    expect(t.of('session.reply')).toMatchObject([{ id: 'a', text: 'Bleu nuit', expect: { key: 'p1', kind: 'question' } }]);
  });

  it('sends the number of the option chosen', () => {
    const t = opened(question());
    expect(screen.getByRole('button', { name: 'Envoyer ma réponse' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Clair' }));
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer ma réponse' }));
    expect(t.of('session.reply')).toMatchObject([{ text: '2' }]);
  });

  it('without a free answer, offers the options only and says why', () => {
    opened(question(), { tool: 'cursor' });
    expect(screen.queryByRole('radio', { name: 'Autre réponse' })).not.toBeInTheDocument();
    expect(screen.getByText(/ne peut pas recevoir de réponse libre/)).toBeInTheDocument();
  });

  it('takes a free answer as long as a message, and stops one longer before sending', () => {
    const t = opened(question());
    fireEvent.click(screen.getByRole('radio', { name: 'Autre réponse' }));
    const field = screen.getByLabelText('Votre réponse à Kai');
    fireEvent.change(field, { target: { value: 'x'.repeat(MESSAGE_MAX + 1) } });
    expect(screen.getByText(`La réponse est trop longue (${MESSAGE_MAX} caractères au plus).`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Envoyer ma réponse' })).toBeDisabled();
    fireEvent.change(field, { target: { value: 'x'.repeat(2500) } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer ma réponse' }));
    expect(t.of('session.reply')).toHaveLength(1);
  });

  it('flags a free answer the terminal cannot type', () => {
    const t = opened(question());
    fireEvent.click(screen.getByRole('radio', { name: 'Autre réponse' }));
    fireEvent.change(screen.getByLabelText('Votre réponse à Kai'), { target: { value: 'une\ndeux' } });
    expect(screen.getByRole('alert')).toHaveTextContent('La réponse doit tenir sur une ligne');
    expect(screen.getByRole('button', { name: 'Envoyer ma réponse' })).toBeDisabled();
    expect(t.of('session.reply')).toEqual([]);
  });

  it('says an answer was taken', () => {
    const t = opened(question());
    fireEvent.click(screen.getByRole('radio', { name: 'Sombre' }));
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer ma réponse' }));
    act(() => t.deliver({ type: 'operation.result', op: t.of('session.reply')[0]!.op, status: 'applied' }));
    expect(screen.getByRole('heading', { name: 'Réponse prise en compte' })).toBeInTheDocument();
  });
});

describe('the decision footer', () => {
  it('reads as the board: the buttons, then the way to the thread, then what a tap does', () => {
    opened(pending());
    expect(footerOrder()).toEqual(['Refuser', 'Autoriser une fois', 'Voir le fil de Kai', 'La décision sera transmise immédiatement au PC.']);
  });

  it('a question it cannot answer from here sends to the PC, the thread link before the hint', () => {
    opened(question({ options: [] }), { tool: 'cursor' });
    expect(screen.queryByRole('button', { name: 'Envoyer ma réponse' })).not.toBeInTheDocument();
    expect(footerOrder()).toEqual(['Voir le fil de Kai', 'Cet agent ne peut pas recevoir de réponse libre depuis le téléphone. Répondez sur le PC.']);
  });

  it('a decision whose delivery is unknown is checked by reconnecting', () => {
    const onReconnect = vi.fn();
    const t = opened(pending(), {}, { onReconnect });
    fireEvent.click(screen.getByRole('button', { name: 'Autoriser une fois' }));
    act(() => t.set('pc_offline'));
    expect(screen.getByText('Réception non confirmée')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnecter et vérifier' }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Vérification…' })).toBeDisabled();
  });

  it('says so when the phone could not send the decision at all', () => {
    opened(pending(), {}, { store: s => ({ ...s, decide: () => null }) });
    fireEvent.click(screen.getByRole('button', { name: 'Autoriser une fois' }));
    expect(screen.getByRole('alert')).toHaveTextContent('La décision n’a pas pu être transmise.');
  });

  it('a dialog without a free-text row says to answer on the PC', () => {
    const t = opened(question());
    fireEvent.click(screen.getByRole('radio', { name: 'Autre réponse' }));
    fireEvent.change(screen.getByLabelText('Votre réponse à Kai'), { target: { value: 'Bleu nuit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer ma réponse' }));
    act(() => t.deliver({ type: 'operation.result', op: t.of('session.reply')[0]!.op, status: 'rejected', reason: 'free_text' }));
    expect(screen.getByRole('alert')).toHaveTextContent('ne peut pas recevoir de réponse libre');
  });

  it('a free answer the PC could not type says why', () => {
    const t = opened(question());
    fireEvent.click(screen.getByRole('radio', { name: 'Autre réponse' }));
    fireEvent.change(screen.getByLabelText('Votre réponse à Kai'), { target: { value: 'Bleu nuit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer ma réponse' }));
    act(() => t.deliver({ type: 'operation.result', op: t.of('session.reply')[0]!.op, status: 'rejected', reason: 'untypable' }));
    expect(screen.getByRole('alert')).toHaveTextContent('La réponse doit tenir sur une ligne');
  });
});

describe('a free answer', () => {
  it('of a lone digit is stopped: the PC would take it for an option', () => {
    const t = opened(question());
    fireEvent.click(screen.getByRole('radio', { name: 'Autre réponse' }));
    fireEvent.change(screen.getByLabelText('Votre réponse à Kai'), { target: { value: '2' } });
    expect(screen.getByRole('alert')).toHaveTextContent('numéro d’une option');
    expect(screen.getByRole('button', { name: 'Envoyer ma réponse' })).toBeDisabled();
    expect(t.of('session.reply')).toEqual([]);
  });

  it('takes Enter as send, never as a line break', () => {
    const t = opened(question());
    fireEvent.click(screen.getByRole('radio', { name: 'Autre réponse' }));
    const field = screen.getByLabelText('Votre réponse à Kai');
    expect(field).toHaveAttribute('enterkeyhint', 'send');
    fireEvent.change(field, { target: { value: 'Bleu nuit' } });
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(false);
    expect(t.of('session.reply')).toMatchObject([{ text: 'Bleu nuit' }]);
  });
});

describe('the request context', () => {
  it('carries the terminal icon of the board', () => {
    const t = opened(pending());
    act(() => t.deliver({ type: 'session.preview', id: 'a', lines: ['Kai : je lance les tests.'] }));
    const summary = screen.getByText('Contexte de la demande');
    expect(summary.querySelector('svg')).not.toBeNull();
  });
});

// OMP: the daemon never decides an OMP request (decide: false); its dialogs are answered with an option or with `session.answer`.
const ompCaps = { freeTextAnswer: false, decide: false, questions: true };
const assertion = { id: 'AQ', clientDataJSON: 'AQI', authenticatorData: 'Aw', signature: 'BAU' };
const challenge = { type: 'confirm.challenge' as const, purpose: 'decide' as const, challenge: 'Y2hhbGw', rpId: 'relay.example', credentialId: 'AQ', expiresInMs: 60_000 };
const dialog = (extra: Partial<PhonePending> = {}) => question({ source: 'rpc', risk: 'high', riskReason: 'unknown', text: 'Choisir un modèle', options: ['Rapide', 'Précis'], ...extra });
const ask = (extra: Partial<PhonePending> = {}) => question({
  source: 'rpc', risk: 'high', riskReason: 'unknown', text: 'Deux questions', requestId: 'req-7', options: undefined as never,
  questions: [
    { id: 'q1', header: 'Thème', question: 'Quel thème ?', options: [{ label: 'Sombre' }, { label: 'Clair' }] },
    { id: 'q2', question: 'Quelles options ?', multi: true, options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }
  ], ...extra
});

function omp(p: PhonePending, opts: { device?: boolean } = {}) {
  const t = setup();
  t.deliver({ ...snapshot([session('a', { name: 'Kai', tool: 'omp', state: 'waiting_input', pending: p })]), capabilities: { claude: { freeTextAnswer: true }, codex: { freeTextAnswer: true }, cursor: { freeTextAnswer: false }, omp: ompCaps }, ...(opts.device === false ? {} : { device: { confirm: true } }) } as never);
  render(<RequestDetail store={t.store} sessionId="a" requestKey={p.key} />);
  return t;
}

describe('an OMP dialog with options', () => {
  beforeEach(() => {
    vi.mocked(platformAvailable).mockResolvedValue(true);
    vi.mocked(getAssertion).mockReset();
    Object.defineProperty(globalThis.navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 15)', configurable: true });
  });

  it('offers its options, never Autoriser, and a tap opens the confirmation for that option', async () => {
    vi.mocked(getAssertion).mockResolvedValue(assertion);
    const t = omp(dialog());
    expect(screen.queryByRole('button', { name: /Autoriser/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refuser' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Précis' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Précis' }));
    expect(t.of('session.reply')).toEqual([]);
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    expect(t.of('confirm.prepare')).toMatchObject([{ purpose: 'decide', id: 'a', expect: { key: 'p1' } }]);
    act(() => t.deliver(challenge));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer avec mon appareil' }));
    await waitFor(() => expect(t.of('session.reply')).toHaveLength(1));
    expect(t.of('session.reply')).toMatchObject([{ id: 'a', text: 'Précis', expect: { key: 'p1', kind: 'question' }, assertion }]);
  });

  it('a cancelled confirmation sends nothing, and another option can be chosen', async () => {
    vi.mocked(getAssertion).mockResolvedValue('cancelled');
    const t = omp(dialog());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rapide' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Rapide' }));
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    act(() => t.deliver(challenge));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer avec mon appareil' }));
    expect(await screen.findByText('Vérification annulée. Rien n’a été envoyé.')).toBeInTheDocument();
    expect(t.of('session.reply')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Choisir une autre réponse' }));
    expect(screen.getByRole('button', { name: 'Précis' })).toBeEnabled();
  });

  it('on a phone that cannot confirm, the options are disabled and say it is for the PC', () => {
    const t = omp(dialog(), { device: false });
    expect(screen.getByRole('button', { name: 'Rapide' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Précis' })).toBeDisabled();
    expect(screen.getByText('À accepter sur le PC')).toBeInTheDocument();
    expect(screen.getByText(/s’accepte sur le PC/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rapide' }));
    expect(t.of('session.reply')).toEqual([]);
  });

  it('a Claude question keeps its radios and its send button', () => {
    const t = opened(question());
    expect(screen.getByRole('radio', { name: 'Sombre' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sombre' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Clair' }));
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer ma réponse' }));
    expect(t.of('session.reply')).toMatchObject([{ text: '2' }]);
  });
});

describe('an OMP ask with several questions', () => {
  it('sends only once every question has a choice, with requestId, the choices and expect', () => {
    const t = omp(ask());
    const send = screen.getByRole('button', { name: 'Envoyer les réponses' });
    expect(screen.getByText('Thème')).toBeInTheDocument();
    expect(screen.getByText('Quelles options ?')).toBeInTheDocument();
    expect(send).toBeDisabled();
    expect(screen.getByText('2 questions sans réponse')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Clair' }));
    expect(screen.getByText('1 question sans réponse')).toBeInTheDocument();
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'C' }));
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect(t.of('session.answer')).toMatchObject([{
      id: 'a', requestId: 'req-7', expect: { key: 'p1', kind: 'question' },
      answers: [{ id: 'q1', selected: ['Clair'] }, { id: 'q2', selected: ['A', 'C'] }]
    }]);
    expect(t.of('session.answer')[0]).not.toHaveProperty('cancel');
    expect(t.of('session.answer')[0]).not.toHaveProperty('assertion');
  });

  it('a multiple question can be unchecked', () => {
    omp(ask());
    fireEvent.click(screen.getByRole('radio', { name: 'Sombre' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'B' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'B' }));
    expect(screen.getByRole('button', { name: 'Envoyer les réponses' })).toBeDisabled();
  });

  it('« Annuler la demande » sends cancel', () => {
    const t = omp(ask());
    fireEvent.click(screen.getByRole('button', { name: 'Annuler la demande' }));
    expect(t.of('session.answer')).toMatchObject([{ id: 'a', requestId: 'req-7', answers: [], cancel: true, expect: { key: 'p1' } }]);
  });

  it('a stale answer keeps the choices in the form and says the request changed', () => {
    const t = omp(ask());
    fireEvent.click(screen.getByRole('radio', { name: 'Clair' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer les réponses' }));
    act(() => t.deliver({ type: 'operation.result', op: t.of('session.answer')[0]!.op, status: 'rejected', reason: 'stale' }));
    expect(screen.getByText('La demande a été mise à jour. Relisez-la avant de décider.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Clair' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'B' })).toBeChecked();
  });

  it('shows the answered result once the PC applied it', () => {
    const t = omp(ask());
    fireEvent.click(screen.getByRole('radio', { name: 'Sombre' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer les réponses' }));
    act(() => t.deliver({ type: 'operation.result', op: t.of('session.answer')[0]!.op, status: 'applied' }));
    expect(screen.getByRole('heading', { name: 'Réponse prise en compte' })).toBeInTheDocument();
  });
});
