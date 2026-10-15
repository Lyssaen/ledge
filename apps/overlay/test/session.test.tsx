import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionView, measureSessionH, askMaxH } from '../src/surface/SessionView';
import { fakeSession } from './mockDaemon';

const perm = fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } });
const q = fakeSession('b', { name: 'Pim', tool: 'codex', state: 'waiting_input', pending: { kind: 'question', text: 'Which strategy?', options: ['Backfill', 'Shadow table'], source: 'hook' } });
const base = { preview: ['● Bash(npm test)', 'Do you want to proceed?'], visible: true, reading: false, draft: '', onDraft: () => {}, onBack: () => {}, onClose: () => {}, onDecide: () => {}, onReply: () => {}, onInterrupt: () => {}, onKill: () => {}, onFocus: () => {}, onToggleReading: () => {} };

describe('<SessionView>', () => {
  it('renders the thread under the helpers, opens a helper on click and drops it once it ends', () => {
    const at = (s: number) => new Date(Date.UTC(2026, 9, 13, 10, 0, s)).toISOString();
    const thread = [
      { kind: 'prompt' as const, id: 'prompt-1', at: at(0), turn: 1, text: 'Review the reducer' },
      { kind: 'helper' as const, id: 'h1', at: at(1), turn: 1, task: 'find consumers', agentType: 'Explore', state: 'working' as const },
      { kind: 'helper' as const, id: 'h2', at: at(2), turn: 1, task: 'review task 1', agentType: 'general-purpose', state: 'working' as const },
      { kind: 'tool' as const, id: 'toolu_1', at: at(3), turn: 1, tool: 'Bash', label: 'Bash · pnpm test', status: 'running' as const, files: [] },
      { kind: 'message' as const, id: 'msg-1', at: at(4), turn: 1, text: 'Tests are running.' }
    ];
    const onOpenHelper = vi.fn();
    const { container, rerender } = render(<SessionView {...base} session={fakeSession('a', { state: 'working', helpers: [] })} thread={thread} onOpenHelper={onOpenHelper} />);
    expect(container.querySelector('[data-prompt]')).toHaveTextContent('Review the reducer');
    expect(container.querySelector('[data-live-tool]')).toHaveTextContent('Bash');
    expect(container.querySelector('[data-live-tool]')).toHaveTextContent('pnpm test');
    const row = screen.getByRole('button', { name: 'find consumers · Open the discussion' });
    expect(row).toHaveTextContent('Explore · Working');
    fireEvent.click(row);
    expect(onOpenHelper).toHaveBeenCalledWith('h1');
    // The thread comes before the reply card and the ask fold.
    const helpersEl = container.querySelector('[data-helpers]')!; const threadEl = container.querySelector('[data-thread]')!;
    expect(helpersEl.compareDocumentPosition(threadEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // h1 ends: its row leaves, h2 stays; the live tool line is still the turn's last line, under what the agent said.
    rerender(<SessionView {...base} session={fakeSession('a', { state: 'working', helpers: [] })} thread={thread.map(i => (i.id === 'h1' ? { ...i, state: 'exited' as const } : i))} onOpenHelper={onOpenHelper} />);
    expect([...container.querySelectorAll('[data-helper]')].map(e => e.getAttribute('data-helper-id'))).toEqual(['h2']);
    expect([...container.querySelectorAll('[data-thread] > [data-item]')].map(e => e.getAttribute('data-item'))).toEqual(['prompt', 'message', 'tools']);
  });
  it('the current answer stays readable while a request waits: in the thread, in its place, above the decision; once only otherwise', () => {
    const at = (n: number) => new Date(Date.UTC(2026, 9, 13, 10, 0, n)).toISOString();
    const thread = [
      { kind: 'prompt' as const, id: 'prompt-1', at: at(0), turn: 1, text: 'Plan the banner' },
      { kind: 'tool' as const, id: 'toolu_1', at: at(1), turn: 1, tool: 'Read', label: 'Read · a', status: 'running' as const, files: [] },
      { kind: 'reply' as const, id: 'reply-1', at: at(2), turn: 1, text: 'Here is the plan: two steps.' }
    ];
    const lastReply = { text: 'Here is the plan: two steps.', at: at(2) };
    const waiting = fakeSession('a', { state: 'waiting_permission', lastReply, pending: { kind: 'plan', text: 'Implement this plan?', source: 'pane' } });
    const { container, rerender } = render(<SessionView {...base} session={waiting} thread={thread} />);
    const kinds = [...container.querySelectorAll('[data-thread] > [data-item]')].map(e => e.getAttribute('data-item'));
    expect(kinds).toEqual(['prompt', 'reply', 'tools']);
    const answer = container.querySelector('[data-reply-item]')!;
    expect(answer).toHaveTextContent('Here is the plan: two steps.');
    expect(answer.compareDocumentPosition(container.querySelector('[data-ask]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No request: the reply card shows it, the thread does not repeat it.
    rerender(<SessionView {...base} session={fakeSession('a', { state: 'idle', lastReply })} thread={thread} />);
    expect(container.querySelector('[data-reply-item]')).toBeNull();
    expect(container.querySelectorAll('[data-reply-meta]')).toHaveLength(1);
  });
  it('a plan that is the current answer shows once, in its card, without the terminal hint (Codex Plan mode)', () => {
    const at = (n: number) => new Date(Date.UTC(2026, 9, 14, 8, 5, n)).toISOString();
    const body = '# Add a README\n\n## Changes\n\n- Add **Usage**';
    const thread = [
      { kind: 'prompt' as const, id: 'prompt-3', at: at(0), turn: 3, text: 'Revise the plan' },
      { kind: 'reply' as const, id: 'reply-3', at: at(3), turn: 3, text: body }
    ];
    const waiting = fakeSession('a', { tool: 'codex', state: 'waiting_permission', lastReply: { text: body, at: at(3) }, pending: { kind: 'plan', text: 'Implement this plan?', body, source: 'pane' } });
    const { container } = render(<SessionView {...base} session={waiting} thread={thread} />);
    expect(container.querySelector('[data-reply-item]')).toBeNull();
    expect(container.querySelector('[data-plan] h1')).toHaveTextContent('Add a README');
    expect(container.querySelector('[data-ask]')).not.toHaveTextContent('terminal preview');
  });
  it('shows no counters under the title once a reply arrived', () => {
    const reply = { text: '## Done\n- [x] a\n- [x] b\n\n## Questions\n1. Which one?\n   - A\n   - B', at: '2026-10-09T18:05:00.000Z' };
    const { container } = render(<SessionView {...base} session={fakeSession('a', { state: 'idle', lastReply: reply })} thread={[]} />);
    expect(container.textContent).not.toMatch(/\d+ (done|question)/);
    expect(container.querySelector('[data-thread][data-empty]')).toBeInTheDocument();
  });
  it('lists the live helpers under the title and keeps an idle parent "in progress" while one works', () => {
    const helpers = [
      { id: 'h0', kind: 'Explore', task: 'find reducer consumers', state: 'exited' as const },
      { id: 'h1', kind: 'general-purpose', task: 'review task 1', state: 'working' as const },
      { id: 'h2', kind: 'Explore', task: '', state: 'waiting_permission' as const }
    ];
    const { container, rerender } = render(<SessionView {...base} session={fakeSession('a', { state: 'idle', helpers })} />);
    expect(container.querySelector('[data-eyebrow]')).toHaveTextContent('In progress');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Focused on its task.');
    const tree = screen.getByRole('list', { name: 'Subagents' });
    const rows = tree.querySelectorAll('[data-helper]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.tagName).toBe('BUTTON');
    expect(rows[0]).toHaveTextContent('review task 1');
    expect(rows[0]).toHaveTextContent('Working');
    expect(rows[0]).toHaveTextContent('general-purpose · Working');
    // No description: its place stays empty (the type is not shown in its stead).
    expect(rows[1]!.querySelector('[data-helper-task]')).toBeEmptyDOMElement();
    expect(rows[1]).toHaveTextContent('Explore · Needs your approval');
    expect(rows[1]).toHaveAttribute('data-last', 'true');
    expect(tree.querySelectorAll('svg')).toHaveLength(2);
    rerender(<SessionView {...base} session={fakeSession('a', { state: 'idle', helpers: helpers.map(h => ({ ...h, state: 'exited' as const })) })} />);
    expect(screen.queryByRole('list', { name: 'Subagents' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Waiting for your instructions.');
  });
  it('shows a permission card and sends the decision', () => {
    const onDecide = vi.fn();
    render(<SessionView {...base} session={perm} onDecide={onDecide} />);
    expect(screen.getByRole('heading', { name: 'Otto wants to run a command.' })).toBeInTheDocument();
    expect(screen.getByText('Run in harness-assistant')).toBeInTheDocument();
    expect(screen.getByText('npm test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deny' })); expect(onDecide).toHaveBeenCalledWith('deny');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' })); expect(onDecide).toHaveBeenLastCalledWith('accept');
    expect(screen.getByRole('checkbox', { name: 'Always for this session' })).toBeDisabled();
    // The terminal strip says what waits; its lines show on hover or in reading mode.
    expect(document.querySelector('[data-terminal-band]')).toHaveAttribute('data-tone', 'approval');
  });
  it('a plan request shows the whole plan, rendered and scrollable, above its decision', () => {
    const body = '# Add Red Banner\n\n1. Create banner.html with a red banner.\n2. Check it renders red.\n\n## Verification\n\n- banner.html exists';
    const plan = fakeSession('p', { state: 'waiting_permission', pending: { kind: 'plan', text: '# Add Red Banner', body, source: 'hook' } });
    const onDecide = vi.fn();
    const { container } = render(<SessionView {...base} session={plan} onDecide={onDecide} />);
    const shown = container.querySelector('[data-plan]') as HTMLElement;
    expect(shown).toBeInTheDocument();
    expect(shown.querySelector('h1')).toHaveTextContent('Add Red Banner');
    expect(shown.querySelectorAll('li')).toHaveLength(3);
    expect(shown).toHaveTextContent('Check it renders red.');
    expect(shown).toHaveStyle({ overflowY: 'auto' });
    // The fold that holds the card leaves room for the plan box.
    const fold = container.querySelector('[data-ask]') as HTMLElement;
    expect(parseInt(fold.style.maxHeight, 10)).toBeGreaterThan(parseInt(shown.style.maxHeight, 10));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith('accept');
  });
  it('shows a question with options and answers by number; Other is off for a tool that cannot take free text (Codex)', () => {
    const onReply = vi.fn();
    render(<SessionView {...base} session={q} onReply={onReply} />);
    expect(screen.getByLabelText('Backfill')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Shadow table'));
    fireEvent.click(screen.getByRole('button', { name: 'Answer' })); expect(onReply).toHaveBeenLastCalledWith('2');
    expect(screen.getByLabelText('Other')).toBeDisabled();
    expect(screen.getByPlaceholderText('Other…')).toBeDisabled();
    expect(screen.getByLabelText('Other')).toHaveAccessibleDescription('answer in the terminal');
    fireEvent.click(screen.getByLabelText('Other'));
    fireEvent.click(screen.getByRole('button', { name: 'Answer' })); expect(onReply).toHaveBeenLastCalledWith('2');
  });
  it('Claude Code: Other takes free text, picked by typing in its field, sent with the button or Enter', () => {
    const onReply = vi.fn();
    render(<SessionView {...base} session={{ ...q, tool: 'claude' }} onReply={onReply} />);
    const field = screen.getByPlaceholderText('Other…');
    expect(field).toBeEnabled();
    expect(screen.queryByText('answer in the terminal')).toBeNull();
    fireEvent.click(screen.getByLabelText('Other'));
    expect(screen.getByLabelText('Other')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Answer' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Backfill'));
    fireEvent.change(field, { target: { value: '  Vert pomme ' } });
    expect(screen.getByLabelText('Other')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Answer' })); expect(onReply).toHaveBeenLastCalledWith('Vert pomme');
    fireEvent.keyDown(field, { key: 'Enter' }); expect(onReply).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByLabelText('Shadow table'));
    fireEvent.click(screen.getByRole('button', { name: 'Answer' })); expect(onReply).toHaveBeenLastCalledWith('2');
  });
  it('shows each option\'s description under its label, as its accessible description', () => {
    const withDetails = { ...q, pending: { ...q.pending!, optionDetails: ['Copies the history first.', ''] } };
    render(<SessionView {...base} session={withDetails} />);
    expect(screen.getByLabelText('Backfill')).toHaveAccessibleDescription('Copies the history first.');
    expect(screen.getByLabelText('Shadow table')).not.toHaveAccessibleDescription();
    expect(askMaxH(withDetails.pending)).toBeGreaterThan(askMaxH(q.pending!));
  });
  it('the ask card folds when pending disappears', () => {
    const { rerender, container } = render(<SessionView {...base} session={perm} />);
    expect(container.querySelector('[data-ask]')).toHaveStyle({ maxHeight: `${askMaxH(perm.pending!)}px`, opacity: '1' });
    rerender(<SessionView {...base} session={{ ...perm, state: 'working', pending: undefined }} />);
    expect(container.querySelector('[data-ask]')).toHaveStyle({ maxHeight: '0px', opacity: '0' });
    expect(screen.getByText('npm test')).toBeInTheDocument();
  });
  it('the ask card uses a different transition to open than to exit', () => {
    const { rerender, container } = render(<SessionView {...base} session={perm} />);
    const open = (container.querySelector('[data-ask]') as HTMLElement).style.transition;
    rerender(<SessionView {...base} session={{ ...perm, state: 'working', pending: undefined }} />);
    const exit = (container.querySelector('[data-ask]') as HTMLElement).style.transition;
    expect(open).toContain('cubic-bezier(.22,1,.36,1)');
    expect(exit).toContain('cubic-bezier(.65,0,.35,1)');
    expect(exit).not.toBe(open);
  });
  it('reply field is controlled by the parent draft and sends on Enter', () => {
    const onReply = vi.fn(), onDraft = vi.fn();
    render(<SessionView {...base} session={{ ...perm, state: 'working', pending: undefined }} draft="keep going" onDraft={onDraft} onReply={onReply} />);
    const input = screen.getByPlaceholderText('Reply to Otto…') as HTMLInputElement;
    expect(input.value).toBe('keep going');
    fireEvent.keyDown(input, { key: 'Enter' }); expect(onReply).toHaveBeenCalledWith('keep going');
    fireEvent.change(input, { target: { value: 'x' } }); expect(onDraft).toHaveBeenCalledWith('x');
  });
  it('error state explains and keeps the buttons enabled; working state offers Interrupt', () => {
    const { unmount } = render(<SessionView {...base} session={{ ...perm, state: 'error', lastError: 'the terminal did not take it' }} />);
    expect(screen.getByText(/did not take it/)).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    unmount();
    render(<SessionView {...base} session={{ ...perm, state: 'working', pending: undefined }} />);
    expect(screen.getByRole('button', { name: 'Interrupt' })).toBeInTheDocument();
  });
  it('header controls: reading toggle is pressed, a hidden view is inert', () => {
    const { container } = render(<SessionView {...base} session={perm} reading visible={false} />);
    expect(screen.getByRole('button', { name: 'Reading mode', hidden: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Focus terminal tab', hidden: true })).toBeInTheDocument();
    expect(container.querySelector('[data-layer="session"]')).toHaveAttribute('inert');
  });
  it('header actions keep their 32 px hit area beside a long topic', () => {
    render(<SessionView {...base} session={fakeSession('a', { topic: 'Hooks Codex approvals and the rest of a long title' })} />);
    for (const name of ['Reading mode', 'Focus terminal tab', 'Close']) {
      expect(screen.getByRole('button', { name })).toHaveStyle({ width: '32px', flexShrink: 0 });
    }
  });
  it('measures a sensible height', () => {
    // A fallback before the content is measured: an ask adds its card, reading mode a longer preview.
    const idle = { ...perm, state: 'working' as const, pending: undefined };
    expect(measureSessionH(perm, false)).toBeGreaterThan(measureSessionH(idle, false));
    expect(measureSessionH(q, false)).toBeGreaterThan(measureSessionH(idle, false));
    expect(measureSessionH(perm, true)).toBeGreaterThan(measureSessionH(perm, false));
  });
  describe('terminal preview', () => {
    /** Gives the preview's <pre> a geometry (jsdom has no layout) and records where it is scrolled to. */
    function geometry(pre: HTMLElement, scrollHeight: number, clientHeight = 200) {
      let top = 0;
      Object.defineProperty(pre, 'scrollHeight', { configurable: true, get: () => scrollHeight });
      Object.defineProperty(pre, 'clientHeight', { configurable: true, get: () => clientHeight });
      Object.defineProperty(pre, 'scrollTop', { configurable: true, get: () => top, set: v => { top = v; } });
      return { get top() { return top; }, set height(h: number) { scrollHeight = h; } };
    }
    const idle = fakeSession('c', { state: 'idle' });
    it('renders the lines as received, one per row, in a monospace wrapping block', () => {
      const lines = ['❯ list the files', '', '● Bash(ls src)', '  ⎿  client.ts'];
      const { container } = render(<SessionView {...base} session={idle} preview={lines} reading />);
      const pre = container.querySelector('pre[data-terminal]') as HTMLElement;
      expect([...pre.children].map(c => c.textContent)).toEqual(['❯ list the files', ' ', '● Bash(ls src)', '  ⎿  client.ts']);
      expect(pre).toHaveClass('mono'); expect(pre).toHaveClass('ledge-scroll');
      expect(pre).toHaveStyle({ whiteSpace: 'pre-wrap' });
    });
    it('follows the latest line on update, but not while the user has scrolled up to read', () => {
      const { container, rerender } = render(<SessionView {...base} session={idle} preview={['a']} reading />);
      const pre = container.querySelector('pre[data-terminal]') as HTMLElement;
      const g = geometry(pre, 600);
      rerender(<SessionView {...base} session={idle} preview={['a', 'b']} reading />);
      expect(g.top).toBe(600);
      pre.scrollTop = 100; fireEvent.scroll(pre);
      g.height = 700;
      rerender(<SessionView {...base} session={idle} preview={['a', 'b', 'c']} reading />);
      expect(g.top).toBe(100);
      pre.scrollTop = 500; fireEvent.scroll(pre);
      g.height = 800;
      rerender(<SessionView {...base} session={idle} preview={['a', 'b', 'c', 'd']} reading />);
      expect(g.top).toBe(800);
    });
    it('the conversation follows its end on each new item, but not while the user has scrolled up to read', () => {
      const at = (n: number) => new Date(Date.UTC(2026, 9, 13, 10, 0, n)).toISOString();
      const msg = (n: number) => ({ kind: 'message' as const, id: `m${n}`, at: at(n), turn: 1, text: `line ${n}` });
      const working = fakeSession('w', { state: 'working' });
      const { container, rerender } = render(<SessionView {...base} session={working} thread={[msg(1)]} />);
      const scroll = container.querySelector('[data-layer="session"] [data-scroll]') as HTMLElement;
      const g = geometry(scroll, 600);
      rerender(<SessionView {...base} session={working} thread={[msg(1), msg(2)]} />);
      expect(g.top).toBe(600);
      scroll.scrollTop = 100; fireEvent.scroll(scroll);
      g.height = 700;
      rerender(<SessionView {...base} session={working} thread={[msg(1), msg(2), msg(3)]} />);
      expect(g.top).toBe(100); // reading the history: left where it is
      scroll.scrollTop = 500; fireEvent.scroll(scroll); // back at the end
      g.height = 800;
      rerender(<SessionView {...base} session={working} thread={[msg(1), msg(2), msg(3), msg(4)]} />);
      expect(g.top).toBe(800);
    });
    it('compact view: a strip with the latest line, the last 8 lines on hover, reading mode on click', () => {
      const onToggleReading = vi.fn();
      const lines = ['❯ run the tests', '', ...Array.from({ length: 9 }, (_, i) => `  ✓ suite ${i + 1}`), '', '❯'];
      const { container } = render(<SessionView {...base} session={fakeSession('w', { state: 'working' })} preview={lines} onToggleReading={onToggleReading} />);
      const band = container.querySelector('[data-terminal-band]') as HTMLElement;
      expect(band).toHaveAttribute('data-tone', 'working');
      expect(band.querySelector('[data-band-text]')).toHaveTextContent(/^✓ suite 9$/); // the bare prompt and blanks are skipped
      expect(container.querySelector('[data-terminal-peek]')).toBeNull();
      fireEvent.mouseEnter(band);
      const peek = container.querySelector('[data-terminal-peek]') as HTMLElement;
      expect(peek).toHaveTextContent('suite 4'); expect(peek).not.toHaveTextContent('suite 3');
      fireEvent.mouseLeave(band);
      expect(container.querySelector('[data-terminal-peek]')).toBeNull();
      fireEvent.click(band);
      expect(onToggleReading).toHaveBeenCalledTimes(1);
    });
    it('the strip takes the state: an approval names the command, an error reads red', () => {
      const { container, rerender } = render(<SessionView {...base} session={perm} />);
      const band = () => container.querySelector('[data-terminal-band]') as HTMLElement;
      expect(band()).toHaveAttribute('data-tone', 'approval');
      expect(band().querySelector('[data-band-text]')).toHaveTextContent(`Waiting for your approval · ${perm.pending!.text.split('\n')[0]}`);
      rerender(<SessionView {...base} session={fakeSession('e', { state: 'error' })} />);
      expect(band()).toHaveAttribute('data-tone', 'error');
    });
    it('reading mode: the terminal alongside, folded into a rail and reopened on its last line', () => {
      const { container } = render(<SessionView {...base} session={perm} reading />);
      expect(container.querySelector('[data-terminal-band]')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Fold the terminal' }));
      expect(container.querySelector('pre[data-terminal]')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Reopen the terminal' }));
      const pre = container.querySelector('pre[data-terminal]') as HTMLElement;
      expect(pre).toHaveTextContent('Do you want to proceed?');
      expect(container.querySelector('[data-terminal-rail]')).toBeNull();
    });
  });
  describe('remove from list', () => {
    it('a finished or read-only session offers it in the header; a running one does not', () => {
      const onDismiss = vi.fn();
      const { rerender } = render(<SessionView {...base} session={fakeSession('d', { state: 'exited', exitCode: 0 })} onDismiss={onDismiss} />);
      fireEvent.click(screen.getByRole('button', { name: 'Remove from list' }));
      expect(onDismiss).toHaveBeenCalledTimes(1);
      rerender(<SessionView {...base} session={fakeSession('h', { source: 'hook_only', tmuxSession: null })} onDismiss={onDismiss} dismissOff />);
      expect(screen.getByRole('button', { name: 'Remove from list' })).toBeDisabled();
      rerender(<SessionView {...base} session={fakeSession('r')} onDismiss={onDismiss} />);
      expect(screen.queryByRole('button', { name: 'Remove from list' })).toBeNull();
    });
  });
  it('shows the topic and branch in the header and renames in place', () => {
    const onRename = vi.fn();
    const s = fakeSession('a', { topic: 'Hooks Codex', branch: 'worktree-codex', worktree: true });
    render(<SessionView {...base} session={s} onRename={onRename} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hooks Codex' }));
    const input = screen.getByRole('textbox', { name: 'Rename the session' });
    fireEvent.change(input, { target: { value: 'Codex approvals' } }); fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('Codex approvals');
    expect(screen.getByText('codex').closest('[data-branch]')).toHaveAttribute('title', 'worktree worktree-codex');
  });
  it('Escape in the rename field cancels without closing the view', () => {
    const onClose = vi.fn(); const onRename = vi.fn();
    render(<SessionView {...base} onClose={onClose} session={fakeSession('a', { topic: 'T' })} onRename={onRename} />);
    fireEvent.click(screen.getByRole('button', { name: 'T' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Rename the session' }), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'T' })).toBeInTheDocument(); expect(onRename).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  });
  it('the topic button keeps the focus ring: explicit resets, no all: unset', () => {
    render(<SessionView {...base} session={fakeSession('a', { topic: 'T' })} onRename={() => {}} />);
    const style = screen.getByRole('button', { name: 'T' }).getAttribute('style') ?? '';
    expect(style).not.toMatch(/(^|;\s*)all:/); expect(style).toMatch(/border: 0/);
  });
});
