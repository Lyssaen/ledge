import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { ChatProposal, ClientMessage, Session } from '@ledge/protocol';
import type { DaemonClient } from '../src/daemon/client';
import { daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { fakeSession } from './mockDaemon';

const bridge = vi.hoisted(() => ({ focusOverlay: vi.fn(async () => {}), releaseFocus: vi.fn(async () => {}), focusTerminal: vi.fn(async (_t: string) => true) }));
vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), ...bridge }));

let sent: ClientMessage[];
const client = (): DaemonClient => ({ connect() {}, close() {}, send: m => { sent.push(m); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} });
const apply = (m: Parameters<typeof daemonStore.apply>[0]) => act(() => { daemonStore.apply(m); });
const mode = () => document.querySelector('[data-surface]')!.getAttribute('data-mode');
const proposal: ChatProposal = { cwd: '/home/u/ledge', project: 'ledge', tool: 'claude', prompt: 'Fix the build' };
const juno: Session = fakeSession('n1', { name: 'Juno', project: 'ledge', cwd: '/home/u/ledge', title: 'Juno · ledge', state: 'starting' });

/** Opens the chat, asks Ledge, and answers the turn with a proposal: the chat shows its card. */
function askAndPropose(): string {
  render(<Surface screenH={1080} theme="dark" client={client()} dnd={false} onToggleDnd={() => {}} />);
  act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('a')] }); });
  act(() => { fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true }); });
  const input = screen.getByRole('textbox', { name: 'Ask Ledge' });
  fireEvent.change(input, { target: { value: 'open a session in ledge to fix the build' } }); fireEvent.keyDown(input, { key: 'Enter' });
  const ask = sent.find(m => m.type === 'chat.ask') as Extract<ClientMessage, { type: 'chat.ask' }>;
  apply({ type: 'chat.done', qid: ask.qid, text: 'Here is the session I would start.', at: new Date().toISOString(), proposal });
  return ask.qid;
}
const card = () => screen.getByRole('region', { name: 'Proposed session' });

beforeEach(() => { vi.useFakeTimers(); daemonStore.reset(); sent = []; localStorage.clear(); bridge.focusTerminal.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe('launching from a chat card', () => {
  it('sends the proposal with its qid, stays in the chat, and opens the terminal tab by default', () => {
    const qid = askAndPropose();
    fireEvent.click(within(card()).getByRole('button', { name: /Start the session/ }));
    expect(sent.filter(m => m.type === 'session.launch')).toEqual([{ type: 'session.launch', tool: 'claude', cwd: '/home/u/ledge', prompt: 'Fix the build', qid }]);
    expect(within(card()).getByRole('button', { name: /Starting…/ })).toBeDisabled();
    fireEvent.click(within(card()).getByRole('button', { name: /Starting…/ }));
    expect(sent.filter(m => m.type === 'session.launch')).toHaveLength(1);
    apply({ type: 'session.updated', session: juno }); apply({ type: 'session.launched', id: 'n1' });
    expect(mode()).toBe('chat');
    expect(bridge.focusTerminal).toHaveBeenCalledWith('Juno · ledge');
  });
  it('does not open the tab when the form\'s switch is off', () => {
    localStorage.setItem('ledge.launch.openTab', '0');
    askAndPropose();
    fireEvent.click(within(card()).getByRole('button', { name: /Start the session/ }));
    apply({ type: 'session.updated', session: juno }); apply({ type: 'session.launched', id: 'n1' });
    expect(bridge.focusTerminal).not.toHaveBeenCalled();
  });
  it('a refused launch frees the button; a lost connection does too', () => {
    const qid = askAndPropose();
    fireEvent.click(within(card()).getByRole('button', { name: /Start the session/ }));
    // The daemon's markFailed: the card's own error comes back with chat.history.
    apply({ type: 'chat.history', turns: [{ qid, question: 'q', askedAt: new Date().toISOString(), steps: [], answer: 'a', answeredAt: new Date().toISOString(), proposal: { ...proposal, error: 'no such folder: /home/u/ledge' } }] });
    expect(within(card()).getByRole('button', { name: /Retry/ })).toBeEnabled();
    fireEvent.click(within(card()).getByRole('button', { name: /Retry/ }));
    expect(sent.filter(m => m.type === 'session.launch')).toHaveLength(2);
    expect(within(card()).getByRole('button', { name: /Starting…/ })).toBeDisabled();
    expect(within(card()).queryByRole('button', { name: /Retry/ })).toBeNull();
    act(() => { daemonStore.setStatus('unreachable'); });
    act(() => { daemonStore.setStatus('open'); });
    expect(within(card()).getByRole('button', { name: /Retry/ })).toBeEnabled();
  });
  it('an unrelated history frame keeps the launch; a retry failing again with the same message is freed by its error', () => {
    const qid = askAndPropose();
    const turn = (p: ChatProposal) => ({ qid, question: 'q', askedAt: new Date().toISOString(), steps: [], answer: 'a', answeredAt: new Date().toISOString(), proposal: p });
    fireEvent.click(within(card()).getByRole('button', { name: /Start the session/ }));
    // Another client's question: a fresh history whose proposal is unchanged.
    apply({ type: 'chat.history', turns: [turn({ ...proposal })] });
    expect(within(card()).getByRole('button', { name: /Starting…/ })).toBeDisabled();
    const failed = { ...proposal, error: 'tmux failed' };
    apply({ type: 'chat.history', turns: [turn(failed)] }); apply({ type: 'error', message: 'tmux failed' });
    fireEvent.click(within(card()).getByRole('button', { name: /Retry/ }));
    apply({ type: 'chat.history', turns: [turn({ ...failed })] });
    expect(within(card()).getByRole('button', { name: /Starting…/ })).toBeDisabled();
    apply({ type: 'error', message: 'tmux failed' });
    expect(within(card()).getByRole('button', { name: /Retry/ })).toBeEnabled();
  });
  it('an unrelated id-less error does not stop the tab opening on the later session.launched', () => {
    askAndPropose();
    fireEvent.click(within(card()).getByRole('button', { name: /Start the session/ }));
    apply({ type: 'error', message: 'something else' });
    expect(within(card()).getByRole('button', { name: /Starting…/ })).toBeDisabled();
    apply({ type: 'session.updated', session: juno }); apply({ type: 'session.launched', id: 'n1' });
    expect(bridge.focusTerminal).toHaveBeenCalledWith('Juno · ledge');
  });
});
