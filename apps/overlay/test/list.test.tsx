import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SessionList, rowHint } from '../src/surface/SessionList';
import { displayOrder } from '../src/surface/groups';
import { fakeSession } from './mockDaemon';

const sessions = [
  fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' }, topic: 'Mascotte et tray', branch: 'main', repo: 'harness-assistant', repoPath: '/w/harness-assistant' }),
  fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', cwd: '/w/speos-api', startedAt: '2026-10-09T18:01:00.000Z', branch: 'worktree-codex', worktree: true, repo: 'speos-api', repoPath: '/w/speos-api' }),
  fakeSession('c', { name: 'Bix', source: 'hook_only', tmuxSession: null, cwd: '/w/notes', project: 'notes', startedAt: '2026-10-09T18:02:00.000Z' }),
  fakeSession('d', { name: 'Lu', state: 'exited', exitCode: 0, cwd: '/w/blog', project: 'blog', startedAt: '2026-10-09T18:03:00.000Z' })
];

describe('<SessionList>', () => {
  it('shows counts, rows with badges, and highlights the oldest ask', () => {
    render(<SessionList sessions={sessions} visible selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} />);
    expect(screen.getByText('4 sessions · 1 waiting for you')).toBeInTheDocument();
    const rows = screen.getAllByRole('button', { name: /open/ });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveStyle({ backgroundColor: 'var(--secondary)', borderLeftColor: 'var(--sidebar-primary)' });
    expect(within(rows[0]!).getByText('Approval')).toBeInTheDocument();
    // Line 1 is the topic (or the placeholder), line 2 the name, the branch chip and the age; the badge sits on line 2.
    expect(within(rows[0]!).getByText('Mascotte et tray')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('No topic yet')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('codex').closest('[data-branch]')).toHaveAttribute('title', 'worktree worktree-codex');
    expect(within(rows[1]!).getByText(/^Pim$/)).toBeInTheDocument();
    expect(rows[1]).toHaveAttribute('title', 'Codex · /w/speos-api');
    // One header per repository (the fixture has four), each with its count.
    expect(screen.getByText('harness-assistant')).toBeInTheDocument();
    expect(screen.getAllByText(/^\d+ bots?$/)).toHaveLength(4);
    expect(within(rows[2]!).getByText('Read only')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Done')).toBeInTheDocument();
  });
  it('marks the selected row as current, with no row numbers', () => {
    render(<SessionList sessions={sessions} visible selectedId="b" dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} />);
    expect(screen.queryByText('2')).toBeNull();
    expect(screen.getByRole('button', { name: /speos-api/ })).toHaveAttribute('aria-current', 'true');
  });
  it('clicks open a row, toggle dnd and collapse', () => {
    const onOpen = vi.fn(), onToggleDnd = vi.fn(), onClose = vi.fn();
    render(<SessionList sessions={sessions} visible selectedId={null} dnd onToggleDnd={onToggleDnd} onOpen={onOpen} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /speos-api/ })); expect(onOpen).toHaveBeenCalledWith('b');
    // Do not disturb is both the header icon and the footer text toggle, as in the mockup.
    const dnd = screen.getAllByRole('button', { name: 'Do not disturb' });
    expect(dnd).toHaveLength(2);
    fireEvent.click(dnd[1]!); expect(onToggleDnd).toHaveBeenCalled();
    for (const b of dnd) expect(b).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' })); expect(onClose).toHaveBeenCalled();
  });
  it('rows cascade with increasing delays', () => {
    render(<SessionList sessions={sessions} visible selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} />);
    const rows = screen.getAllByRole('button', { name: /open/ });
    expect(rows[0]!.style.transition).toContain('0ms');
    expect(rows[0]!.getAttribute('data-delay')).toBe('150');
    expect(rows[3]!.getAttribute('data-delay')).toBe('222');
  });
  it('the cascade follows the layer\'s own entry delay', () => {
    render(<SessionList sessions={sessions} visible selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} enterDelay={280} />);
    const rows = screen.getAllByRole('button', { name: /open/ });
    expect(rows[0]!.getAttribute('data-delay')).toBe('310');
    expect(rows[3]!.getAttribute('data-delay')).toBe('382');
  });
});

describe('<SessionList> grouping', () => {
  it('lists rows in display order when repositories interleave', () => {
    const x = (id: string) => fakeSession(id, { name: id.toUpperCase(), repo: 'X', repoPath: '/w/x', cwd: '/w/x' });
    const mixed = [x('a'), fakeSession('c', { name: 'C', repo: 'Y', repoPath: '/w/y', cwd: '/w/y' }), x('b')];
    render(<SessionList sessions={displayOrder(mixed)} visible selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} />);
    const rows = screen.getAllByRole('button', { name: /open/ });
    expect(rows.map(r => r.parentElement!.getAttribute('data-row-id'))).toEqual(['a', 'b', 'c']);
  });
});

