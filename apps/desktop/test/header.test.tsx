import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMemo } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Session } from '@ledge/protocol';
import { daemonStore, type DaemonClient, type MachineState } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { ConversationHeader } from '../src/conversation/Header';
import { useConversations } from '../src/conversation/useConversations';

const bridge = vi.hoisted(() => ({
  focusTerminal: vi.fn(async (_title: string) => false),
  openTerminal: vi.fn(async (_title: string, _command: string[]) => true)
}));
vi.mock('../src/tauri/bridge', () => bridge);

const local = [{ id: 'local', label: 'Local', status: 'open', ready: true, recents: [], sessions: [], launcher: null }] as unknown as MachineState[];
const command = ['tmux', 'attach', '-t', 'ledge-nova'];
let send: ReturnType<typeof vi.fn>;
let terminal: ReturnType<typeof vi.fn>;
let client: DaemonClient;

beforeEach(() => {
  localStorage.clear(); daemonStore.reset();
  bridge.focusTerminal.mockReset().mockResolvedValue(false);
  bridge.openTerminal.mockReset().mockResolvedValue(true);
  send = vi.fn(); terminal = vi.fn(() => command);
  client = { send, fleet: { terminal } } as unknown as DaemonClient;
});

function Harness({ session }: { session: Session }) {
  const sessions = useMemo(() => [session], [session]);
  const api = useConversations(client, sessions, local, true);
  return <ConversationHeader session={session} client={client} api={api} expanded={false} onExpand={() => {}} />;
}
const button = (name: string) => screen.getByRole('button', { name });

