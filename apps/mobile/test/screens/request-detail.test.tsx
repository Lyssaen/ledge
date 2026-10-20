import { act, fireEvent, render, screen } from '@testing-library/react';
import { MESSAGE_MAX, type PhonePending, type PhoneSession } from '@ledge/protocol';
import { describe, expect, it } from 'vitest';
import { RequestDetail } from '../../src/screens/RequestDetail';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

function opened(p: PhonePending, extra: Partial<PhoneSession> = {}) {
  const t = setup();
  const s = session('a', { name: 'Kai', topic: 'Inbox mobile', repo: 'ledge', branch: 'feat/x', state: 'waiting_permission', pending: p, ...extra });
  t.deliver(snapshot([s]));
  const view = render(<RequestDetail store={t.store} sessionId="a" requestKey={p.key} />);
  return { ...t, s, view };
}

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
