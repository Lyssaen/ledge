import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PhoneChatAction, PhoneTask, PhoneTeam } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { closedTasks, openDecisions, openTasks } from '../../src/model/teams';
import { Chat } from '../../src/screens/Chat';
import { Inbox } from '../../src/screens/Inbox';
import { session } from '../model/fixtures';
import { chat, snapshot } from '../state/helpers';
import { setup } from './setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(), createCredential: vi.fn(), getAssertion: vi.fn() }));

const QID = '0b1e8f7a-4c1d-4a55-9d0e-2f3a4b5c6d7e';
const NOW = new Date().toISOString();
const ON = { confirm: true, chat: true as const };
const team: PhoneTeam = { id: 'team-a1b2', name: 'ledge-roles', project: 'Ledge', state: 'active', seats: [{ role: 'build', sessionId: 'otto' }], done: 0, given: 1, createdAt: NOW };
const task = (id: string, extra: Partial<PhoneTask> = {}): PhoneTask => ({ id, title: `Tâche ${id}`, owner: 'otto', ownerName: 'Otto', ownerRole: 'build', state: 'taken', at: NOW, updatedAt: NOW, ...extra });
/** A decision Otto put to the user: owner Ledge, giver Otto, the options in its text. */
const decision = (extra: Partial<PhoneTask> = {}): PhoneTask =>
  task('t5d6e7f', { owner: 'ledge', ownerName: 'Ledge', giver: 'otto', giverName: 'Otto', title: 'Fusionner feat/roles ?', text: 'Oui : fusionne maintenant\nNon : attends la revue de Mila', state: 'open', ...extra });

function withDecision(tasks: PhoneTask[]) {
  const t = setup();
  t.deliver(snapshot([session('otto', { name: 'Otto', repo: 'ledge', role: 'build', team: 'team-a1b2' })], 'PC-Desan', undefined, ON));
  t.deliver({ type: 'teams', teams: [team] });
  t.deliver({ type: 'tasks', tasks });
  return t;
}

describe('the decisions a session puts to the user', () => {
  it('are kept apart from the tasks Ledge gave: never open or closed tasks of Ledge', () => {
    const tasks = [
      decision(), decision({ id: 't0a0b0c', state: 'done', updatedAt: NOW }),
      task('t91b0d4', { giver: 'ledge' }), task('t3fa21c', { state: 'done' }),
      task('t7e7e7e', { giver: 'mila', state: 'done' })
    ];
    expect(openDecisions(tasks).map(t => t.id)).toEqual(['t5d6e7f']);
    expect(openTasks(tasks).map(t => t.id)).toEqual(['t91b0d4']);
    expect(closedTasks(tasks).map(t => t.id)).toEqual(['t3fa21c']);
  });

  it('« À toi » lists a decision with who asks, its title and its options, counted; never under « Confiées par Ledge », no « Voir »', () => {
    const t = withDecision([decision(), task('t91b0d4')]);
    render(<Chat store={t.store} />);
    const point = screen.getByRole('region', { name: 'Le point' });
    const yours = within(within(point).getByRole('group', { name: 'À toi' }));
    expect(yours.getByText('À TOI · 1')).toBeInTheDocument();
    expect(yours.getByText('Décision')).toBeInTheDocument();
    expect(yours.getByText('Otto')).toBeInTheDocument();
    expect(yours.getByText('te demande')).toBeInTheDocument();
    expect(yours.getByText('Fusionner feat/roles ?')).toBeInTheDocument();
    expect(yours.getByText(/Oui : fusionne maintenant\s+Non : attends la revue de Mila/)).toBeInTheDocument();
    expect(yours.queryByRole('button', { name: 'Voir' })).toBeNull();
    const given = within(within(point).getByRole('group', { name: 'Confiées par Ledge' }));
    expect(given.getByText('t91b0d4')).toBeInTheDocument();
    expect(given.queryByText('t5d6e7f')).toBeNull();
    // The inbox badge counts only what « À traiter » shows: no decision there.
    expect(within(screen.getByRole('navigation')).queryByText('1')).toBeNull();
  });

  it('« Répondre » puts the start of the question in the chat\'s field, the caret after it, and sends nothing', async () => {
    const t = withDecision([decision()]);
    render(<Chat store={t.store} />);
    const ask = vi.spyOn(t.store, 'ask');
    fireEvent.click(screen.getByRole('button', { name: 'Répondre à « Fusionner feat/roles ? »' }));
    const field = screen.getByRole('textbox') as HTMLTextAreaElement;
    const draft = 'Réponse à la décision « Fusionner feat/roles ? » (t5d6e7f) de Otto : ';
    expect(field).toHaveValue(draft);
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.selectionStart).toBe(draft.length);
    expect(field.selectionEnd).toBe(draft.length);
    expect(ask).not.toHaveBeenCalled();
    expect(t.of('chat.ask')).toEqual([]);
    expect(t.of('chat.act')).toEqual([]);
    // The user finishes it and sends it to Ledge, as any question.
    fireEvent.change(field, { target: { value: `${draft}oui, fusionne` } });
    fireEvent.click(screen.getByRole('button', { name: copy.chat.send }));
    expect(ask).toHaveBeenCalledWith(`${draft}oui, fusionne`, []);
  });

  it('leaves « À toi » once answered (task.updated)', () => {
    const t = withDecision([decision()]);
    render(<Chat store={t.store} />);
    expect(screen.getByText('Fusionner feat/roles ?')).toBeInTheDocument();
    act(() => t.deliver({ type: 'task.updated', task: decision({ state: 'done', result: 'oui, fusionne' }) }));
    expect(screen.queryByText('Fusionner feat/roles ?')).toBeNull();
    expect(screen.getByText(copy.chat.point.calm)).toBeInTheDocument();
  });

  it('« À traiter » shows no decision, open or answered', () => {
    const t = withDecision([decision(), decision({ id: 't0a0b0c', state: 'done' })]);
    render(<Inbox store={t.store} />);
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByText('Fusionner feat/roles ?')).toBeNull();
  });
});

