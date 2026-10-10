import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SessionView, measureSessionH, shownReply } from '../src/surface/SessionView';
import { fakeSession, T0 } from './mockDaemon';

const text = `## Three reducer findings fixed

Steps 1 to 6 are done and green. One point is yours to decide.

### What I did

- Transition table test, 63 cases \`src/daemon/state.test.ts\`
- exited is terminal, pending cleared on SessionEnd

### Verified

- \`pnpm test --filter ledge\`: 112 passed

### Open question

Should a session that comes back keep its pending item or start clean?

- Keep it
- Start clean

### Left to do

1. Step 7, the one-hour soak.
`;
const at = '2026-10-09T18:20:00.000Z';
const now = Date.parse(at) + 20_000;
const idle = fakeSession('r', { state: 'idle', lastReply: { text, at } });
const base = { preview: ['● Bash(pnpm test)', '  ⎿  112 passed'], visible: true, reading: false, draft: '', onDraft: () => {}, onBack: () => {}, onClose: () => {}, onDecide: () => {}, onReply: () => {}, onInterrupt: () => {}, onKill: () => {}, onFocus: () => {}, onToggleReading: () => {}, now };

describe('<SessionView> your turn: the last reply read like a plan', () => {
  it('shows the title, the meta line, the lead and the sections with their markers', () => {
    const { container } = render(<SessionView {...base} session={idle} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Three reducer findings fixed' })).toBeInTheDocument();
    expect(container.querySelector('[data-eyebrow]')).toHaveTextContent('Your turn');
    expect(container.querySelector('[data-reply-meta]')).toHaveTextContent('Otto finished 20s ago · 2 done · 1 question');
    expect(container.querySelector('[data-reply-lead]')).toHaveTextContent('Steps 1 to 6 are done and green.');
    const kickers = [...container.querySelectorAll('[data-kicker]')].map(k => k.textContent);
    expect(kickers).toEqual(['What I did · 2', 'Verified', 'Open question', 'Left to do']);
    expect(container.querySelectorAll('[data-item="done"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-item="verified"]')).toHaveLength(1);
    expect(container.querySelector('[data-next]')).toHaveTextContent('Step 7, the one-hour soak.');
    // Inline code reads as code.
    expect(within(container.querySelector('[data-item="done"]') as HTMLElement).getByText('src/daemon/state.test.ts').tagName).toBe('CODE');
  });
  it('a question shows its chips; a chip fills the draft and focuses the field; the hint says so', () => {
    const onDraft = vi.fn();
    const { container } = render(<SessionView {...base} session={idle} onDraft={onDraft} />);
    const q = screen.getByRole('group', { name: 'Question 1' });
    expect(q).toHaveTextContent('keep its pending item or start clean?');
    fireEvent.click(within(q).getByRole('button', { name: 'Keep it' }));
    expect(onDraft).toHaveBeenCalledWith('Keep it');
    expect(document.activeElement).toBe(container.querySelector('[data-reply]'));
    expect(screen.getByText('A chip fills the field, Enter sends')).toBeInTheDocument();
    fireEvent.click(within(q).getByRole('button', { name: 'Type an answer' }));
    expect(document.activeElement).toBe(container.querySelector('[data-reply]'));
  });
  it('several questions build one line per question, numbered, and the pressed chip reads as pressed', () => {
    const onDraft = vi.fn();
    const multi = fakeSession('m', { name: 'Lu', state: 'idle', lastReply: { at, text: 'Before I start:\n\n1. Stored per screen or derived?\n2. Linked or independent?\n3. Copy the old value?' } });
    render(<SessionView {...base} session={multi} onDraft={onDraft} />);
    expect(screen.getAllByRole('group', { name: /^Question/ })).toHaveLength(3);
    fireEvent.click(within(screen.getByRole('group', { name: 'Question 2' })).getByRole('button', { name: 'independent' }));
    expect(onDraft).toHaveBeenLastCalledWith('2. independent');
    fireEvent.click(within(screen.getByRole('group', { name: 'Question 1' })).getByRole('button', { name: 'Stored per screen' }));
    expect(onDraft).toHaveBeenLastCalledWith('1. Stored per screen\n2. independent');
    expect(within(screen.getByRole('group', { name: 'Question 2' })).getByRole('button', { name: 'independent' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('One line per question, Enter sends')).toBeInTheDocument();
  });
  it('the raw toggle shows the reply as written and back', () => {
    const { container } = render(<SessionView {...base} session={idle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Full reply as written' }));
    expect(container.querySelector('[data-reply-raw]')).toHaveTextContent('### What I did');
    expect(container.querySelector('[data-kicker]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Structured view' }));
    expect(container.querySelector('[data-reply-raw]')).toBeNull();
    expect(container.querySelectorAll('[data-kicker]').length).toBeGreaterThan(0);
  });
  it('the terminal preview folds under the reply, and still opens in reading mode', () => {
    const { container, rerender } = render(<SessionView {...base} session={idle} />);
    expect((container.querySelector('details.ledge-terminal') as HTMLDetailsElement).open).toBe(false);
    rerender(<SessionView {...base} session={idle} reading />);
    expect((container.querySelector('details.ledge-terminal') as HTMLDetailsElement).open).toBe(true);
  });
  it('a plain reply reads as prose under the default title; no reply keeps the view as before', () => {
    const plain = fakeSession('p', { state: 'idle', lastReply: { at, text: 'I created the folder as asked.' } });
    const { container, rerender } = render(<SessionView {...base} session={plain} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Waiting for your instructions.' })).toBeInTheDocument();
    expect(container.querySelector('[data-reply-card]')).toHaveTextContent('I created the folder as asked.');
    expect(screen.getByText('Enter sends to the terminal as typed')).toBeInTheDocument();
    rerender(<SessionView {...base} session={fakeSession('n', { state: 'idle' })} />);
    expect(container.querySelector('[data-reply-card]')).toBeNull();
    expect((container.querySelector('details.ledge-terminal') as HTMLDetailsElement).open).toBe(true);
  });
  it('is not shown while something is asked or the agent works; shown for an ended session under "Session"', () => {
    const asked = { ...idle, state: 'waiting_permission' as const, pending: { kind: 'permission' as const, text: 'npm test', source: 'hook' as const } };
    const { container, rerender } = render(<SessionView {...base} session={asked} />);
    expect(container.querySelector('[data-reply-card]')).toBeNull();
    rerender(<SessionView {...base} session={{ ...idle, state: 'working' }} />);
    expect(container.querySelector('[data-reply-card]')).toBeNull();
    rerender(<SessionView {...base} session={{ ...idle, state: 'exited', exitCode: 0 }} />);
    expect(container.querySelector('[data-reply-card]')).not.toBeNull();
    expect(container.querySelector('[data-eyebrow]')).toHaveTextContent('Session');
    expect(shownReply({ ...idle, state: 'error' })).toBeUndefined();
  });
  it('estimates a taller view for a reply', () => {
    expect(measureSessionH(idle, false)).toBeGreaterThan(measureSessionH(fakeSession('n', { state: 'idle', startedAt: T0 }), false));
  });
});
