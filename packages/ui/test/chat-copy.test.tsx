import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChatTurn } from '@ledge/protocol';
import { ChatView, type ChatViewProps } from '../src/chat/ChatView';
import { ChatCopyProvider, useChatCopy, type ChatCopy } from '../src/chat/copy';
import { relativeTime } from '../src/chat/format';
import { MarkdownLinks } from '../src/documents/links';
import { T0, fakeSession } from './fixtures';

const frTime: ChatCopy['time'] = { seconds: n => `${n} s`, minutes: n => `${n} min`, hours: n => `${n} h`, locale: 'fr-FR' };
const fn = (s: string) => () => s;
const copy: ChatCopy = {
  chat: {
    title: 'Ledge', subtitle: (n, r) => `${n} sessions · ${r} repos`, ask: 'Ask', askPlaceholder: 'Ask…', open: 'Open', send: 'Send', stop: 'Stop', reset: 'Reset', back: 'Back', close: 'Close',
    emptyTitle: 'Test empty title', emptyHint: n => `${n} visible`, starters: 'Starters', chips: ['First chip'], thinking: 'Thinking',
    step: { sessions: 'sessions', pane: fn('pane'), reply: fn('reply'), git: fn('git'), repo: fn('repo') },
    source: { sessions: 'sessions', pane: fn('pane'), reply: fn('reply'), git: fn('git'), repo: fn('repo') },
    sources: 'Sources', sourcesNone: 'none', ago: w => `${w} ago`, error: w => `error ${w}`, stopped: 'Stopped',
    card: { label: 'Card', folder: 'Folder', tool: 'Tool', byDefault: t => t, prompt: 'Prompt', noPrompt: 'None', launch: 'Launch', launching: 'Launching', retry: 'Retry', orRephrase: 'or', orFolder: 'or folder', failed: w => w, started: 'started', startedUnknown: 'Started', terminal: 'Terminal' },
    relay: { label: 'Relay', session: 'Session', instruction: 'Instruction', send: 'Send', sending: 'Sending', cancel: 'Cancel', retry: 'Retry', orRephrase: 'or', queued: 'queued', sentTo: 'Sent to', failed: w => w, pill: { yours: 'yours', working: 'working', waiting: 'waiting', stopped: 'stopped' } }
  },
  machines: { destination: 'Destination', local: 'This machine', offline: 'Offline', choose: n => `On ${n}.`, clarification: 'Or answer in the chat.' },
  time: frTime,
  offline: 'Offline: reconnecting'
};
const noop = () => {};
const base: ChatViewProps = { turns: [], live: null, sessions: [fakeSession('a')], visible: true, offline: null, onAsk: noop, onCancel: noop, onReset: noop, onBack: noop, onClose: noop, onOpenSession: noop };

describe('the shared chat reads its copy from the app', () => {
  it('ChatView inside a ChatCopyProvider shows the provided empty title', () => {
    render(<ChatCopyProvider value={copy}><ChatView {...base} /></ChatCopyProvider>);
    expect(screen.getByText('Test empty title')).toBeInTheDocument();
  });

  it('useChatCopy without a provider throws a clear error', () => {
    const Probe = () => { useChatCopy(); return null; };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('ChatCopyProvider missing');
    vi.mocked(console.error).mockRestore();
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
