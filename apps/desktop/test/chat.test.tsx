import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { DaemonError } from '@ledge/fleet';
import type { ChatProposal, ChatTurn, ClientMessage, Session } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, declarations, DEFAULT_SESSIONS, LAUNCH_PROJECTS, type MockDaemon } from './helpers';
import { loadChat } from '../src/chat/lazy';
import { useChatCards } from '../src/chat/useChatCards';

beforeEach(async () => { localStorage.clear(); await loadChat(); });
// jsdom has no scrollIntoView: a test that stubs it leaves none behind.
afterEach(async () => { delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; await closeDaemons(); });

const LOCAL = [{ id: 'local', label: 'Local' }];
const PROPOSAL: ChatProposal = { tool: 'codex', cwd: '/w/ledge/app', project: 'Ledge', prompt: 'Relis la PR' };

const panel = () => within(screen.getByRole('complementary', { name: 'Chat Ledge' }));
const field = () => panel().getByRole('textbox', { name: 'Ask Ledge' });
const seat = (id: string) => document.querySelector<HTMLElement>(`.agent-seat[data-agent="${id}"]`);
const asks = (d: MockDaemon) => d.received.filter((m): m is Extract<ClientMessage, { type: 'chat.ask' }> => m.type === 'chat.ask');
const launches = (d: MockDaemon) => d.received.filter(m => m.type === 'session.launch');
const filterButton = () => within(screen.getByRole('banner')).queryByRole('button', { name: 'Remove the filter: show every project' });

/** The app on one local machine and LAUNCH_PROJECTS (Otto at the Ledge table, Nova at Payment's, Kit without a project), the chat opened with `/`. */
async function openChat(opts: { list?: boolean; sessions?: Session[] } = {}) {
  const env = await boot({ machines: LOCAL, projects: LAUNCH_PROJECTS, ...opts });
  await env.user.keyboard('/');
  await screen.findByRole('complementary', { name: 'Chat Ledge' });
  await waitFor(() => expect(field()).toHaveFocus());
  return env;
}

/** Asks `question` in the open chat; the fake daemon reads the sessions, streams, then answers `answer` (with `extra`: a proposal…).
 *  Returns the turn as the daemon's history would hold it. */
async function ask(env: Awaited<ReturnType<typeof openChat>>, question: string, answer: string, extra: Partial<ChatTurn> = {}): Promise<ChatTurn> {
  const { d, user } = env;
  const before = asks(d).length;
  await user.type(field(), `${question}{Enter}`);
  await waitFor(() => expect(asks(d)).toHaveLength(before + 1));
  const { qid } = asks(d).at(-1)!;
  d.push({ type: 'chat.step', qid, step: { kind: 'sessions' } });
  await panel().findByText('Reads the sessions');
  d.push({ type: 'chat.delta', qid, text: answer.slice(0, 4) });
  const at = new Date().toISOString();
  d.push({ type: 'chat.done', qid, text: answer, at, ...(extra.proposal ? { proposal: extra.proposal } : {}) });
  await waitFor(() => expect(panel().queryByText('Reads the sessions')).toBeNull());
  return { qid, question, askedAt: at, steps: [{ kind: 'sessions' }], answer, answeredAt: at, ...extra };
}

