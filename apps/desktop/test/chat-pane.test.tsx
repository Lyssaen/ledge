import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { daemonStore, type MachineState } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ChatTurn, Session } from '@ledge/protocol';
import { useChat } from '../src/chat/useChat';
import { ChatPane } from '../src/chat/ChatPane';
import { Composer } from '../src/conversation/Composer';
import { useConversations } from '../src/conversation/useConversations';
import { LangProvider } from '../src/i18n/lang';
import { THREAD_KEY } from '../src/state/threadPrefs';
import { DRAFTS_KEY } from '../src/state/drafts';
import { fakeChatClient, fakeChatFleet, history, machinesUp, T, turn } from './chat-helpers';

beforeEach(() => { localStorage.clear(); daemonStore.reset(); });

const otto = fakeSession('local:otto', { name: 'Otto', machineId: 'local', project: 'ledge' });
const bix = fakeSession('local:bix', { name: 'Bix', machineId: 'local', project: 'ledge', state: 'idle' });
const answered = (qid: string, extra: Partial<ChatTurn> = {}) => turn(qid, { answeredAt: T, answer: 'Done.', ...extra });
const proposal = { cwd: '/w/ledge', project: 'ledge', tool: 'claude' as const, prompt: 'Fix the build' };

function setup(o: { sessions?: Session[]; machines?: MachineState[]; localDown?: boolean; refuse?: boolean; withBix?: boolean } = {}) {
  const c = fakeChatClient({ refuse: o.refuse });
  const f = fakeChatFleet();
  const onOpen = vi.fn();
  const props = { sessions: o.sessions ?? [otto, bix], machines: o.machines ?? machinesUp(), localDown: o.localDown ?? false };
  f.setMachines(props.machines);
  function Harness(h: typeof props) {
    const chat = useChat(c.client, f.fleet, h.machines, h.localDown);
    const api = useConversations(c.client, h.sessions, h.machines, true);
    const b = h.sessions.find(s => s.id === 'local:bix');
    return <>
      {o.withBix && b && <Composer session={b} api={api} />}
      <ChatPane chat={chat} api={api} sessions={h.sessions} machines={h.machines} localDown={h.localDown} expanded={false} onExpand={() => {}} onOpenSession={onOpen} />
    </>;
  }
  const r = render(<Harness {...props} />);
  const rerender = (next: Partial<typeof props>) => { Object.assign(props, next); if (next.machines) f.setMachines(next.machines); r.rerender(<Harness {...props} />); };
  return { ...c, ...f, onOpen, rerender };
}
const pane = () => document.querySelector('#conversation-pane[data-ledge-chat]') as HTMLElement;
const box = () => document.getElementById('ledge-chat-reply') as HTMLTextAreaElement;
const hint = () => document.getElementById('ledge-reply-hint')!;
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const ctrlEnter = () => fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
const asks = (sent: { type: string }[]) => sent.filter(m => m.type === 'chat.ask');

describe('ChatPane: welcome', () => {
  it('is the conversation pane without a session: identity, welcome, three suggestions', () => {
    setup();
    expect(screen.getByRole('complementary', { name: 'Talk to Ledge' })).toBe(pane());
    expect(pane()).not.toHaveAttribute('data-session');
    expect(pane()).not.toHaveAttribute('data-conversation');
    expect(pane()).toHaveTextContent('TALK TO LEDGE');
    expect(pane()).toHaveTextContent('2 sessions · 1 project');
    expect(screen.getByRole('heading', { name: 'What do you need?' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'History with Ledge' })).toHaveClass('thread-scroll');
    const starters = within(screen.getByRole('group', { name: 'Suggestions for Ledge' })).getAllByRole('button');
    expect(starters.map(b => b.textContent)).toEqual(['Who needs me?', 'Give me a status of the projects', 'Prepare a new session']);
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeDisabled();
    expect(hint()).toHaveTextContent('Ctrl / ⌘ + Enter to send');
  });
  it('speaks French with vouvoiement', () => {
    render(<LangHarness />);
    expect(screen.getByRole('complementary', { name: 'Parler à Ledge' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'De quoi avez-vous besoin ?' })).toBeVisible();
    expect(screen.getByPlaceholderText('Posez votre question à Ledge…')).toBeVisible();
  });
});

