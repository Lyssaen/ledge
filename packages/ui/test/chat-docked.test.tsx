import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChatTurn } from '@ledge/protocol';
import { ChatView, type ChatViewProps } from '../src/chat/ChatView';
import { ChatCopyProvider } from '../src/chat/copy';
import { copy } from './chat-copy-fixture';
import { T0, fakeSession } from './fixtures';

const noop = () => {};
const turns: ChatTurn[] = [{ qid: 'q1', question: 'q', askedAt: T0, answeredAt: T0, steps: [], answer: 'Ask **Otto** now.' }];
const base: ChatViewProps = { turns, live: null, sessions: [fakeSession('local:otto')], visible: true, offline: null, onAsk: noop, onCancel: noop, onReset: noop, onBack: noop, onClose: noop, onOpenSession: noop, now: Date.parse(T0) };
const ui = (p: Partial<ChatViewProps>) => <ChatCopyProvider value={copy}><ChatView {...base} {...p} /></ChatCopyProvider>;

describe('the docked chat', () => {
  it('has no Back button, and Close calls onClose', () => {
    const onClose = vi.fn();
    render(ui({ docked: true, onClose }));
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('stays in the flow, without absolute positioning', () => {
    const { container } = render(ui({ docked: true }));
    const root = container.querySelector('[data-layer="chat"]') as HTMLElement;
    expect(root.style.position).not.toBe('absolute');
    expect(root.style.height).toBe('100%');
  });

  it('without docked, Back is there', () => {
    render(ui({}));
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('hovering a known name reports its id, leaving reports null', () => {
    const onAgentHover = vi.fn();
    render(ui({ docked: true, onAgentHover }));
    const link = screen.getByRole('link', { name: 'Otto' });
    fireEvent.mouseOver(link);
    expect(onAgentHover).toHaveBeenLastCalledWith('local:otto');
    fireEvent.mouseLeave(link.closest('[data-scroll]')!);
    expect(onAgentHover).toHaveBeenLastCalledWith(null);
  });

  it('keyboard focus on the link does the same', () => {
    const onAgentHover = vi.fn();
    render(ui({ docked: true, onAgentHover }));
    const link = screen.getByRole('link', { name: 'Otto' });
    fireEvent.focusIn(link);
    expect(onAgentHover).toHaveBeenLastCalledWith('local:otto');
    fireEvent.focusOut(link, { relatedTarget: document.body });
    expect(onAgentHover).toHaveBeenLastCalledWith(null);
  });

  it('inputRef reaches the field', () => {
    const ref = { current: null as HTMLInputElement | null };
    render(ui({ docked: true, inputRef: ref }));
    expect(ref.current).toBe(screen.getByLabelText('Ask'));
  });

  describe('when an answer finishes', () => {
    const asking: ChatTurn[] = [{ qid: 'q2', question: 'more?', askedAt: T0, steps: [] }];
    const outside = () => { const b = document.createElement('button'); b.textContent = 'elsewhere'; document.body.append(b); return b; };

    it('docked: a focus taken elsewhere (a dialog) stays there', () => {
      const { rerender } = render(ui({ docked: true, turns: asking }));
      const other = outside();
      other.focus();
      rerender(ui({ docked: true, turns: [{ ...asking[0]!, answeredAt: T0, answer: 'done' }] }));
      expect(other).toHaveFocus();
      other.remove();
    });

    it('docked: with the focus nowhere (the page) or in the chat, the field takes it back', () => {
      const { rerender, container } = render(ui({ docked: true, turns: asking }));
      (document.activeElement as HTMLElement | null)?.blur();
      rerender(ui({ docked: true, turns: [{ ...asking[0]!, answeredAt: T0, answer: 'done' }] }));
      expect(screen.getByLabelText('Ask')).toHaveFocus();
      rerender(ui({ docked: true, turns: [...turns, { ...asking[0]!, qid: 'q3' }] }));
      (container.querySelector('button[aria-label="Close"]') as HTMLElement).focus();
      rerender(ui({ docked: true, turns: [...turns, { ...asking[0]!, qid: 'q3', answeredAt: T0, answer: 'done' }] }));
      expect(screen.getByLabelText('Ask')).toHaveFocus();
    });

    it('the island (not docked) takes the focus back as before', () => {
      const { rerender } = render(ui({ turns: asking }));
      const other = outside();
      other.focus();
      rerender(ui({ turns: [{ ...asking[0]!, answeredAt: T0, answer: 'done' }] }));
      expect(screen.getByLabelText('Ask')).toHaveFocus();
      other.remove();
    });
  });
});
