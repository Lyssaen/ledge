import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  it('folds the previous turn, shows the current one in order and leaves the current reply to the card', () => {
    const { container } = render(<Thread session={fakeSession('a')} items={items} t={t} theme="dark" paused />);
    const prev = container.querySelector('[data-previous-turn]')!;
    expect(prev).toHaveTextContent('Previous turn');
    expect(prev).toHaveTextContent('Old answer');
    expect(prev).not.toHaveAttribute('open');
    const kinds = [...container.querySelectorAll('[data-thread] > [data-item]')].map(e => e.getAttribute('data-item'));
    expect(kinds).toEqual(['previous-turn', 'prompt', 'message', 'action', 'action', 'action', 'action', 'permission']);
    expect(container.querySelector('[data-prompt]')).toHaveTextContent('You');
    expect(container.querySelector('[data-prompt]')).toHaveTextContent('Run the tests');
    expect(container.querySelector('[data-message]')).toHaveTextContent('Running them now.');
    expect(container).not.toHaveTextContent('Done.');
    expect(container.textContent).not.toMatch(/\b[2-9] (actions|files|questions)\b/); // no counters, anywhere
  });
  it('unfolds an action with its command, result, state and duration; says what is missing', () => {
    const { container } = render(<Thread session={fakeSession('a')} items={items} t={t} theme="dark" paused />);
    const [ok, running, failed, silent] = [...container.querySelectorAll('[data-action]')];
    expect(ok).toHaveAttribute('data-status', 'success');
    fireEvent.click(ok!.querySelector('summary')!);
    expect(ok).toHaveTextContent('Command');
    expect(ok!.querySelector('[data-action-output]')).toHaveTextContent('12 passed');
    expect(ok).toHaveTextContent('Result received');
    expect(ok).toHaveTextContent('1s');
    expect(running).toHaveAttribute('data-status', 'running');
    expect(running).toHaveTextContent('Running');
    const file = running!.querySelector('[data-file]')!;
    expect(file).toHaveAttribute('data-confirmed', 'false');
    expect(file).toHaveTextContent('/w/a.ts');
    expect(file).toHaveTextContent('Being written');
    fireEvent.click(file.querySelector('summary')!);
    expect(file).toHaveTextContent('- a');
    expect(failed).toHaveAttribute('data-status', 'failed');
    fireEvent.click(failed!.querySelector('summary')!);
    expect(failed).toHaveTextContent('Error');
    expect(failed).toHaveTextContent('exit 1');
    fireEvent.click(silent!.querySelector('summary')!);
    expect(silent).toHaveTextContent('No result in this source.');
    expect(silent).toHaveTextContent('Duration unavailable');
    expect(container.querySelector('[data-permission]')).toHaveAttribute('data-decision', 'deny');
    expect(container.querySelector('[data-permission]')).toHaveTextContent('Denied');
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
  it('keys file rows by position: one action touching the same path twice renders both without a key clash', () => {
    const errors: unknown[] = []; const orig = console.error; console.error = (...a: unknown[]) => { errors.push(a); };
    try {
      const tool = { kind: 'tool' as const, id: 'toolu_m', at: '2026-10-13T10:00:00.000Z', turn: 1, tool: 'MultiEdit', label: 'MultiEdit · a.ts', status: 'success' as const,
        files: [{ path: '/w/a.ts', change: 'edit' as const, diff: '- a\n+ b' }, { path: '/w/a.ts', change: 'edit' as const, diff: '- c\n+ d' }] };
      const { container } = render(<Thread session={fakeSession('a')} items={[{ kind: 'prompt', id: 'prompt-1', at: tool.at, turn: 1, text: 'go' }, tool]} t={t} theme="dark" paused />);
      expect(container.querySelectorAll('[data-action] [data-file]').length).toBe(2);
      expect(errors.filter(e => String((e as unknown[])[0]).includes('same key'))).toEqual([]);
    } finally { console.error = orig; }
  });
});
