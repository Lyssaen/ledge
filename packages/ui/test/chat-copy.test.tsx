import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChatTurn } from '@ledge/protocol';
import { ChatView, type ChatViewProps } from '../src/chat/ChatView';
import { ChatCopyProvider, useChatCopy } from '../src/chat/copy';
import { copy, frTime } from './chat-copy-fixture';
import { relativeTime } from '../src/chat/format';
import { MarkdownLinks } from '../src/documents/links';
import { T0, fakeSession } from './fixtures';

const noop = () => {};
const base: ChatViewProps = { turns: [], live: null, sessions: [fakeSession('a')], visible: true, offline: null, onAsk: noop, onCancel: noop, onReset: noop, onBack: noop, onClose: noop, onOpenSession: noop };

describe('the shared chat reads its copy from the app', () => {
  it('ChatView inside a ChatCopyProvider shows the provided empty title', () => {
    render(<ChatCopyProvider value={copy}><ChatView {...base} /></ChatCopyProvider>);
    expect(screen.getByText('Test empty title')).toBeInTheDocument();
  });

  it('useChatCopy without a provider throws a clear error', () => {
    const Probe = () => { useChatCopy(); return null; };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { expect(() => render(<Probe />)).toThrow('ChatCopyProvider missing'); }
    finally { quiet.mockRestore(); }
  });

  it('relativeTime words two minutes with French time copy', () => {
    expect(relativeTime(T0, Date.parse(T0) + 120_000, frTime)).toBe('2 min');
  });

  it('a web link in an answer opens through the MarkdownLinks context', () => {
    const openUrl = vi.fn();
    const turns: ChatTurn[] = [{ qid: 'q1', question: 'q', askedAt: T0, answeredAt: T0, steps: [], answer: 'See [docs](https://example.com/x).' }];
    render(<MarkdownLinks.Provider value={openUrl}><ChatCopyProvider value={copy}><ChatView {...base} turns={turns} now={Date.parse(T0)} /></ChatCopyProvider></MarkdownLinks.Provider>);
    fireEvent.click(screen.getByRole('link', { name: 'docs' }));
    expect(openUrl).toHaveBeenCalledWith('https://example.com/x');
  });
});
