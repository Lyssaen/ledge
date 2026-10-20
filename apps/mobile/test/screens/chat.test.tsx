import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { copy } from '../../src/copy';
import { Agents } from '../../src/screens/Agents';
import { Chat } from '../../src/screens/Chat';
import { Inbox } from '../../src/screens/Inbox';
import { session } from '../model/fixtures';
import { chat, snapshot } from '../state/helpers';
import { app } from './app-setup';
import { setup } from './setup';

const ON = { confirm: true, chat: true as const };
const nav = () => screen.getByRole('navigation', { name: 'Navigation principale' });

function chatSetup(sessions = [session('a', { name: 'Bix', repo: 'ledge' }), session('b', { name: 'Nova', repo: 'relay' })], device: { confirm: boolean; chat?: true } = ON) {
  const t = setup();
  t.deliver(snapshot(sessions, 'Atelier', undefined, device));
  render(<Chat store={t.store} />);
  return t;
}
const type = (text: string) => fireEvent.change(screen.getByLabelText('Question pour Ledge'), { target: { value: text } });
const send = () => fireEvent.click(screen.getByRole('button', { name: 'Envoyer la question' }));

describe('the tab bar', () => {
  it('has two tabs without device.chat, in the inbox and in the agents', () => {
    const t = setup();
    t.deliver(snapshot([session('a')]));
    const { unmount } = render(<Inbox store={t.store} />);
    expect(within(nav()).getAllByRole('link')).toHaveLength(2);
    unmount();
    render(<Agents store={t.store} />);
    expect(within(nav()).getAllByRole('link')).toHaveLength(2);
  });

  it('has three tabs with device.chat, the chat one linking #/chat', () => {
    const t = setup();
    t.deliver(snapshot([session('a')], 'Atelier', undefined, ON));
    const { unmount } = render(<Inbox store={t.store} />);
    expect(within(nav()).getAllByRole('link')).toHaveLength(3);
    expect(within(nav()).getByRole('link', { name: 'Demander à Ledge' })).toHaveAttribute('href', '#/chat');
    unmount();
    render(<Agents store={t.store} />);
    expect(within(nav()).getAllByRole('link')).toHaveLength(3);
  });

  it('#/chat goes back to the inbox without device.chat', async () => {
    const a = app('ready', { hash: '#/chat' });
    act(() => a.deliver(snapshot([session('a')])));
    expect(screen.getByRole('heading', { name: 'À traiter' })).toBeInTheDocument();
    await waitFor(() => expect(globalThis.location.hash).toBe('#/'));
  });

  it('opens the chat at #/chat with device.chat', () => {
    const a = app('ready', { hash: '#/chat' });
    act(() => a.deliver(snapshot([session('a')], 'Atelier', undefined, ON)));
    expect(screen.getByLabelText('Question pour Ledge')).toBeInTheDocument();
  });
});

describe('the chat screen', () => {
  it('an empty thread says so and offers suggestions with real names; a tap puts one in the field', () => {
    chatSetup();
    expect(screen.getByText(copy.chat.empty)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Qui attend quelque chose de moi ?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Où en est Bix sur le badge d\'attente ?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Qu\'est-ce qui a changé dans ledge aujourd\'hui ?' }));
    expect(screen.getByLabelText('Question pour Ledge')).toHaveValue('Qu\'est-ce qui a changé dans ledge aujourd\'hui ?');
  });

  it('omits the suggestions that need a session or a repo when there is none', () => {
    chatSetup([]);
    expect(screen.getAllByRole('button', { name: /\?$/ })).toHaveLength(1);
  });

  it('the subtitle counts the sessions and their distinct repos', () => {
    chatSetup([session('a', { repo: 'x' }), session('b', { repo: 'x' }), session('c', { repo: 'y' })]);
    expect(screen.getByText('Fil du téléphone · 3 agents, 2 repos')).toBeInTheDocument();
    expect(copy.chat.subtitle(1, 1)).toBe('Fil du téléphone · 1 agent, 1 repo');
  });

  it('asking sends chat.ask, shows the bubble, then the steps and « Arrêter », which sends chat.cancel', () => {
    const t = chatSetup();
    type('Où en est le lot 6 ?');
    send();
    const [ask] = t.of('chat.ask');
    expect(ask).toMatchObject({ text: 'Où en est le lot 6 ?' });
    expect(screen.getByText('Où en est le lot 6 ?')).toBeInTheDocument();
    expect(screen.getByLabelText('Question pour Ledge')).toHaveValue('');
    act(() => t.deliver({ type: 'chat.step', qid: ask!.qid, step: { kind: 'sessions' } }));
    act(() => t.deliver({ type: 'chat.step', qid: ask!.qid, step: { kind: 'pane', id: 'a', name: 'Bix' } }));
    expect(screen.getByText('Lit les 2 sessions…')).toBeInTheDocument();
    expect(screen.getByText('Regarde le terminal de Bix…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Arrêter' }));
    expect(t.of('chat.cancel')).toEqual([{ type: 'chat.cancel', qid: ask!.qid }]);
  });

  it('« Nouvelle conversation » is disabled while a question runs, and resets once it is done', () => {
    const t = chatSetup();
    const reset = () => screen.getByRole('button', { name: 'Nouvelle conversation' });
    expect(reset()).toBeEnabled();
    type('Salut');
    send();
    expect(reset()).toBeDisabled();
    const qid = t.of('chat.ask')[0]!.qid;
    act(() => t.deliver(chat.done(qid)));
    expect(reset()).toBeEnabled();
    fireEvent.click(reset());
    expect(t.of('chat.reset')).toHaveLength(1);
  });

  it('busy puts the text of the refusal on screen and the question back in the field', () => {
    const t = chatSetup();
    type('Une question');
    send();
    const qid = t.of('chat.ask')[0]!.qid;
    act(() => t.deliver(chat.error(qid, 'busy')));
    expect(screen.getByText(copy.chat.busy)).toBeInTheDocument();
    expect(screen.getByLabelText('Question pour Ledge')).toHaveValue('Une question');
    expect(screen.queryByText('Arrêter')).not.toBeInTheDocument();
  });

  it('a failed turn says why, from its code', () => {
    const t = chatSetup();
    type('Une question');
    send();
    const qid = t.of('chat.ask')[0]!.qid;
    act(() => t.deliver(chat.error(qid, 'timeout')));
    expect(screen.getByText(copy.chat.timeout)).toBeInTheDocument();
  });

  it('offline, the send button is disabled, the note is shown and nothing is sent', () => {
    const t = chatSetup();
    act(() => t.set('pc_offline'));
    type('Une question');
    expect(screen.getByRole('button', { name: 'Envoyer la question' })).toBeDisabled();
    expect(screen.getByText('Hors ligne : posez la question quand le PC sera joignable.')).toBeInTheDocument();
    expect(t.of('chat.ask')).toHaveLength(0);
  });

  it('Enter sends, Shift+Enter does not', () => {
    const t = chatSetup();
    type('Une question');
    const field = screen.getByLabelText('Question pour Ledge');
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(t.of('chat.ask')).toHaveLength(0);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(t.of('chat.ask')).toHaveLength(1);
  });
});