function LangHarness() {
  const [c] = useState(() => fakeChatClient());
  const [f] = useState(() => fakeChatFleet());
  return <LangProvider lang="fr"><Inner c={c.client} f={f.fleet} /></LangProvider>;
}
function Inner({ c, f }: { c: ReturnType<typeof fakeChatClient>['client']; f: ReturnType<typeof fakeChatFleet>['fleet'] }) {
  const machines = machinesUp();
  const chat = useChat(c, f, machines, false);
  const api = useConversations(c, [], machines, true);
  return <ChatPane chat={chat} api={api} sessions={[]} machines={machines} localDown={false} expanded={false} onExpand={() => {}} onOpenSession={() => {}} />;
}

describe('ChatPane: asking', () => {
  it('Ctrl+Enter asks once, clears the draft, shows the running turn with Cancel', () => {
    const s = setup();
    type('Who needs me?');
    ctrlEnter();
    ctrlEnter();
    expect(asks(s.sent)).toEqual([expect.objectContaining({ type: 'chat.ask', text: 'Who needs me?', tool: 'claude' })]);
    expect(box()).toHaveValue('');
    expect(pane()).toHaveTextContent('Who needs me?');
    expect(pane()).toHaveTextContent('Ledge is looking…');
    expect(hint()).toHaveTextContent('Ledge is answering… You can prepare what comes next.');
    // Typing stays possible; sending does not.
    type('Next one');
    ctrlEnter();
    expect(asks(s.sent)).toHaveLength(1);
    expect(box()).toHaveValue('Next one');
    for (const b of within(screen.getByRole('group', { name: 'Suggestions for Ledge' })).getAllByRole('button')) expect(b).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the current question' }));
    const qid = (asks(s.sent)[0] as unknown as { qid: string }).qid;
    expect(s.sent.at(-1)).toEqual({ type: 'chat.cancel', qid });
  });
  it('a suggestion is sent as it is, once, without touching the draft', () => {
    const s = setup();
    type('My own draft');
    const starter = screen.getByRole('button', { name: 'Give me a status of the projects' });
    fireEvent.click(starter);
    fireEvent.click(starter);
    expect(asks(s.sent)).toEqual([expect.objectContaining({ text: 'Give me a status of the projects' })]);
    expect(box()).toHaveValue('My own draft');
  });
  it('a question the fleet did not take keeps the draft and says so', () => {
    setup({ refuse: true });
    type('Who needs me?');
    ctrlEnter();
    expect(box()).toHaveValue('Who needs me?');
    expect(hint()).toHaveTextContent('Ledge did not take this question. Try again in a moment.');
    type('Who needs me now?');
    expect(hint()).toHaveTextContent('Ctrl / ⌘ + Enter to send');
  });
});

