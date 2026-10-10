import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionView, measureSessionH } from '../src/surface/SessionView';
import { fakeSession } from './mockDaemon';

const perm = fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } });
const q = fakeSession('b', { name: 'Pim', tool: 'codex', state: 'waiting_input', pending: { kind: 'question', text: 'Which strategy?', options: ['Backfill', 'Shadow table'], source: 'hook' } });
const base = { preview: ['● Bash(npm test)', 'Do you want to proceed?'], visible: true, reading: false, draft: '', onDraft: () => {}, onBack: () => {}, onClose: () => {}, onDecide: () => {}, onReply: () => {}, onInterrupt: () => {}, onKill: () => {}, onFocus: () => {}, onToggleReading: () => {} };

describe('<SessionView>', () => {
  it('shows a permission card and sends the decision', () => {
    const onDecide = vi.fn();
    render(<SessionView {...base} session={perm} onDecide={onDecide} />);
    expect(screen.getByText('Otto wants to run')).toBeInTheDocument();
    expect(screen.getByText('npm test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deny' })); expect(onDecide).toHaveBeenCalledWith('deny');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' })); expect(onDecide).toHaveBeenLastCalledWith('accept');
    expect(screen.getByRole('button', { name: 'Always for this session' })).toBeDisabled();
    expect(screen.getByText('Do you want to proceed?')).toBeInTheDocument();
  });
  it('shows a question with options and answers by number; Other is off (free text is not supported yet)', () => {
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
  it('the ask card folds when pending disappears', () => {
    const { rerender, container } = render(<SessionView {...base} session={perm} />);
    expect(container.querySelector('[data-ask]')).toHaveStyle({ maxHeight: '260px', opacity: '1' });
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
  it('measures a sensible height', () => {
    expect(measureSessionH(perm, false)).toBe(56 + 168 + 240 + 100);
    expect(measureSessionH(q, false)).toBe(56 + 48 + 2 * 64 + 56 + 240 + 100);
  });
});
