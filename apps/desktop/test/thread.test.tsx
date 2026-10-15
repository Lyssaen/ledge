import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useMemo } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Session, ThreadItem } from '@ledge/protocol';
import { daemonStore, type DaemonClient, type MachineState } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { threadBlocks } from '../src/conversation/blocks';
import { Thread } from '../src/conversation/Thread';
import { useConversations } from '../src/conversation/useConversations';

const local = [{ id: 'local', label: 'Local', status: 'open', ready: true, recents: [], sessions: [], launcher: null }] as unknown as MachineState[];
const at = (min: number) => new Date(Date.UTC(2026, 9, 13, 10, min)).toISOString();
const items: ThreadItem[] = [
  { kind: 'prompt', id: 'p1', at: at(0), turn: 1, text: 'Ship the release' },
  { kind: 'tool', id: 't1', at: at(1), turn: 1, tool: 'Bash', label: 'git status', status: 'success', files: [] },
  { kind: 'tool', id: 't2', at: at(2), turn: 1, tool: 'Read', label: '/w/ledge/src/index.ts', status: 'failed', files: [] },
  { kind: 'message', id: 'm1', at: at(3), turn: 1, text: 'Ready to push.' },
  { kind: 'permission', id: 'x1', at: at(4), turn: 1, tool: 'Bash', text: 'git push', decision: 'accept' },
  { kind: 'permission', id: 'x2', at: at(5), turn: 1, tool: 'Bash', text: 'git push --tags' },
  { kind: 'helper', id: 'h1', at: at(6), turn: 1, task: 'Check the changelog', state: 'exited' },
  { kind: 'message', id: 'hm', at: at(7), turn: 1, text: 'Inside the helper', helperId: 'h1' },
  { kind: 'prompt', id: 'p2', at: at(8), turn: 2, text: 'Thanks' },
  { kind: 'message', id: 'm2', at: at(9), turn: 2, text: 'All good' },
  { kind: 'reply', id: 'r2', at: at(10), turn: 2, text: 'All good' }
];
const bix = fakeSession('local:bix', { name: 'Bix', state: 'idle' });
let send: ReturnType<typeof vi.fn>;
let client: DaemonClient;

beforeEach(() => { localStorage.clear(); daemonStore.reset(); send = vi.fn(); client = { send } as unknown as DaemonClient; });

// `also` keeps a second session listed, so leaving one for the other does not prune its preferences.
function Harness({ session, list, also }: { session: Session; list?: ThreadItem[]; also?: Session }) {
  const sessions = useMemo(() => (also ? [session, also] : [session]), [session, also]);
  const api = useConversations(client, sessions, local, true);
  return <Thread key={session.id} session={session} items={list} api={api} />;
}

describe('threadBlocks', () => {
  it('folds each run of tool calls, keeps words, notes decided permissions and helpers, drops helper items and the echo', () => {
    expect(threadBlocks(items)).toEqual([
      { kind: 'user', id: 'p1', text: 'Ship the release' },
      { kind: 'actions', id: 'actions-t1', lines: ['Bash · git status', 'Read · src/index.ts · ✕'] },
      { kind: 'agent', id: 'm1', text: 'Ready to push.' },
      { kind: 'permission', id: 'x1', tool: 'Bash', accepted: true },
      { kind: 'helper', id: 'h1', task: 'Check the changelog', done: true },
      { kind: 'user', id: 'p2', text: 'Thanks' },
      { kind: 'agent', id: 'r2', text: 'All good' }
    ]);
  });
});