describe('the task.answer card', () => {
  const answer: PhoneChatAction = {
    action: 'task.answer', summary: 'Répondre à la décision « Fusionner feat/roles ? » de **Otto**',
    vars: { task: 'Fusionner feat/roles ?', session: 'Otto', answer: 'Oui, fusionne feat/roles' },
    risk: 'destructive', session: 'otto', detail: 'Oui, fusionne feat/roles maintenant ; la revue de Mila suivra.'
  };
  function open(row: PhoneChatAction, confirm = true) {
    const t = setup();
    t.deliver(snapshot([session('otto', { name: 'Otto', repo: 'ledge' })], 'Atelier', undefined, { confirm, chat: true }));
    t.deliver(chat.history(chat.turn(QID, { answer: 'Voilà votre réponse.', answeredAt: NOW, actions: [row] })));
    render(<Chat store={t.store} />);
    return t;
  }
  const card = () => screen.getByRole('region', { name: 'Action proposée' });

  it('says the decision and who asked, irreversible; « Répondre… » shows the whole answer before the device check', async () => {
    const t = open(answer);
    const spy = vi.spyOn(t.store, 'act').mockResolvedValue({ status: 'applied' });
    expect(within(card()).getByText('Otto').tagName).toBe('STRONG');
    expect(within(card()).getByText(/Répondre à la décision « Fusionner feat\/roles \? » de/)).toBeInTheDocument();
    expect(within(card()).getByText(copy.chat.action.risk.destructive)).toBeInTheDocument();
    fireEvent.click(within(card()).getByRole('button', { name: 'Répondre…' }));
    expect(spy).not.toHaveBeenCalled();
    const sheet = screen.getByRole('dialog', { name: 'Répondre à la décision « Fusionner feat/roles ? » de Otto ?' });
    expect(within(sheet).getByText(answer.detail!)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: copy.confirm.go }));
    expect(spy).toHaveBeenCalledWith(QID, [0], undefined);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('without a passkey it cannot be applied', () => {
    open(answer, false);
    expect(within(card()).getByRole('button', { name: 'Répondre…' })).toBeDisabled();
  });

  it('a task that is not a decision: says so in the user\'s words', () => {
    open({ ...answer, state: 'refused', code: 'not_decision' });
    expect(screen.getByRole('alert').textContent).toBe('Refusée : la tâche « Fusionner feat/roles ? » n’est pas une décision qui vous est posée. Rien n’a été envoyé.');
  });
});