describe('<SessionList> launching', () => {
  it('the header + opens the form; an empty list shows the empty state with its own button', () => {
    const onLaunch = vi.fn();
    const { rerender } = render(<SessionList sessions={sessions} visible selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} onLaunch={onLaunch} />);
    fireEvent.click(screen.getByRole('button', { name: 'New session' })); expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-empty]')).toBeNull();
    rerender(<SessionList sessions={[]} visible selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} onLaunch={onLaunch} />);
    expect(screen.getByText('No sessions')).toBeInTheDocument();
    expect(screen.getByText('Nobody at work.')).toBeInTheDocument();
    expect(screen.getByText('ledge claude')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'New session' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!); expect(onLaunch).toHaveBeenCalledTimes(2);
  });
  it('without onLaunch neither button exists', () => {
    render(<SessionList sessions={[]} visible selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'New session' })).toBeNull();
    expect(document.querySelector('[data-empty]')).not.toBeNull();
  });
  it('a notice shows under the header with its action', () => {
    const onClick = vi.fn();
    render(<SessionList sessions={sessions} visible selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} notice={{ text: 'Juno is starting in api-gateway.', action: { label: 'Open the terminal', onClick } }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Juno is starting in api-gateway.');
    fireEvent.click(screen.getByRole('button', { name: /Open the terminal/ })); expect(onClick).toHaveBeenCalled();
  });
  it('the update card sits between the header and the ask field, and the gear carries a pip and its label', () => {
    render(<SessionList sessions={sessions} visible selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} onAsk={() => {}} update={<div>card</div>} gearPip gearLabel="Settings, Ledge 0.3.0 is ready" />);
    const layer = document.querySelector('[data-layer="list"]')!;
    expect(layer.querySelector('[data-update]')).toHaveTextContent('card');
    expect(layer.querySelector('[data-brand]')!.compareDocumentPosition(layer.querySelector('[data-update]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(layer.querySelector('[data-update]')!.compareDocumentPosition(layer.querySelector('[data-ask-field]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const gear = screen.getByRole('button', { name: 'Settings, Ledge 0.3.0 is ready' });
    expect(gear.querySelector('[data-gear-pip]')).not.toBeNull();
  });
  it('no gear pip without an update', () => {
    render(<SessionList sessions={sessions} visible selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} />);
    expect(document.querySelector('[data-gear-pip]')).toBeNull();
  });
});

describe('rowHint', () => {
  it('matches the badge: idle reads available, working reads running; pending, read-only, exited and error keep theirs', () => {
    expect(rowHint(fakeSession('i', { state: 'idle' }))).toBe('available');
    expect(rowHint(fakeSession('w', { state: 'working' }))).toBe('running');
    expect(rowHint(sessions[0]!)).toBe('npm test');
    expect(rowHint(sessions[2]!)).toBe('started without ledge');
    expect(rowHint(sessions[3]!)).toBe('exited 0');
    expect(rowHint(fakeSession('e', { state: 'error', lastError: 'boom' }))).toBe('boom');
  });
  it('an idle session with helpers still working says so, with their count', () => {
    const h = (id: string, state: 'working' | 'exited' | 'waiting_permission') => ({ id, kind: 'general-purpose', task: 'review', state });
    expect(rowHint(fakeSession('i', { state: 'idle', helpers: [h('a', 'working')] }))).toBe('available · 1 subagent working');
    expect(rowHint(fakeSession('i', { state: 'idle', helpers: [h('a', 'working'), h('b', 'waiting_permission'), h('c', 'exited')] }))).toBe('available · 2 subagents working');
    expect(rowHint(fakeSession('i', { state: 'idle', helpers: [h('c', 'exited')] }))).toBe('available');
    expect(rowHint(fakeSession('w', { state: 'working', helpers: [h('a', 'working')] }))).toBe('running');
  });
  describe('remove from list', () => {
    const props = { visible: true, selectedId: null, dnd: false, onToggleDnd: () => {}, onClose: () => {} };
    it('only finished and read-only rows carry the button; it dismisses without opening the row', () => {
      const onOpen = vi.fn(); const onDismiss = vi.fn();
      render(<SessionList {...props} sessions={sessions} onOpen={onOpen} onDismiss={onDismiss} />);
      const buttons = screen.getAllByRole('button', { name: /^Remove from list/ });
      expect(buttons.map(b => b.closest('[data-row-id]')!.getAttribute('data-row-id'))).toEqual(['c', 'd']);
      expect(buttons[1]).toHaveAccessibleName(`Remove from list: ${sessions[3]!.project}, Lu`);
      expect(buttons[1]).toHaveAttribute('title', 'Remove from list');
      // A real button, reachable with the keyboard, outside the row's open button.
      expect(buttons[1]!.tagName).toBe('BUTTON'); expect(buttons[1]).not.toHaveAttribute('tabindex', '-1');
      expect(buttons[1]!.closest('button[data-row]')).toBeNull();
      fireEvent.click(buttons[1]!);
      expect(onDismiss).toHaveBeenCalledWith('d'); expect(onOpen).not.toHaveBeenCalled();
    });
    it('is disabled offline, and absent without a handler', () => {
      const { rerender } = render(<SessionList {...props} sessions={sessions} onOpen={() => {}} onDismiss={() => {}} offline />);
      for (const b of screen.getAllByRole('button', { name: /^Remove from list/ })) expect(b).toBeDisabled();
      rerender(<SessionList {...props} sessions={sessions} onOpen={() => {}} />);
      expect(screen.queryAllByRole('button', { name: /^Remove from list/ })).toHaveLength(0);
    });
  });
  it('places the ask field above the sessions, matching the notch', () => {
    const onAsk = vi.fn();
    const props = { visible: true, selectedId: null, dnd: false, onToggleDnd: () => {}, onOpen: () => {}, onClose: () => {}, onAsk };
    const { rerender } = render(<SessionList sessions={sessions} {...props} />);
    const order = () => {
      const layer = document.querySelector('[data-layer="list"]')!;
      return layer.querySelector('[data-ask-field]')!.compareDocumentPosition(layer.querySelector('[data-scroll]')!) & Node.DOCUMENT_POSITION_FOLLOWING;
    };
    expect(order()).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    rerender(<SessionList sessions={[]} {...props} />);
    expect(order()).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(document.querySelector('[data-empty]')).not.toBeNull();
    const input = screen.getByRole('textbox', { name: 'Ask Ledge' });
    fireEvent.change(input, { target: { value: 'hello' } }); fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAsk).toHaveBeenCalledWith('hello');
  });
});
