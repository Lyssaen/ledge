import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMemo } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Session } from '@ledge/protocol';
import { daemonStore, type DaemonClient, type MachineState } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { DRAFTS_KEY } from '../src/state/drafts';
import { Composer } from '../src/conversation/Composer';
import { useConversations } from '../src/conversation/useConversations';

const local = [{ id: 'local', label: 'Local', status: 'open', ready: true, recents: [], sessions: [], launcher: null }] as unknown as MachineState[];
const bix = fakeSession('local:bix', { name: 'Bix', state: 'idle' });
const nova = fakeSession('local:nova', { name: 'Nova', state: 'idle' });
const both = [bix, nova];
let send: ReturnType<typeof vi.fn>;
let client: DaemonClient;

beforeEach(() => { localStorage.clear(); daemonStore.reset(); send = vi.fn(); client = { send } as unknown as DaemonClient; });

function Harness({ session, list }: { session: Session; list?: readonly Session[] }) {
  const sessions = useMemo(() => list ?? [session], [list, session]);
  const api = useConversations(client, sessions, local, true);
  return <Composer key={session.id} session={session} api={api} />;
}
const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const hint = () => document.getElementById('reply-hint')!;
const sendButton = () => screen.getByRole('button', { name: 'Send ↑' });
const drafts = () => JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}') as Record<string, string>;

describe('Composer', () => {
  it('Ctrl or ⌘ + Enter sends, Enter alone and an IME composition do not', () => {
    render(<Harness session={bix} />);
    expect(screen.getByRole('textbox', { name: 'Reply to Bix' })).toHaveAttribute('maxlength', '10000');
    expect(box()).toHaveAttribute('placeholder', 'Write your message…');
    expect(hint()).toHaveTextContent('Ctrl / ⌘ + Enter to send · Enter for a new line');
    expect(sendButton()).toBeDisabled();
    fireEvent.change(box(), { target: { value: 'First line\nSecond line' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    expect(send).toHaveBeenCalledWith({ type: 'session.reply', id: 'local:bix', text: 'First line\nSecond line' });
    expect(box()).toHaveValue('');
    expect(hint()).toHaveTextContent('Sent…');
    fireEvent.change(box(), { target: { value: '  /clear  ' } });
    fireEvent.keyDown(box(), { key: 'Enter', metaKey: true });
    expect(send).toHaveBeenLastCalledWith({ type: 'session.reply', id: 'local:bix', text: '/clear' });
    fireEvent.change(box(), { target: { value: 'By the button' } });
    fireEvent.click(sendButton());
    expect(send).toHaveBeenLastCalledWith({ type: 'session.reply', id: 'local:bix', text: 'By the button' });
    expect(send).toHaveBeenCalledTimes(3);
  });
  it('a failed reply comes back into the composer with the reason', () => {
    render(<Harness session={bix} />);
    fireEvent.change(box(), { target: { value: 'Hello' } });
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    act(() => daemonStore.apply({ type: 'error', id: 'local:bix', message: 'Session busy' }));
    expect(hint()).toHaveTextContent('Message not sent: Session busy');
    expect(box()).toHaveValue('Hello');
    fireEvent.change(box(), { target: { value: 'Hello again' } });
    expect(hint()).toHaveTextContent('Ctrl / ⌘ + Enter to send');
  });
  it('refuses free text while a request waits, and freezes on a disconnected or hook-only session with the draft kept', () => {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify({ 'local:bix': 'Half written' }));
    const permission: Session = { ...bix, state: 'waiting_permission', pending: { kind: 'permission', text: 'Run git push?', tool: 'Bash', source: 'hook' } };
    const { rerender } = render(<Harness session={permission} />);
    expect(box()).toBeEnabled();
    expect(box()).toHaveValue('Half written');
    expect(hint()).toHaveTextContent('Answer the request above first.');
    expect(sendButton()).toBeDisabled();
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    expect(send).not.toHaveBeenCalled();
    const question: Session = { ...bix, tool: 'codex', state: 'waiting_input', pending: { kind: 'question', text: 'Which first?', options: ['A', 'B'], source: 'pane' } };
    rerender(<Harness session={question} />);
    expect(hint()).toHaveTextContent('Pick one of the options above.');
    rerender(<Harness session={{ ...question, tool: 'claude' }} />);
    expect(hint()).toHaveTextContent('Ctrl / ⌘ + Enter to send');
    expect(sendButton()).toBeEnabled();
    rerender(<Harness session={{ ...bix, offline: true }} />);
    expect(box()).toBeDisabled();
    expect(box()).toHaveValue('Half written');
    expect(hint()).toHaveTextContent('Machine disconnected: cannot send.');
    expect(sendButton()).toBeDisabled();
    rerender(<Harness session={{ ...bix, source: 'hook_only' }} />);
    expect(box()).toBeDisabled();
    expect(hint()).toHaveTextContent('Read-only session.');
    expect(drafts()).toEqual({ 'local:bix': 'Half written' });
  });
  it('keeps one draft per session', () => {
    const { rerender } = render(<Harness session={bix} list={both} />);
    fireEvent.change(box(), { target: { value: 'For Bix' } });
    rerender(<Harness session={nova} list={both} />);
    expect(screen.getByRole('textbox', { name: 'Reply to Nova' })).toHaveValue('');
    fireEvent.change(box(), { target: { value: 'For Nova' } });
    rerender(<Harness session={bix} list={both} />);
    expect(box()).toHaveValue('For Bix');
    expect(drafts()).toEqual({ 'local:bix': 'For Bix', 'local:nova': 'For Nova' });
  });
  it('forgets the draft of a session that is gone, never the resident\'s', () => {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify({ 'local:bix': 'a', 'local:nova': 'b', ledge: 'c' }));
    const { rerender } = render(<Harness session={bix} list={both} />);
    expect(drafts()).toEqual({ 'local:bix': 'a', 'local:nova': 'b', ledge: 'c' });
    rerender(<Harness session={bix} list={[bix]} />);
    expect(drafts()).toEqual({ 'local:bix': 'a', ledge: 'c' });
  });
  it('editing the draft clears a failed command or decision banner', () => {
    const asking: Session = { ...bix, state: 'waiting_permission', pending: { kind: 'permission', text: 'Run git push?', tool: 'Bash', source: 'hook' } };
    let api!: ReturnType<typeof useConversations>;
    function Probe() {
      const sessions = useMemo(() => [asking], []);
      api = useConversations(client, sessions, local, true);
      return <Composer key={asking.id} session={asking} api={api} />;
    }
    render(<Probe />);
    act(() => api.decide(asking, 'accept'));
    act(() => daemonStore.apply({ type: 'error', id: 'local:bix', message: 'Denied by policy' }));
    expect(api.sends.failed['local:bix']?.kind).toBe('decision');
    fireEvent.change(box(), { target: { value: 'x' } });
    expect(api.sends.failed['local:bix']).toBeUndefined();
  });
});
