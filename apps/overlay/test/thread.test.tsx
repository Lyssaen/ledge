import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ThreadItem } from '@ledge/protocol';
import { Thread } from '../src/surface/Thread';
import { messagesFor } from '../src/i18n/lang';
import { fakeSession } from './mockDaemon';

const t = messagesFor('en');
const at = (s: number) => new Date(Date.UTC(2026, 9, 13, 10, 0, s)).toISOString();
const items: ThreadItem[] = [
  { kind: 'prompt', id: 'prompt-1', at: at(0), turn: 1, text: 'Old ask' },
  { kind: 'reply', id: 'reply-1', at: at(1), turn: 1, text: 'Old answer' },
  { kind: 'prompt', id: 'prompt-2', at: at(10), turn: 2, text: 'Run the tests' },
  { kind: 'message', id: 'msg-1', at: at(11), turn: 2, text: 'Running them now.' },
  { kind: 'tool', id: 'toolu_1', at: at(12), turn: 2, tool: 'Bash', label: 'Bash · pnpm test', input: 'pnpm test', output: '12 passed', status: 'success', durationMs: 812, files: [] },
  { kind: 'tool', id: 'toolu_2', at: at(13), turn: 2, tool: 'Edit', label: 'Edit · a.ts', status: 'running', files: [{ path: '/w/a.ts', change: 'edit', diff: '- a\n+ b' }] },
  { kind: 'tool', id: 'toolu_3', at: at(14), turn: 2, tool: 'Bash', label: 'Bash · rm', status: 'failed', error: 'exit 1', files: [] },
  { kind: 'tool', id: 'toolu_4', at: at(15), turn: 2, tool: 'Read', label: 'Read · b.ts', status: 'success', files: [] },
  { kind: 'permission', id: 'perm-1', at: at(16), turn: 2, tool: 'Bash', text: 'rm -rf dist', decision: 'deny' },
  { kind: 'reply', id: 'reply-2', at: at(17), turn: 2, text: 'Done.' }
];

describe('<Thread>', () => {
  it('shows the whole conversation as one thread, oldest first, nothing folded, and leaves the current reply to the card', () => {
    const { container } = render(<Thread session={fakeSession('a')} items={items} t={t} theme="dark" paused />);
    expect(container.querySelector('details')).toBeNull(); // no turn to unfold
    expect(container).not.toHaveTextContent('Previous turn');
    const rows = [...container.querySelectorAll('[data-thread] > [data-item]')];
    expect(rows.map(e => e.getAttribute('data-item'))).toEqual(['prompt', 'reply', 'prompt', 'message', 'permission', 'tools']);
    expect(rows[0]).toHaveTextContent('Old ask');
    expect(rows[1]).toHaveTextContent('Old answer'); // an earlier answer reads in place, like a message
    expect(container.querySelector('[data-prompt]')).toHaveTextContent('You');
    expect(rows[2]).toHaveTextContent('Run the tests');
    expect(container.querySelector('[data-message]')).toHaveTextContent('Running them now.');
    expect(container).not.toHaveTextContent('Done.');
    expect(container.textContent).not.toMatch(/\b[2-9] (actions|files|questions)\b/); // no counters, anywhere
  });
  it('shows the current reply in the thread when no card stands for it, and keeps the live tool line last of the whole thread', () => {
    const running = items.concat({ kind: 'prompt', id: 'prompt-3', at: at(20), turn: 3, text: 'And now?' },
      { kind: 'tool', id: 'toolu_9', at: at(21), turn: 3, tool: 'Bash', label: 'Bash · ls', status: 'running', files: [] },
      { kind: 'message', id: 'msg-9', at: at(22), turn: 3, text: 'Listing.' });
    const { container } = render(<Thread session={fakeSession('a')} items={running} t={t} theme="dark" paused hideCurrentReply={false} />);
    const kinds = [...container.querySelectorAll('[data-thread] > [data-item]')].map(e => e.getAttribute('data-item'));
    expect(kinds).toEqual(['prompt', 'reply', 'prompt', 'message', 'permission', 'reply', 'prompt', 'message', 'tools']);
    expect(container.querySelectorAll('[data-live-tool]')).toHaveLength(1);
    expect(container.querySelector('[data-live-tool]')).toHaveTextContent('ls');
  });
  it('shows the running tool on one live line, keeps finished calls out of the thread and the permission with its decision', () => {
    const { container } = render(<Thread session={fakeSession('a')} items={items} t={t} theme="dark" paused now={Date.UTC(2026, 9, 13, 10, 0, 20)} />);
    const live = container.querySelectorAll('[data-live-tool]');
    expect(live).toHaveLength(1);
    expect(live[0]).toHaveTextContent('Edit');
    expect(live[0]).toHaveTextContent('a.ts');
    expect(live[0]!.querySelector('[data-spinner]')).toBeInTheDocument();
    expect(live[0]!.querySelector('[data-elapsed]')).toHaveTextContent('7s');
    expect(container.querySelector('[data-action]')).toBeNull();
    expect(container).not.toHaveTextContent('12 passed');
    expect(container).not.toHaveTextContent('exit 1');
    expect(container.querySelector('[data-permission]')).toHaveAttribute('data-decision', 'deny');
    expect(container.querySelector('[data-permission]')).toHaveTextContent('Denied');
  });
  it('keeps the live tool line last in the turn, under what the agent said after the call started', () => {
    // The agent speaks while a tool still runs (or a permission is asked): the thread stays chronological, tool line last.
    const turn: ThreadItem[] = [
      { kind: 'prompt', id: 'p', at: at(0), turn: 1, text: 'Fix it' },
      { kind: 'tool', id: 'toolu_a', at: at(1), turn: 1, tool: 'Bash', label: 'Bash · pnpm test', status: 'running', files: [] },
      { kind: 'message', id: 'm', at: at(2), turn: 1, text: 'Tests are running.' },
      { kind: 'permission', id: 'perm', at: at(3), turn: 1, tool: 'Bash', text: 'rm -rf dist' }
    ];
    const { container } = render(<Thread session={fakeSession('a')} items={turn} t={t} theme="dark" paused />);
    const kinds = [...container.querySelectorAll('[data-thread] > [data-item]')].map(e => e.getAttribute('data-item'));
    expect(kinds).toEqual(['prompt', 'message', 'permission', 'tools']);
  });
  it('tells what a Cursor session cannot show and what an empty thread waits for', () => {
    const { container, rerender } = render(<Thread session={fakeSession('c', { tool: 'cursor' })} items={items.slice(2, 3)} t={t} theme="dark" paused />);
    expect(container.querySelector('[data-source-note]')).toHaveTextContent('neither results nor intermediate messages');
    rerender(<Thread session={fakeSession('a')} items={[]} t={t} theme="dark" paused />);
    expect(screen.getByText('The thread fills up with the agent’s next event.')).toBeInTheDocument();
    expect(container.querySelector('[data-source-note]')).toBeNull();
    // An empty Cursor thread is where the note helps most.
    rerender(<Thread session={fakeSession('c', { tool: 'cursor' })} items={[]} t={t} theme="dark" paused />);
    expect(screen.getByText('The thread fills up with the agent’s next event.')).toBeInTheDocument();
    expect(container.querySelector('[data-thread][data-empty] [data-source-note]')).toHaveTextContent('neither results nor intermediate messages');
  });
});