describe('the Ledge chat docked on the right', () => {
  it('/ opens it with the focus in the field; typing there triggers no shortcut; Escape closes it', async () => {
    const { user } = await openChat();
    expect(panel().getByText('Ask me how things are going.')).toBeVisible();
    await user.keyboard('n');
    expect(field()).toHaveValue('n');
    expect(screen.queryByRole('dialog', { name: 'New session' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
    // The sidebar's entry opens it again, with the focus in the field.
    await user.click(within(screen.getByRole('complementary', { name: /sidebar/i })).getByRole('button', { name: /^Chat Ledge/ }));
    await waitFor(() => expect(field()).toHaveFocus());
    // Escape from outside the field closes it first too.
    field().blur();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
  });

  it('/ and the top bar’s chat button bring the focus back to the field of a chat already open', async () => {
    const { user } = await openChat();
    act(() => field().blur());
    expect(document.activeElement).toBe(document.body);
    await user.keyboard('/');
    await waitFor(() => expect(field()).toHaveFocus());
    expect(field()).toHaveValue('');
    await user.keyboard('/');                                            // in the field, / is typed
    expect(field()).toHaveValue('/');
    act(() => field().blur());
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Chat Ledge' }));
    await waitFor(() => expect(field()).toHaveFocus());
    expect(screen.getByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
  });

  it('a question goes out with a qid and Claude; the steps, then the answer show, its agent names linked', async () => {
    const env = await openChat();
    await ask(env, 'Who reviews?', '**Otto** relit la PR.');
    expect(asks(env.d)).toEqual([{ type: 'chat.ask', qid: expect.stringMatching(/^q-/), text: 'Who reviews?', tool: 'claude' }]);
    const otto = panel().getByRole('link', { name: 'Otto' });
    expect(otto).toHaveAttribute('href', 'ledge://session/local:otto');
    expect(panel().getByText(/relit la PR\./)).toBeVisible();
    // Stop and New conversation reach the daemon.
    await env.user.click(panel().getByRole('button', { name: 'New conversation' }));
    await waitFor(() => expect(env.d.received.some(m => m.type === 'chat.reset')).toBe(true));
  });

  it('Stop sends chat.cancel for the running turn', async () => {
    const { d, user } = await openChat();
    await user.type(field(), 'Who reviews?{Enter}');
    await waitFor(() => expect(asks(d)).toHaveLength(1));
    await user.click(await panel().findByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'chat.cancel', qid: asks(d)[0]!.qid }));
  });

  it('an answer that finishes while the search palette is open leaves the focus there; Escape then closes the palette, not the chat', async () => {
    const { d, user } = await openChat();
    await user.type(field(), 'Who reviews?{Enter}');
    await waitFor(() => expect(asks(d)).toHaveLength(1));
    await user.keyboard('{Control>}k{/Control}');
    const search = await screen.findByRole('combobox');
    await waitFor(() => expect(search).toHaveFocus());
    const { qid } = asks(d)[0]!;
    d.push({ type: 'chat.done', qid, text: '**Otto** relit la PR.', at: new Date().toISOString() });
    await panel().findByText(/relit la PR\./);
    await waitFor(() => expect(field()).toBeEnabled());
    expect(search).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
  });

  it('opening a linked name opens the agent’s page and closes the chat', async () => {
    const env = await openChat();
    await ask(env, 'Who reviews?', '**Otto** relit la PR.');
    await env.user.click(panel().getByRole('link', { name: 'Otto' }));
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
    await waitFor(() => expect(document.querySelector('[aria-current=page][data-agent]')).toHaveAttribute('data-agent', 'local:otto'));
  });

  it('hovering or focusing a name lights its seat at the table; leaving puts it out; a name not on screen lights nothing', async () => {
    const env = await openChat();
    await ask(env, 'Who works?', '**Otto** relit la PR, **Nova** paie et [Zed](ledge://session/nas:zed) dort.');
    const otto = panel().getByRole('link', { name: 'Otto' });
    await env.user.hover(otto);
    expect(seat('local:otto')).toHaveClass('chat-hover');
    expect(document.querySelectorAll('.chat-hover')).toHaveLength(1);
    await env.user.unhover(otto);
    expect(seat('local:otto')).not.toHaveClass('chat-hover');
    // The keyboard: focusing the name lights it, leaving it puts it out.
    act(() => otto.focus());
    expect(seat('local:otto')).toHaveClass('chat-hover');
    act(() => otto.blur());
    expect(document.querySelectorAll('.chat-hover')).toHaveLength(0);
    // An agent of another machine: nothing to light, nothing breaks.
    await env.user.hover(panel().getByRole('link', { name: 'Zed' }));
    expect(document.querySelectorAll('.chat-hover')).toHaveLength(0);
    // Nova's table hidden by the filter: nothing lights.
    await env.user.click(within(screen.getByRole('complementary', { name: /sidebar/i })).getByRole('button', { name: /^Ledge/ }));
    expect(seat('local:nova')).toBeNull();
    await env.user.hover(panel().getByRole('link', { name: 'Nova' }));
    expect(document.querySelectorAll('.chat-hover')).toHaveLength(0);
    await env.user.hover(panel().getByRole('link', { name: 'Otto' }));
    expect(seat('local:otto')).toHaveClass('chat-hover');
    // Closing the chat puts it out.
    await env.user.keyboard('{Escape}');
    expect(document.querySelectorAll('.chat-hover')).toHaveLength(0);
  });

  it('Escape from a name in an answer closes the chat only: the filter and the page stay', async () => {
    const env = await openChat();
    await env.user.click(within(screen.getByRole('complementary', { name: /sidebar/i })).getByRole('button', { name: /^Ledge/ }));
    expect(filterButton()).toBeVisible();
    await ask(env, 'Who reviews?', '**Otto** relit la PR.');
    act(() => panel().getByRole('link', { name: 'Otto' }).focus());
    await env.user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
    expect(filterButton()).toBeVisible();
    // On a session page too: Escape from the chat's Close button closes the chat, the page stays.
    await env.user.click(screen.getByRole('button', { name: /^Otto,/ }));
    await waitFor(() => expect(document.querySelector('[aria-current=page][data-agent]')).toHaveAttribute('data-agent', 'local:otto'));
    await env.user.keyboard('/');
    act(() => panel().getByRole('button', { name: 'Close' }).focus());
    await env.user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
    expect(document.querySelector('[aria-current=page][data-agent]')).toHaveAttribute('data-agent', 'local:otto');
  });

  it('an exited agent: lit while its seat is shown; once it is gone, its name lights nothing and nothing breaks', async () => {
    const env = await openChat({ sessions: [...DEFAULT_SESSIONS, fakeSession('bix', { name: 'Bix', cwd: '/w/ledge', state: 'exited' })] });
    await ask(env, 'Who finished?', '**Bix** a fini, **Otto** relit la PR.');
    await env.user.hover(panel().getByRole('link', { name: 'Bix' }));
    expect(seat('local:bix')).toHaveClass('chat-hover');               // still at its table: shown, so lit
    env.d.remove('bix');                                               // the finished agent leaves while its name is hovered
    await waitFor(() => expect(seat('local:bix')).toBeNull());
    expect(panel().queryByRole('link', { name: 'Bix' })).toBeNull();   // its name is plain text now
    expect(panel().getByText(/a fini/)).toBeVisible();
    expect(document.querySelectorAll('.chat-hover')).toHaveLength(0);
    await env.user.hover(panel().getByRole('link', { name: 'Otto' }));
    expect(seat('local:otto')).toHaveClass('chat-hover');
    expect(document.querySelectorAll('.chat-hover')).toHaveLength(1);
  });

  it('a web link in an answer opens through the app, never by navigating', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      const env = await openChat();
      await ask(env, 'Where are the docs?', 'Voir [la doc](https://example.com/docs).');
      await env.user.click(panel().getByRole('link', { name: 'la doc' }));
      expect(opened).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener');
    } finally { opened.mockRestore(); }
  });

  it('a card whose agent has no table says it starts with no project (the proposal’s folder name is no table)', async () => {
    const env = await openChat();
    const proposal: ChatProposal = { tool: 'claude', cwd: '/w/scratch/tool', project: 'scratch' };
    const turn = await ask(env, 'Lance une session', 'Voici la session.', { proposal });
    env.d.options.autoLaunch = true;
    await env.user.click(panel().getByRole('button', { name: 'Start the session' }));
    await screen.findByText('Agent1 is starting, with no project.');
    expect(screen.queryByText(/scratch table/)).toBeNull();
    env.d.push({ type: 'chat.history', turns: [{ ...turn, proposal: { ...proposal, launchedId: 'launch-1' } }] });
    await panel().findByText('has started');
  });

  it('on the List, a hovered name lights its row', async () => {
    const env = await openChat({ list: true });
    await ask(env, 'Who works?', '**Otto** relit la PR.');
    await env.user.hover(panel().getByRole('link', { name: 'Otto' }));
    expect(screen.getByRole('listitem', { name: /^Otto,/ })).toHaveClass('chat-hover');
    await env.user.unhover(panel().getByRole('link', { name: 'Otto' }));
    expect(document.querySelectorAll('.chat-hover')).toHaveLength(0);
  });

  it('a session card launches once; launched, it seats the agent at its table and says who starts where', async () => {
    const env = await openChat();
    const { d, user } = env;
    const turn = await ask(env, 'Lance une session pour relire la PR', 'Je peux démarrer une session à la table **Ledge**.', { proposal: PROPOSAL });
    const card = within(panel().getByRole('region', { name: 'Proposed session' }));
    expect(card.getByText('/w/ledge/app')).toBeVisible();
    expect(card.getByText('Relis la PR')).toBeVisible();
    d.holdLaunch();
    await user.click(card.getByRole('button', { name: 'Start the session' }));
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    expect(launches(d)[0]).toEqual({ type: 'session.launch', tool: 'codex', cwd: '/w/ledge/app', prompt: 'Relis la PR', qid: turn.qid });
    const busy = card.getByRole('button', { name: 'Starting…' });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(launches(d)).toHaveLength(1);
    const scroll = vi.fn(function (this: HTMLElement) { return this; });
    Element.prototype.scrollIntoView = scroll;
    d.releaseLaunch();                                                   // Agent1 is listed, then session.launched
    await screen.findByText('Agent1 is starting at the Ledge table.');
    d.push({ type: 'chat.history', turns: [{ ...turn, proposal: { ...PROPOSAL, launchedId: 'launch-1' } }] });
    expect(await panel().findByText('has started')).toBeVisible();
    expect(panel().getByRole('link', { name: 'Agent1' })).toHaveAttribute('href', 'ledge://session/local:launch-1');
    expect(document.querySelector('.agent-seat.just-seated')).toBe(seat('local:launch-1'));
    await waitFor(() => expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' })));
    expect(panel().queryByRole('button', { name: /Start the session|Retry/ })).toBeNull();
    expect(launches(d)).toHaveLength(1);
    expect(screen.getByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();   // the chat stays open
  });

  it('a launch the daemon marks failed shows its error on the card, which can be launched again', async () => {
    const env = await openChat();
    const { d, user } = env;
    const turn = await ask(env, 'Lance une session', 'Voici la session.', { proposal: PROPOSAL });
    const card = within(panel().getByRole('region', { name: 'Proposed session' }));
    d.holdLaunch();
    await user.click(card.getByRole('button', { name: 'Start the session' }));
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    d.push({ type: 'chat.history', turns: [{ ...turn, proposal: { ...PROPOSAL, error: 'codex: command not found' } }] });
    expect(await card.findByRole('alert')).toHaveTextContent('Could not start: codex: command not found');
    const retry = card.getByRole('button', { name: 'Retry' });
    expect(retry).toBeEnabled();
    await user.click(retry);
    await waitFor(() => expect(launches(d)).toHaveLength(2));
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('a card launched while another project is filtered brings the filter back to All, keeping the view', async () => {
    const env = await openChat();
    const { d, user } = env;
    const turn = await ask(env, 'Lance une session', 'Voici la session.', { proposal: PROPOSAL });
    await user.click(within(screen.getByRole('complementary', { name: /sidebar/i })).getByRole('button', { name: /^Payment Service/ }));
    expect(filterButton()).toBeVisible();
    d.options.autoLaunch = true;
    await user.click(panel().getByRole('button', { name: 'Start the session' }));
    await screen.findByText('Agent1 is starting at the Ledge table.');
    d.push({ type: 'chat.history', turns: [{ ...turn, proposal: { ...PROPOSAL, launchedId: 'launch-1' } }] });
    await panel().findByText('has started');
    expect(filterButton()).toBeNull();
    expect(seat('local:launch-1')).not.toBeNull();                       // still the Atelier
    expect(seat('local:otto')).not.toBeNull();
    expect(screen.getByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
  });

  it('with the local daemon offline, the field is disabled with the reason and the history stays', async () => {
    const env = await openChat();
    await ask(env, 'Who reviews?', '**Otto** relit la PR.');
    await env.d.close();
    await waitFor(() => expect(panel().getByText('The local daemon is offline.')).toBeVisible());
    expect(field()).toBeDisabled();
    expect(panel().getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(panel().getByText('Who reviews?')).toBeVisible();
    expect(panel().getByText(/relit la PR\./)).toBeVisible();
  });

  it('the stylesheet: the docked panel, its agent links and the lit agent come from the mockup', () => {
    expect(declarations('shell.css', '.ledge-chat-panel')).toContain('width:400px');
    expect(declarations('shell.css', '.ledge-chat-panel a[href^="ledge://session/"]')).toContain('color:var(--sidebar-primary)');
    expect(declarations('shell.css', '.chat-hover')).toContain('outline:2pxsolidvar(--sidebar-primary)');
    expect(declarations('shell.css', '.chat-hover .ledge-bot')).toContain('filter:drop-shadow(008pxcolor-mix(insrgb,var(--sidebar-primary)60%,transparent))');
    expect(declarations('shell.css', '.ledge-chat-panel .chat-close')).toBe('');
  });
});

describe('useChatCards', () => {
  const turnWith = (extra: Partial<ChatTurn>): ChatTurn => ({ qid: 'q-1', question: 'Lance', askedAt: '2026-10-17T10:00:00.000Z', steps: [], answer: 'ok', answeredAt: '2026-10-17T10:00:01.000Z', ...extra });
  type Props = { chat: ChatTurn[]; lastLaunched: { id: string; seq: number } | null; errors: DaemonError[]; ready: boolean; sessions?: Session[] };
  const setup = (initial: Props) => {
    const send = vi.fn();
    const onLaunched = vi.fn();
    const hook = renderHook((p: Props) => useChatCards({ send, chat: p.chat, lastLaunched: p.lastLaunched, errors: p.errors, sessions: p.sessions ?? [], turnReady: () => p.ready, turnMachine: () => 'local', onLaunched }), { initialProps: initial });
    return { send, onLaunched, ...hook };
  };

  it('two launches in the same tick send one; the launched answer is announced once; the history frees the card', () => {
    const chat = [turnWith({ proposal: PROPOSAL })];
    const { send, onLaunched, result, rerender } = setup({ chat, lastLaunched: null, errors: [], ready: true });
    act(() => { result.current.launch('q-1'); result.current.launch('q-1'); result.current.relay('q-1'); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'session.launch', tool: 'codex', cwd: '/w/ledge/app', prompt: 'Relis la PR', qid: 'q-1' });
    expect(result.current.launchingQid).toBe('q-1');
    rerender({ chat, lastLaunched: { id: 'local:launch-1', seq: 1 }, errors: [], ready: true });
    expect(onLaunched).toHaveBeenCalledWith('local:launch-1', PROPOSAL);
    expect(result.current.launchingQid).toBe('q-1');                   // still waiting for the history
    const marked = [turnWith({ proposal: { ...PROPOSAL, launchedId: 'local:launch-1' } })];
    rerender({ chat: marked, lastLaunched: { id: 'local:launch-1', seq: 1 }, errors: [], ready: true });
    expect(result.current.launchingQid).toBeNull();
    expect(onLaunched).toHaveBeenCalledTimes(1);
    act(() => result.current.launch('q-1'));                           // launched: never again
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a session.launched that is not the card’s (another machine, folder or harness: the form’s launch) is not announced', () => {
    const chat = [turnWith({ proposal: PROPOSAL })];
    const { onLaunched, result, rerender } = setup({ chat, lastLaunched: null, errors: [], ready: true });
    act(() => result.current.launch('q-1'));
    const form = fakeSession('local:launch-1', { name: 'Ada', tool: 'claude', cwd: '/w/docs' });
    rerender({ chat, lastLaunched: { id: 'local:launch-1', seq: 1 }, errors: [], ready: true, sessions: [form] });
    rerender({ chat, lastLaunched: { id: 'nas:launch-9', seq: 2 }, errors: [], ready: true, sessions: [form] });
    expect(onLaunched).not.toHaveBeenCalled();
    expect(result.current.launchingQid).toBe('q-1');
    const card = fakeSession('local:launch-2', { name: 'Neo', tool: 'codex', cwd: '/w/ledge/app/' });
    rerender({ chat, lastLaunched: { id: 'local:launch-2', seq: 3 }, errors: [], ready: true, sessions: [form, card] });
    expect(onLaunched).toHaveBeenCalledTimes(1);
    expect(onLaunched).toHaveBeenCalledWith('local:launch-2', PROPOSAL);
  });

  it('a card of a machine that is not ready does not launch; one whose machine falls is freed', () => {
    const chat = [turnWith({ proposal: PROPOSAL })];
    const { send, result, rerender } = setup({ chat, lastLaunched: null, errors: [], ready: false });
    act(() => result.current.launch('q-1'));
    expect(send).not.toHaveBeenCalled();
    rerender({ chat, lastLaunched: null, errors: [], ready: true });
    act(() => result.current.launch('q-1'));
    expect(result.current.launchingQid).toBe('q-1');
    rerender({ chat, lastLaunched: null, errors: [], ready: false });
    expect(result.current.launchingQid).toBeNull();
  });

  it('a refusal of the launch (an error without id) frees the card', () => {
    const chat = [turnWith({ proposal: PROPOSAL })];
    const old: DaemonError = { message: 'older', seq: 1 };
    const { result, rerender } = setup({ chat, lastLaunched: null, errors: [old], ready: true });
    act(() => result.current.launch('q-1'));
    rerender({ chat, lastLaunched: null, errors: [old], ready: true });
    expect(result.current.launchingQid).toBe('q-1');                   // an error seen before the send is not the answer
    rerender({ chat, lastLaunched: null, errors: [old, { message: 'already launched', seq: 2, request: 'session.launch' }], ready: true });
    expect(result.current.launchingQid).toBeNull();
  });

  it('a relay sends once, waits for its turn to change, and blocks launches meanwhile', () => {
    const relay = { id: 'local:otto', name: 'Otto', tool: 'claude' as const, text: 'Relis la PR' };
    const chat = [turnWith({ relay }), turnWith({ qid: 'q-2', proposal: PROPOSAL })];
    const { send, result, rerender } = setup({ chat, lastLaunched: null, errors: [], ready: true });
    act(() => { result.current.relay('q-1'); result.current.relay('q-1'); result.current.launch('q-2'); });
    expect(send.mock.calls).toEqual([[{ type: 'session.relay', qid: 'q-1' }]]);
    expect(result.current.relayingQid).toBe('q-1');
    rerender({ chat: [turnWith({ relay: { ...relay, status: 'queued' } }), chat[1]!], lastLaunched: null, errors: [], ready: true });
    expect(result.current.relayingQid).toBeNull();
    act(() => result.current.cancelRelay('q-1'));
    expect(send).toHaveBeenLastCalledWith({ type: 'session.relay.cancel', qid: 'q-1' });
  });
});
