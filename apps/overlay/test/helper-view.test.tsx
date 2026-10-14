import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ThreadItem } from '@ledge/protocol';
import { HelperView } from '../src/surface/HelperView';
import { fakeSession } from './mockDaemon';

const at = (s: number) => new Date(Date.UTC(2026, 9, 13, 10, 0, s)).toISOString();
const items: ThreadItem[] = [
  { kind: 'prompt', id: 'prompt-1', at: at(0), turn: 1, text: 'Review the reducer' },
  { kind: 'helper', id: 'h1', at: at(1), turn: 1, task: 'find consumers', agentType: 'Explore', state: 'exited' },
  { kind: 'message', id: 'msg-a1', at: at(2), turn: 1, helperId: 'h1', text: 'Searching the callers.' },
  { kind: 'tool', id: 'toolu_5', at: at(3), turn: 1, helperId: 'h1', tool: 'Grep', label: 'Grep · reduce(', output: 'state.ts:12', status: 'success', files: [] },
  { kind: 'reply', id: 'report-h1', at: at(4), turn: 1, helperId: 'h1', text: 'Three consumers, all in the daemon.' },
  { kind: 'helper', id: 'h2', at: at(5), turn: 1, task: 'review task 1', state: 'working' }
];

describe('<HelperView>', () => {
  it('shows the back row, who delegated, the task, the helper thread and the final report', () => {
    const onBack = vi.fn();
    const ref = createRef<HTMLDivElement>();
    const { container } = render(<HelperView contentRef={ref} session={fakeSession('a')} helperId="h1" items={items} visible onBack={onBack} onClose={() => {}} theme="dark" paused />);
    expect(container.querySelector('[data-back]')).toHaveTextContent('Otto · Main discussion');
    expect(container).toHaveTextContent('Delegated by Otto');
    expect(container).toHaveTextContent('Done');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('find consumers');
    expect(container).toHaveTextContent('Instruction');
    expect(container).toHaveTextContent('Review the reducer');
    expect(container.querySelector('[data-message]')).toHaveTextContent('Searching the callers.');
    expect(container.querySelector('[data-live-tools]')).toBeNull(); // its Grep is done: no tool row is kept
    expect(container).not.toHaveTextContent('reduce(');
    expect(container.querySelector('[data-report]')).toHaveTextContent('Final report');
    expect(container.querySelector('[data-report]')).toHaveTextContent('Three consumers, all in the daemon.');
    // The measured block holds the header and the body, so the panel is sized to both.
    expect(ref.current).toContainElement(container.querySelector('[data-back]'));
    expect(ref.current).toContainElement(container.querySelector('[data-report]'));
    fireEvent.click(container.querySelector('[data-back]')!);
    expect(onBack).toHaveBeenCalled();
  });
  it('keeps the helper\'s live tool line under what the helper said after the call started', () => {
    const live: ThreadItem[] = [
      { kind: 'prompt', id: 'prompt-1', at: at(0), turn: 1, text: 'Review the reducer' },
      { kind: 'helper', id: 'h3', at: at(1), turn: 1, task: 'scan the logs', agentType: 'Explore', state: 'working' },
      { kind: 'message', id: 'msg-b1', at: at(2), turn: 1, helperId: 'h3', text: 'Looking at the logs.' },
      { kind: 'tool', id: 'toolu_6', at: at(3), turn: 1, helperId: 'h3', tool: 'Grep', label: 'Grep · ERROR', status: 'running', files: [] },
      { kind: 'message', id: 'msg-b2', at: at(4), turn: 1, helperId: 'h3', text: 'Still searching.' }
    ];
    const { container } = render(<HelperView session={fakeSession('a')} helperId="h3" items={live} visible onBack={() => {}} onClose={() => {}} theme="dark" paused />);
    const kinds = [...container.querySelectorAll('[data-thread] > [data-item]')].map(e => e.getAttribute('data-item'));
    expect(kinds).toEqual(['message', 'message', 'tools']);
  });
  it('says a working helper is still waiting for its report, and survives an unknown helper', () => {
    const { container, rerender } = render(<HelperView session={fakeSession('a')} helperId="h2" items={items} visible onBack={() => {}} onClose={() => {}} theme="dark" paused />);
    expect(container).toHaveTextContent('Working');
    expect(container).toHaveTextContent('is waiting for its report…');
    expect(container.querySelector('[data-report]')).toBeNull();
    rerender(<HelperView session={fakeSession('a')} helperId="nope" items={items} visible onBack={() => {}} onClose={() => {}} theme="dark" paused />);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });
});