describe('ChatPane: a turn', () => {
  it('steps while reading, the live answer, then the answer with links and sources', () => {
    const s = setup();
    act(() => history([turn('q1', { machineId: undefined, machineName: undefined, steps: [{ kind: 'pane', id: 'local:otto', name: 'Otto' }] })]));
    expect(within(pane()).getByRole('list')).toHaveTextContent("Reads Otto's terminal");
    act(() => daemonStore.apply({ type: 'chat.delta', qid: 'q1', text: 'Otto is waiting' }));
    expect(pane()).toHaveTextContent('Otto is waiting');
    act(() => history([answered('q1', { steps: [{ kind: 'pane', id: 'local:otto', name: 'Otto' }], answer: '**Otto** waits for `npm test`.\n\n- one\n- two' })]));
    expect(screen.queryByRole('button', { name: 'Cancel the current question' })).toBeNull();
    const mention = pane().querySelector('[data-ledge-mention="local:otto"]')!;
    expect(mention).toHaveTextContent('Otto');
    fireEvent.click(mention);
    expect(s.onOpen).toHaveBeenLastCalledWith('local:otto');
    expect(pane().querySelector('.ledge-answer code')).toHaveTextContent('npm test');
    expect(pane().querySelectorAll('.ledge-answer li')).toHaveLength(2);
    const links = screen.getByRole('group', { name: 'Sessions mentioned' });
    fireEvent.click(within(links).getByRole('button', { name: 'Open Otto' }));
    expect(s.onOpen).toHaveBeenCalledTimes(2);
    const time = new Date(T).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    expect(pane().querySelector('.ledge-source')).toHaveTextContent(`Sources: Otto's terminal · ${time}`);
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(s.sent.at(-1)).toEqual({ type: 'chat.reset' });
    expect(screen.getByRole('heading', { name: 'What do you need?' })).toBeVisible();
  });
  it('a session that left, or a name only found on another machine, is never a live link', () => {
    setup({ sessions: [fakeSession('devbox:otto', { name: 'Otto', machineId: 'devbox' })] });
    act(() => history([answered('q1', { steps: [{ kind: 'reply', id: 'local:gone', name: 'Gone' }], answer: '**Gone** and **Otto**.' })]));
    expect(screen.getByRole('button', { name: 'Open Gone' })).toBeDisabled();
    expect(pane().querySelector('[data-ledge-mention]')).toBeNull();
    expect(pane().querySelectorAll('.ledge-answer strong')).toHaveLength(2);
  });
  it('a clarification offers the machines on the last turn only, and a click answers', () => {
    const s = setup();
    const ask = turn('q1', { machineId: undefined, machineName: undefined, answeredAt: T, answer: 'Which machine?', choices: [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox' }] });
    act(() => history([ask]));
    const group = screen.getByRole('group', { name: 'Suggested machines' });
    expect(pane()).toHaveTextContent('You can also answer in writing.');
    fireEvent.click(within(group).getByRole('button', { name: 'Devbox' }));
    expect(asks(s.sent)).toEqual([expect.objectContaining({ text: 'On Devbox.' })]);
    act(() => history([ask, answered('q2')]));
    expect(screen.queryByRole('group', { name: 'Suggested machines' })).toBeNull();
  });
  it('a card goes to its machine once; losing that machine disables it and says so', () => {
    const s = setup();
    act(() => history([answered('q1', { machineId: 'devbox', machineName: 'Devbox', proposal })]));
    expect(pane()).toHaveTextContent('Destination: Devbox');
    const start = screen.getByRole('button', { name: 'Start the session' });
    fireEvent.click(start);
    fireEvent.click(start);
    expect(s.sent.filter(m => m.type === 'session.launch')).toEqual([{ type: 'session.launch', tool: 'claude', cwd: '/w/ledge', prompt: 'Fix the build', qid: 'q1' }]);
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
    s.rerender({ machines: machinesUp(['devbox']) });
    expect(pane()).toHaveTextContent('Destination: Devbox · disconnected');
    expect(screen.getByRole('button', { name: 'Start the session' })).toBeDisabled();
  });
  it('an id-less error of the card machine shows under the card when it says something new', () => {
    const s = setup();
    act(() => history([answered('q1', { machineId: 'devbox', machineName: 'Devbox', proposal })]));
    fireEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    act(() => s.machineMessage('devbox', { type: 'error', message: 'folder vanished' }));
    expect(screen.getByRole('button', { name: 'Start the session' })).toBeEnabled();
    const note = pane().querySelector('.ledge-turn > article > .ledge-card-error')!;
    expect(note).toHaveTextContent('Unexpected error');
    expect(note.querySelector('small')).toHaveTextContent('folder vanished');
  });
  it('known daemon and fleet errors are said in the UI language (no raw English in French)', () => {
    const s = setup();
    act(() => history([answered('q1', { machineId: 'devbox', machineName: 'Devbox', proposal })]));
    fireEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    act(() => s.machineMessage('devbox', { type: 'error', message: 'Devbox: already launched' }));
    expect(pane()).toHaveTextContent('Devbox: this session has already been started');
    expect(pane()).not.toHaveTextContent('already launched');
  });
  it('errors and cancellations are statuses, never alerts', () => {
    setup();
    act(() => history([turn('q1', { error: 'Devbox is offline' }), turn('q2', { error: 'cancelled' })]));
    const statuses = within(pane()).getAllByRole('status').map(n => n.textContent);
    expect(statuses).toContain('Ledge could not answer: Devbox is offline');
    expect(statuses).toContain('Question cancelled.');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('a turn error speaks French; an unknown one keeps the raw text as a small detail', () => {
    act(() => history([turn('q1', { error: 'Devbox is offline' }), turn('q2', { error: 'Codex could not start: not found in PATH' }), turn('q3', { error: 'API Error: 529' })]));
    render(<LangHarness />);
    const statuses = within(pane()).getAllByRole('status');
    expect(statuses[0]!.textContent).toBe('Ledge n’a pas pu répondre : Devbox est hors ligne');
    expect(statuses[1]).toHaveTextContent('Ledge n’a pas pu répondre : Codex n’a pas pu démarrer');
    expect(statuses[1]!.querySelector('small')).toHaveTextContent('not found in PATH');
    expect(statuses[2]).toHaveTextContent('Ledge n’a pas pu répondre : erreur inattendue');
    expect(statuses[2]!.querySelector('small')).toHaveTextContent('API Error: 529');
    expect(statuses[2]).toHaveAttribute('title', 'API Error: 529');
  });
});

describe('ChatPane: read-only and frozen machines', () => {
  it('the local daemon down: history readable, composer frozen with its draft, nothing can be sent', () => {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify({ ledge: 'Kept draft' }));
    act(() => history([answered('q1', { machineId: 'local', proposal })]));
    setup({ localDown: true, machines: machinesUp(['local', 'devbox']) });
    expect(pane()).toHaveTextContent('Done.');
    expect(box()).toBeDisabled();
    expect(box()).toHaveValue('Kept draft');
    expect(hint()).toHaveTextContent('Read-only: the local daemon does not answer.');
    expect(pane()).toHaveTextContent('Read-only: the local daemon does not answer. The history with Ledge stays readable.');
    for (const b of within(screen.getByRole('group', { name: 'Suggestions for Ledge' })).getAllByRole('button')) expect(b).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start the session' })).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('the local daemon down while a remote turn runs: Cancel is disabled like Send, not active and inert', () => {
    act(() => history([turn('q1', { machineId: 'devbox', machineName: 'Devbox' })]));
    const s = setup({ localDown: true, machines: machinesUp(['local']) });
    const stop = screen.getByRole('button', { name: 'Cancel the current question' });
    expect(stop).toBeDisabled();
    fireEvent.click(stop);
    expect(s.sent.filter(m => m.type === 'chat.cancel')).toEqual([]);
  });
  it('a remote machine lost is announced in the chat', () => {
    setup({ machines: machinesUp(['devbox']) });
    expect(pane()).toHaveTextContent('Devbox: connection lost. Ledge relies on the last known state of these machines.');
  });
});

describe('ChatPane: drafts and threads stay apart (spec §12)', () => {
  it('the chat and an agent keep their own draft and reading position', async () => {
    setup({ withBix: true });
    fireEvent.change(document.getElementById('conversation-reply')!, { target: { value: 'For Bix' } });
    type('For Ledge');
    await waitFor(() => expect(JSON.parse(localStorage.getItem(DRAFTS_KEY)!)).toEqual({ 'local:bix': 'For Bix', ledge: 'For Ledge' }));
    ctrlEnter();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(DRAFTS_KEY)!)).toEqual({ 'local:bix': 'For Bix' }));
    expect(document.getElementById('conversation-reply')).toHaveValue('For Bix');
    const thread = within(pane()).getByRole('region', { name: 'History with Ledge' });
    Object.defineProperty(thread, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(thread, 'clientHeight', { configurable: true, value: 200 });
    thread.scrollTop = 100;
    fireEvent.scroll(thread);
    await waitFor(() => expect(JSON.parse(localStorage.getItem(THREAD_KEY) ?? '{}')).toEqual({ ledge: expect.objectContaining({ scroll: 100 }) }), { timeout: 1000 });
  });
});
