import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { ThreadItem, ToolItem } from '@ledge/protocol';
import { messagesFor } from '../src/i18n/lang';
import { Thread } from '../src/surface/Thread';
import { fakeSession } from './mockDaemon';
import { liveTool, target } from '../src/thread/tools';
import { LiveToolLine, LIVE } from '../src/surface/LiveToolLine';

const t = messagesFor('en');
const T0 = Date.UTC(2026, 9, 14, 10, 0, 0);
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const tool = (id: string, s: number, tool: string, label: string, extra: Partial<ToolItem> = {}): ToolItem =>
  ({ kind: 'tool', id, at: at(s), turn: 2, tool, label, status: 'success', files: [], ...extra });

const items: ThreadItem[] = [
  { kind: 'prompt', id: 'p2', at: at(0), turn: 2, text: 'Fix the flaky test' },
  { kind: 'message', id: 'm1', at: at(1), turn: 2, text: 'Looking.' },
  tool('t1', 2, 'Read', '/home/jde/soft/ledge/apps/overlay/src/surface/Thread.tsx', { durationMs: 300 }),
  tool('t2', 3, 'Grep', 'Grep · ActionRow', { durationMs: 200 }),
  tool('t3', 4, 'Read', '/w/a.ts', { durationMs: 100 }),
  tool('t4', 5, 'Edit', '/w/a.ts', { durationMs: 800, files: [{ path: '/w/a.ts', change: 'edit', diff: '- a\n+ b' }] }),
  tool('t5', 6, 'Read', '/w/b.ts', { durationMs: 100 }),
  tool('t6', 7, 'Write', '/w/c.ts', { status: 'failed', error: 'EACCES', files: [{ path: '/w/c.ts', change: 'write' }] }),
  tool('t7', 8, 'Bash', 'pnpm vitest run test/thread.test.tsx --reporter=dot --coverage', { status: 'running', input: 'pnpm vitest run test/thread.test.tsx' })
];