describe('Thread', () => {
  it('renders the turns with folded actions whose state is kept per session', () => {
    const { container, unmount } = render(<Harness session={bix} list={items} />);
    expect(screen.getByRole('region', { name: 'Conversation history with Bix' })).toBeInTheDocument();
    expect(container.querySelector('.thread-start')).toHaveTextContent(/^Session started · /);
    expect([...container.querySelectorAll('.thread-message')].map(m => [m.className, m.querySelector('.message-author')!.textContent]))
      .toEqual([['thread-message user', 'You'], ['thread-message agent', 'Bix'], ['thread-message user', 'You'], ['thread-message agent', 'Bix']]);
    expect(screen.getByText('Allowed · Bash')).toHaveClass('thread-notice');
    expect(screen.getByText('Helper · Check the changelog · done')).toHaveClass('thread-notice');
    const fold = container.querySelector('details[data-fold="actions-t1"]') as HTMLDetailsElement;
    expect(fold.querySelector('summary')).toHaveTextContent('2 actions · Show details');
    expect(fold.open).toBe(false);
    act(() => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
    expect(JSON.parse(localStorage.getItem('desktop.thread')!)['local:bix'].open).toEqual(['actions-t1']);
    unmount();
    const again = render(<Harness session={bix} list={items} />);
    expect((again.container.querySelector('details[data-fold="actions-t1"]') as HTMLDetailsElement).open).toBe(true);
  });
  it('without a thread, says the history is partial and shows the last reply', () => {
    const s = { ...bix, lastReply: { text: 'Done, see the PR.', at: at(1) } };
    const { container } = render(<Harness session={s} />);
    expect(container.querySelector('.thread-start')).toHaveTextContent('Partial history · only the last reply is known.');
    expect(container.querySelector('.thread-message.agent')).toHaveTextContent('Done, see the PR.');
  });
});

describe('Thread reading position', () => {
  const desc = (k: 'scrollTop' | 'scrollHeight' | 'clientHeight') => Object.getOwnPropertyDescriptor(HTMLElement.prototype, k);
  const saved = { scrollTop: desc('scrollTop'), scrollHeight: desc('scrollHeight'), clientHeight: desc('clientHeight') };
  beforeEach(() => {
    const tops = new WeakMap<HTMLElement, number>();
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', { configurable: true, get(this: HTMLElement) { return tops.get(this) ?? 0; }, set(this: HTMLElement, v: number) { tops.set(this, v); } });
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(HTMLElement.prototype, k, d); else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k]; }
  });
  const scroller = (c: HTMLElement) => c.querySelector('.thread-scroll') as HTMLElement;

  it('opens at the end, or where the reader left this session', () => {
    const first = render(<Harness session={bix} list={items} />);
    expect(scroller(first.container).scrollTop).toBe(1000);
    first.unmount();
    localStorage.setItem('desktop.thread', JSON.stringify({ 'local:bix': { open: [], scroll: 300 } }));
    const { container } = render(<Harness session={bix} list={items} />);
    expect(scroller(container).scrollTop).toBe(300);
  });
  it('waits for the thread before restoring the position', () => {
    localStorage.setItem('desktop.thread', JSON.stringify({ 'local:bix': { open: [], scroll: 300 } }));
    const { container, rerender } = render(<Harness session={bix} />);
    fireEvent.scroll(scroller(container));
    rerender(<Harness session={bix} list={items} />);
    expect(scroller(container).scrollTop).toBe(300);
    expect(JSON.parse(localStorage.getItem('desktop.thread')!)['local:bix'].scroll).toBe(300);
  });
  it('saves the position 250 ms after scrolling, and on leaving the session', () => {
    vi.useFakeTimers();
    const nova = fakeSession('local:nova', { name: 'Nova' });
    const { container, rerender } = render(<Harness session={bix} list={items} also={nova} />);
    const el = scroller(container);
    el.scrollTop = 420; fireEvent.scroll(el);
    act(() => { vi.advanceTimersByTime(249); });
    expect(localStorage.getItem('desktop.thread')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(JSON.parse(localStorage.getItem('desktop.thread')!)['local:bix'].scroll).toBe(420);
    el.scrollTop = 120; fireEvent.scroll(el);
    rerender(<Harness session={nova} list={items} also={bix} />);
    expect(JSON.parse(localStorage.getItem('desktop.thread')!)['local:bix'].scroll).toBe(120);
  });
});

describe('RequestBlock', () => {
  const otto = fakeSession('local:otto', { name: 'Otto', state: 'waiting_permission', pending: { kind: 'permission', text: 'Run git push?', tool: 'Bash', source: 'hook' } });
  it('a decision from the thread shows « Sent… », and an error reopens it', () => {
    const { container } = render(<Harness session={otto} list={[]} />);
    const request = container.querySelector('.thread-request')!;
    expect(request).toHaveClass('waiting_permission');
    expect(request).toHaveTextContent('Approval request · Bash');
    expect(request).toHaveTextContent('Run git push?');
    expect(request.querySelector('small')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(send).toHaveBeenCalledWith({ type: 'session.decide', id: 'local:otto', decision: 'accept' });
    expect(screen.getByRole('status')).toHaveTextContent('Sent…');
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    act(() => daemonStore.apply({ type: 'error', id: 'local:otto', message: 'Request expired' }));
    expect(screen.getByRole('status')).toHaveTextContent('Not sent: Request expired');
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'session.decide', id: 'local:otto', decision: 'deny' });
  });
  it('a question offers its options (1-based) and the free answer only where it can be sent', () => {
    const pending = { kind: 'question' as const, text: 'Which first?', options: ['The product', 'The uses'], optionDetails: ['Lead with the product', ''], source: 'pane' as const };
    const luna = fakeSession('local:luna', { name: 'Luna', state: 'waiting_input', pending });
    const { container, unmount } = render(<Harness session={luna} list={[]} />);
    const product = screen.getByRole('button', { name: 'The product' });
    expect(product).toHaveAttribute('data-option', '1');
    expect(product).toHaveAttribute('title', 'Lead with the product');
    expect(screen.getByRole('button', { name: 'The uses' })).not.toHaveAttribute('title');
    expect(container.querySelector('.thread-request small')).toHaveTextContent('Or give your answer in the field below.');
    fireEvent.click(screen.getByRole('button', { name: 'The uses' }));
    expect(send).toHaveBeenCalledWith({ type: 'session.reply', id: 'local:luna', text: '2' });
    unmount();
    const codex = render(<Harness session={{ ...luna, id: 'local:cx', tool: 'codex' }} list={[]} />);
    expect(codex.container.querySelector('.thread-request small')).toBeNull();
  });
  it('a frozen or hook-only session shows the request without letting you decide', () => {
    const { rerender } = render(<Harness session={{ ...otto, offline: true }} list={[]} />);
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
    rerender(<Harness session={{ ...otto, id: 'local:hook', source: 'hook_only' }} list={[]} />);
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(send).not.toHaveBeenCalled();
  });
});
