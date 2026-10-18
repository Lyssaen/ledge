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

describe('the project card (lot 11 task 5)', () => {
  const projectProposal = { name: 'Paper', repos: [{ path: '/w/paper-fonts', why: 'Named paper-*' }, { path: '/w/paper-templates', why: 'Same prefix' }] };
  const turns: ChatTurn[] = [{ qid: 'q1', question: 'Create a project', askedAt: T0, answeredAt: T0, steps: [], answer: 'I propose **Paper**.', projectProposal }];
  const card = () => document.querySelector('[data-project-card]');
  it('without onProject (the island) there is no card: the answer stands alone', () => {
    render(<ChatCopyProvider value={copy}><ChatView {...base} turns={turns} now={Date.parse(T0)} /></ChatCopyProvider>);
    expect(screen.getByText(/I propose/)).toBeInTheDocument();
    expect(card()).toBeNull();
  });
  it('with onProject: the name, the count and « Review the proposal », which hands over the turn', () => {
    const onProject = vi.fn();
    render(<ChatCopyProvider value={copy}><ChatView {...base} turns={turns} now={Date.parse(T0)} onProject={onProject} /></ChatCopyProvider>);
    const section = screen.getByRole('region', { name: 'Project proposal' });
    expect(section).toHaveTextContent('Project proposal · Paper');
    expect(section).toHaveTextContent('2 repos');
    fireEvent.click(screen.getByRole('button', { name: 'Review the proposal' }));
    expect(onProject).toHaveBeenCalledWith('q1');
  });
  it('« Complete X » when addTo names a project that exists (its current name), else the proposal\'s own name', () => {
    const add: ChatTurn[] = [{ ...turns[0]!, projectProposal: { ...projectProposal, addTo: 'ledge' } }];
    const { unmount } = render(<ChatCopyProvider value={copy}><ChatView {...base} turns={add} now={Date.parse(T0)} onProject={noop} projectNamed={n => (n === 'ledge' ? 'Ledge' : undefined)} /></ChatCopyProvider>);
    expect(card()).toHaveTextContent('Complete Ledge');
    unmount();
    render(<ChatCopyProvider value={copy}><ChatView {...base} turns={add} now={Date.parse(T0)} onProject={noop} projectNamed={() => undefined} /></ChatCopyProvider>);
    expect(card()).toHaveTextContent('Project proposal · Paper');
  });
});