// The suite runs with VITE_LEDGE_MOTION=0; the roll test is about the motion, so this file keeps real durations.
// Every other render here passes `reducedMotion`, which stills the line regardless.
vi.mock('../src/motion', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/motion')>()), ms: (n: number) => `${Math.round(n)}ms` }));

afterEach(() => { vi.useRealTimers(); });

describe('thread/tools helpers', () => {
  it('abbreviates a target: a path to its last two segments, a command to its first line, a "Tool · x" fixture to x', () => {
    expect(target(items[2] as ToolItem)).toBe('surface/Thread.tsx');
    expect(target(items[3] as ToolItem)).toBe('ActionRow');
    expect(target(items[8] as ToolItem)).toBe('pnpm vitest run test/thread.test.tsx…');
    expect(target(tool('x', 0, 'Bash', 'git status\n# second line'))).toBe('git status');
    expect(target(tool('x', 0, 'Task', 'Task'))).toBe('');
    expect(target(tool('x', 0, 'Grep', '{"pattern":"ActionRow","path":"apps/overlay/src"}'))).toBe('ActionRow');
  });
  it('finds the latest running tool', () => {
    expect(liveTool(items)?.id).toBe('t7');
    expect(liveTool(items.slice(0, 8))).toBeUndefined();
  });
});

describe('<LiveToolLine>', () => {
  it('shows only the running tool on one line, with spinner, name, short target and elapsed time; nothing without one', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<LiveToolLine items={items} t={t} now={T0 + 11_000} reducedMotion />);
    const rows = container.querySelectorAll('[data-live-tool]');
    expect(rows).toHaveLength(1);
    expect(container.querySelector('[data-live-tools]')).toHaveAttribute('aria-label', 'Running tool');
    expect(rows[0]).toHaveTextContent('Bash');
    expect(rows[0]).toHaveTextContent('pnpm vitest run test/thread.test.tsx…');
    expect(rows[0]!.querySelector('[data-elapsed]')).toHaveTextContent('3s');
    expect(rows[0]!.querySelector('[data-spinner]')).toBeInTheDocument();
    expect(rows[0]!.querySelector('[data-mark]')).toBeNull();
    expect(container).not.toHaveTextContent('Read'); // finished tools are not listed
    // the tool ends: the spinner becomes its outcome mark, held a moment; reduced motion skips the fade, not the mark
    rerender(<LiveToolLine items={[...items.slice(0, 8), { ...(items[8] as ToolItem), status: 'success' as const, durationMs: 2_800 }]} t={t} now={T0 + 11_000} reducedMotion />);
    const held = container.querySelector('[data-live-tool]')!;
    expect(held).toHaveAttribute('data-phase', 'done');
    expect(held.querySelector('[data-mark]')).toHaveAttribute('data-mark', 'success');
    expect(held.querySelector('[data-mark]')).toHaveTextContent('✓');
    expect(held.querySelector('[data-elapsed]')).toHaveTextContent('3s');
    act(() => { vi.advanceTimersByTime(LIVE.holdMs + 10); });
    expect(container.querySelector('[data-live-tool]')).toBeNull();
    // nothing runs: nothing is rendered
    rerender(<LiveToolLine items={items.slice(0, 8)} t={t} now={T0 + 11_000} reducedMotion />);
    expect(container.querySelector('[data-live-tools]')).toBeNull();
  });
  it('marks a failure with a cross before the line goes', () => {
    vi.useFakeTimers();
    const running = [...items.slice(0, 8), tool('t9', 9, 'Write', '/w/e.ts', { status: 'running' })];
    const { container, rerender } = render(<LiveToolLine items={running} t={t} now={T0 + 10_000} reducedMotion />);
    rerender(<LiveToolLine items={[...items.slice(0, 8), tool('t9', 9, 'Write', '/w/e.ts', { status: 'failed', error: 'EACCES' })]} t={t} now={T0 + 10_000} reducedMotion />);
    const mark = container.querySelector('[data-mark]')!;
    expect(mark).toHaveAttribute('data-mark', 'failed');
    expect(mark).toHaveTextContent('✕');
    act(() => { vi.advanceTimersByTime(LIVE.holdMs + 10); });
    expect(container.querySelector('[data-live-tools]')).toBeNull();
  });
  it('holds the mark, then fades the line out when the tool ends and rolls to the next one when another starts', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<LiveToolLine items={items} t={t} now={T0 + 9_000} />);
    const first = container.querySelector('[data-live-tool]')!;
    expect(first).toHaveAttribute('data-phase', 'enter');
    act(() => { vi.advanceTimersByTime(50); });
    expect(first).toHaveAttribute('data-phase', 'live');
    // the tool ends and another starts at once: the mark holds first, the next line waits
    const next = [...items.slice(0, 8), { ...(items[8] as ToolItem), status: 'success' as const, durationMs: 900 }, tool('t8', 9, 'Read', '/w/d.ts', { status: 'running' })];
    rerender(<LiveToolLine items={next} t={t} now={T0 + 9_500} />);
    expect(container.querySelectorAll('[data-live-tool]')).toHaveLength(1);
    expect(first).toHaveAttribute('data-phase', 'done');
    expect(first.querySelector('[data-mark]')).toHaveAttribute('data-mark', 'success');
    // then the old line leaves upwards and the new one enters from below
    act(() => { vi.advanceTimersByTime(LIVE.holdMs + 10); });
    const rows = container.querySelectorAll('[data-live-tool]');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-phase', 'exit'); expect(rows[0]).toHaveAttribute('data-exit', 'up');
    expect(rows[0]!.querySelector('[data-mark]')).toHaveTextContent('✓'); // the mark rides along
    expect(rows[1]).toHaveTextContent('d.ts');
    act(() => { vi.advanceTimersByTime(400); });
    expect(container.querySelectorAll('[data-live-tool]')).toHaveLength(1);
    // the last tool ends: the mark holds, the line fades, then nothing is left
    rerender(<LiveToolLine items={[...next.slice(0, 9), { ...(next[9] as ToolItem), status: 'success' as const }]} t={t} now={T0 + 10_000} />);
    expect(container.querySelector('[data-live-tool]')).toHaveAttribute('data-phase', 'done');
    act(() => { vi.advanceTimersByTime(LIVE.holdMs + 10); });
    const leaving = container.querySelector('[data-live-tool]')!;
    expect(leaving).toHaveAttribute('data-phase', 'exit'); expect(leaving).toHaveAttribute('data-exit', 'fade');
    act(() => { vi.advanceTimersByTime(400); });
    expect(container.querySelector('[data-live-tools]')).toBeNull();
  });
});

describe('<Thread> with the live line', () => {
  it('stands one live line where the turn\'s tool rows were, and keeps the other rows', () => {
    const { container } = render(<Thread session={fakeSession('a')} items={items} t={t} theme="dark" paused reducedMotion now={T0 + 10_000} />);
    expect(container.querySelectorAll('[data-action]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-live-tool]')).toHaveLength(1);
    expect(container.querySelector('[data-live-tool]')).toHaveTextContent('Bash');
    expect(container).not.toHaveTextContent('EACCES'); // a finished call's result is not in the thread any more
    expect(container.querySelector('[data-prompt]')).toHaveTextContent('Fix the flaky test');
    expect([...container.querySelectorAll('[data-thread] > [data-item]')].map(e => e.getAttribute('data-item'))).toEqual(['prompt', 'message', 'tools']);
  });
});