describe('ConversationHeader', () => {
  it('shows the subject, the agent, its machine and state, and folded session details kept per session', () => {
    const done = fakeSession('local:bix', { name: 'Bix', state: 'exited', topic: 'LEDGE-42 · Documenter le protocole', project: 'ledge', branch: 'docs/protocol', startedAt: '2026-10-09T18:00:00.000Z', exitedAt: '2026-10-09T19:05:00.000Z' });
    const { container } = render(<Harness session={done} />);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('LEDGE-42 · Documenter le protocole');
    expect(screen.getByText('Claude Code · This machine')).toBeInTheDocument();
    expect(container.querySelector('.conversation-person .state')).toHaveTextContent('Finished');
    const details = container.querySelector('details.conversation-meta') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    const meta = details.querySelector('.detail-meta')!;
    expect(meta).toHaveTextContent('ledge · 1 h 05');
    expect(meta).toHaveTextContent('⑂ docs/protocol');
    expect(meta).toHaveTextContent('LEDGE-42 · found in the subject');
    act(() => { details.open = true; details.dispatchEvent(new Event('toggle')); });
    expect(JSON.parse(localStorage.getItem('desktop.thread')!)).toEqual({ 'local:bix': { open: ['metadata'], scroll: null } });
  });
  it('shows the remote machine and an ambiguous Jira story', () => {
    const nova = fakeSession('devbox:nova', { name: 'Nova', machineId: 'devbox', machineName: 'Devbox', branch: 'fix/LEDGE-42-and-LEDGE-43' });
    const { container } = render(<Harness session={nova} />);
    expect(screen.getByText('Claude Code · Devbox')).toBeInTheDocument();
    expect(container.querySelector('.detail-meta')).toHaveTextContent('To clarify: LEDGE-42, LEDGE-43');
  });
  it('opens a local terminal by title first, then in a new tab, and tells the session it is focused (m5)', async () => {
    render(<Harness session={fakeSession('local:nova', { name: 'Nova', title: 'Nova · ledge' })} />);
    fireEvent.click(button('Open terminal'));
    await waitFor(() => expect(bridge.openTerminal).toHaveBeenCalledWith('Nova · ledge', command));
    expect(bridge.focusTerminal).toHaveBeenCalledWith('Nova · ledge');
    expect(send).toHaveBeenCalledWith({ type: 'session.focus', id: 'local:nova' });
    expect(terminal).toHaveBeenCalledWith('local:nova');
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('opens a remote terminal titled with its machine, without looking for a local window', async () => {
    render(<Harness session={fakeSession('devbox:nova', { name: 'Nova', title: 'Nova · ledge', machineId: 'devbox', machineName: 'Devbox' })} />);
    fireEvent.click(button('Open terminal'));
    await waitFor(() => expect(bridge.openTerminal).toHaveBeenCalledWith('Devbox · Nova · ledge', command));
    expect(bridge.focusTerminal).not.toHaveBeenCalled();
  });
  it('says when no terminal could be opened', async () => {
    bridge.openTerminal.mockResolvedValue(false);
    render(<Harness session={fakeSession('local:nova')} />);
    fireEvent.click(button('Open terminal'));
    expect(await screen.findByRole('status')).toHaveTextContent('No terminal found on this machine');
  });
  it('Stop asks first: Cancel sends nothing, « Yes, stop » sends once', () => {
    render(<Harness session={fakeSession('local:nova', { name: 'Nova', state: 'working' })} />);
    fireEvent.click(button('Stop'));
    expect(screen.getByText('Stop Nova? Its current work will be interrupted.')).toBeInTheDocument();
    fireEvent.click(button('Cancel'));
    expect(screen.queryByText(/current work/)).toBeNull();
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(button('Stop'));
    fireEvent.click(button('Yes, stop'));
    expect(send).toHaveBeenCalledWith({ type: 'session.kill', id: 'local:nova' });
    expect(screen.getByRole('status')).toHaveTextContent('Sent…');
    expect(button('Stop')).toBeDisabled();
  });
  it('a command error shows its message', () => {
    render(<Harness session={fakeSession('local:nova', { state: 'working' })} />);
    fireEvent.click(button('Interrupt'));
    expect(send).toHaveBeenCalledWith({ type: 'session.interrupt', id: 'local:nova' });
    act(() => daemonStore.apply({ type: 'error', id: 'local:nova', message: 'No tmux session' }));
    expect(screen.getByRole('status')).toHaveTextContent('Failed: No tmux session');
    expect(button('Interrupt')).toBeEnabled();
  });
  it('Interrupt only when busy; Dismiss only for finished or hook-only sessions', () => {
    const { rerender } = render(<Harness session={fakeSession('local:bix', { state: 'idle' })} />);
    expect(button('Interrupt')).toBeDisabled();
    expect(button('Interrupt')).toHaveAttribute('title', 'Nothing to interrupt');
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    rerender(<Harness session={fakeSession('local:bix', { state: 'exited' })} />);
    expect(screen.queryByRole('button', { name: 'Interrupt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    fireEvent.click(button('Dismiss'));
    expect(send).toHaveBeenCalledWith({ type: 'session.dismiss', id: 'local:bix' });
    rerender(<Harness session={fakeSession('local:hook', { state: 'working', source: 'hook_only' })} />);
    expect(button('Dismiss')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
  it('Rename edits the subject inline: Enter saves, Escape cancels', () => {
    const bix = fakeSession('local:bix', { state: 'idle', topic: 'Old subject' });
    render(<Harness session={bix} />);
    fireEvent.click(button('Rename'));
    const input = screen.getByRole('textbox', { name: 'Session subject' });
    expect(input).toHaveValue('Old subject');
    expect(input).toHaveAttribute('maxlength', '500');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(button('Rename'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Session subject' }), { target: { value: '  New subject ' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Session subject' }).closest('form')!);
    expect(send).toHaveBeenCalledWith({ type: 'session.rename', id: 'local:bix', topic: 'New subject' });
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Old subject');
  });
  it('a frozen session keeps its header but every action is disabled (spec §14)', () => {
    render(<Harness session={fakeSession('devbox:nova', { state: 'working', machineId: 'devbox', machineName: 'Devbox', offline: true })} />);
    for (const name of ['Open terminal', 'Interrupt', 'Stop', 'Rename']) {
      expect(button(name)).toBeDisabled();
      expect(button(name)).toHaveAttribute('title', 'Machine disconnected');
    }
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    fireEvent.click(button('Stop'));
    expect(send).not.toHaveBeenCalled();
    expect(bridge.openTerminal).not.toHaveBeenCalled();
  });
});
