import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, createEvent } from '@testing-library/react';
import { ChatView, type ChatViewProps } from '../src/chat/ChatView';
import { ChatCopyProvider } from '../src/chat/copy';
import { copy } from './chat-copy-fixture';
import { fakeSession } from './fixtures';

const noop = () => {};
const base: ChatViewProps = { turns: [], live: null, sessions: [fakeSession('local:otto')], visible: true, offline: null, onAsk: noop, onCancel: noop, onReset: noop, onBack: noop, onClose: noop, onOpenSession: noop };
const ui = (p: Partial<ChatViewProps>) => <ChatCopyProvider value={copy}><ChatView {...base} {...p} /></ChatCopyProvider>;
const chip = (state: 'ready' | 'refused' | 'uploading') => ({ key: 'k1', url: 'data:image/webp;base64,AA==', width: 10, height: 10, bytes: 1000, state, ...(state === 'refused' ? { reason: 'too big' } : {}) });
const attach = (state: 'ready' | 'refused' | 'uploading', over = {}) => ({ items: [chip(state)], onFiles: vi.fn(), onRemove: vi.fn(), ready: state === 'ready', ...over });
const send = () => screen.getByRole('button', { name: 'Send' });

describe('the chat composer with images', () => {
  it('with empty text and one ready chip, Send is enabled and asks with an empty text', () => {
    const onAsk = vi.fn();
    render(ui({ onAsk, attach: attach('ready') }));
    expect(send()).toBeEnabled();
    fireEvent.click(send());
    expect(onAsk).toHaveBeenCalledWith('');
  });
  it('with a refused or uploading chip, Send is disabled', () => {
    const { unmount } = render(ui({ attach: attach('refused') }));
    expect(send()).toBeDisabled();
    unmount();
    render(ui({ attach: attach('uploading') }));
    expect(send()).toBeDisabled();
  });
  it('without chips and without text, Send stays disabled', () => {
    render(ui({ attach: { items: [], onFiles: noop, onRemove: noop, ready: true } }));
    expect(send()).toBeDisabled();
  });
  it('pasted image files go to onFiles and are not pasted as text; a text paste is left alone', () => {
    const onFiles = vi.fn();
    render(ui({ attach: { items: [], onFiles, onRemove: noop, ready: true } }));
    const input = screen.getByRole('textbox', { name: 'Ask' });
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const withFile = createEvent.paste(input, { clipboardData: { files: [file], types: ['Files'], getData: () => '' } });
    fireEvent(input, withFile);
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(withFile.defaultPrevented).toBe(true);
    const text = createEvent.paste(input, { clipboardData: { files: [], types: ['text/plain'], getData: () => 'hi' } });
    fireEvent(input, text);
    expect(text.defaultPrevented).toBe(false);
    expect(onFiles).toHaveBeenCalledTimes(1);
  });
  it('files dropped on the form go to onFiles', () => {
    const onFiles = vi.fn();
    const { container } = render(ui({ attach: { items: [], onFiles, onRemove: noop, ready: true } }));
    const form = container.querySelector('[data-chat-composer]')!;
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const drop = createEvent.drop(form); Object.defineProperty(drop, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
    fireEvent(form, drop);
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(drop.defaultPrevented).toBe(true);
  });
});
