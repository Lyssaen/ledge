import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import type { ClientMessage, Session } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); });

/** The real Desktop fleet against the mock daemon, one machine (local): `chat.ask` goes straight to it (no routing). */
async function boot(seed: { sessions?: Session[] } = {}) {
  localStorage.clear();
  localStorage.setItem('desktop.view', JSON.stringify({ view: 'team' }));
  const d = await createMockDaemon(); daemons.push(d);
  for (const s of seed.sessions ?? []) d.upsert(s);
  d.machines([{ id: 'local', label: 'Local' }]);
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  return d;
}
const sentOf = <K extends ClientMessage['type']>(d: Daemon, type: K) => d.received.filter((m): m is Extract<ClientMessage, { type: K }> => m.type === type);
const heading = () => document.querySelector<HTMLButtonElement>('[data-open-ledge="heading"]')!;
const reply = () => document.getElementById('ledge-chat-reply') as HTMLTextAreaElement;
const proposal = { cwd: '/w/ledge', project: 'ledge', tool: 'claude' as const, prompt: 'Fix the build' };

describe('talking to Ledge from the Shell', () => {
  it('opens the chat, asks, follows the answer, starts the proposed session, then opens a mentioned session', async () => {
    const user = userEvent.setup();
    const d = await boot({ sessions: [fakeSession('otto', { name: 'Otto', project: 'ledge', cwd: '/w/ledge' })] });
    await waitFor(() => expect(document.querySelector('[data-session="local:otto"]')).not.toBeNull());
    await user.click(heading());
    await waitFor(() => expect(reply()).toHaveFocus());
    expect(heading()).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('#conversation-pane')).toHaveAttribute('data-ledge-chat');
    await waitFor(() => expect(localStorage.getItem('desktop.selected')).toBe('ledge'));

    await user.type(reply(), 'Who needs me?');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(sentOf(d, 'chat.ask')).toHaveLength(1));
    const { qid } = sentOf(d, 'chat.ask')[0]!;
    expect(sentOf(d, 'chat.ask')[0]).toEqual({ type: 'chat.ask', qid, text: 'Who needs me?', tool: 'claude' });
    expect(reply()).toHaveValue('');

    d.push({ type: 'chat.step', qid, step: { kind: 'pane', id: 'otto', name: 'Otto' } });
    expect(await screen.findByText("Reads Otto's terminal")).toBeVisible();
    const at = new Date().toISOString();
    d.push({ type: 'chat.done', qid, text: '**Otto** waits for you.', at, proposal });
    const start = await screen.findByRole('button', { name: 'Start the session' });
    expect(screen.getByText('Destination: Local')).toBeVisible();

    await user.click(start);
    await waitFor(() => expect(sentOf(d, 'session.launch')).toEqual([{ type: 'session.launch', tool: proposal.tool, cwd: proposal.cwd, prompt: proposal.prompt, qid }]));
    expect(screen.getByRole('button', { name: 'New session' })).toBeDisabled();
    d.launched(fakeSession('ari', { name: 'Ari', project: 'ledge', cwd: '/w/ledge', state: 'working' }));
    d.push({ type: 'chat.history', turns: [{ qid, question: 'Who needs me?', askedAt: at, steps: [{ kind: 'pane', id: 'otto', name: 'Otto' }], answer: '**Otto** waits for you.', answeredAt: at, proposal: { ...proposal, launchedId: 'ari' } }] });
    expect(await screen.findByText('Ari has started')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'New session' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Open Ari' })).toBeEnabled();
    expect(localStorage.getItem('desktop.selected')).toBe('ledge');   // the card does not navigate

    await user.click(within(screen.getByRole('group', { name: 'Sessions mentioned' })).getByRole('button', { name: 'Open Otto' }));
    await waitFor(() => expect(document.querySelector('#conversation-pane')).toHaveAttribute('data-conversation', 'local:otto'));
    await waitFor(() => expect(document.getElementById('conversation-reply')).toHaveFocus());
    expect(heading()).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('desktop.selected')).toBe('local:otto');
  });

  it('re-clicking the trigger while the chat is open puts the cursor back in its composer, and nothing steals focus later', async () => {
    const user = userEvent.setup();
    const d = await boot({ sessions: [fakeSession('otto', { name: 'Otto', project: 'ledge', cwd: '/w/ledge', state: 'working' })] });
    await waitFor(() => expect(document.querySelector('[data-session="local:otto"]')).not.toBeNull());
    await user.click(heading());
    await waitFor(() => expect(reply()).toHaveFocus());
    const thread = document.querySelector<HTMLElement>('#conversation-pane .thread-scroll')!;
    await user.click(thread);
    expect(thread).toHaveFocus();
    await user.click(heading());
    expect(reply()).toHaveFocus();
    // Elsewhere again, then background traffic re-renders the Shell: the focus stays where the person put it.
    await user.click(thread);
    expect(thread).toHaveFocus();
    d.upsert(fakeSession('otto', { name: 'Otto', project: 'ledge', cwd: '/w/ledge', state: 'idle' }));
    await waitFor(() => expect(document.querySelector('[data-session="local:otto"] [data-state]')).toHaveAttribute('data-state', 'idle'));
    expect(thread).toHaveFocus();
  });

  it('the empty workspace offers Ledge too; the chat opens beside it', async () => {
    const user = userEvent.setup();
    const d = await boot();
    const empty = await waitFor(() => { const b = document.querySelector<HTMLButtonElement>('[data-open-ledge="empty"]'); expect(b).not.toBeNull(); return b!; });
    expect(empty.nextElementSibling).toHaveTextContent('Start a session');
    await user.click(empty);
    await waitFor(() => expect(reply()).toHaveFocus());
    expect(document.querySelector('.workspace-empty')).not.toBeNull();
    expect(document.querySelector('[data-open-ledge="empty"]')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Who needs me?' }));
    await waitFor(() => expect(sentOf(d, 'chat.ask').map(m => m.text)).toEqual(['Who needs me?']));
  });
});

// The local daemon never answers: everything is read-only (spec §6), the history with Ledge stays readable.
class DeadSocket { onopen = null; onmessage: unknown = null; onclose: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; readyState = 3; constructor(public url: string) { setTimeout(() => { this.onerror?.({}); this.onclose?.({ code: 1006 }); }, 0); } send() {} close() {} }
describe('the chat while the local daemon is down', () => {
  it('keeps the selection, the history and the draft, frozen, with one alert', async () => {
    localStorage.clear();
    const now = new Date().toISOString();
    localStorage.setItem('desktop.selected', 'ledge');
    localStorage.setItem('desktop.drafts', JSON.stringify({ ledge: 'Kept draft' }));
    localStorage.setItem('desktop.fleet.history', JSON.stringify({ day: now.slice(0, 10), turns: [{ qid: 'q1', machineId: 'local', machineName: 'Local', question: 'Who needs me?', askedAt: now, steps: [], answer: 'Nobody waits.', answeredAt: now }], bindings: [], resetAt: '' }));
    render(<App client={createDesktopFleet({ WebSocketImpl: DeadSocket })} />);
    await screen.findByText('Local daemon unreachable');
    expect(await screen.findByText('Nobody waits.')).toBeVisible();
    expect(reply()).toBeDisabled();
    expect(reply()).toHaveValue('Kept draft');
    for (const b of within(screen.getByRole('group', { name: 'Suggestions for Ledge' })).getAllByRole('button')) expect(b).toBeDisabled();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(heading()).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('desktop.selected')).toBe('ledge');
  });
});
