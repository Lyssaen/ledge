import { describe, it, expect, vi } from 'vitest';
import { act, render, renderHook, screen, fireEvent, within } from '@testing-library/react';
import type { ChatAction, ChatTurn, ClientMessage, ServerMessage } from '@ledge/protocol';
import { ChatView, type ChatViewProps } from '../src/chat/ChatView';
import { ChatCopyProvider } from '../src/chat/copy';
import { useActionCards, type ActionCardsOptions } from '../src/chat/useActionCards';
import { actionCopy, copy } from './chat-copy-fixture';
import { T0, fakeSession } from './fixtures';

const noop = () => {};
const archive: ChatAction = { action: 'session.archive', args: { session: 'otto' }, summary: 'Archiver **Otto**', vars: { session: 'Otto' }, risk: 'reversible', session: 'local:otto' };
const dissolve: ChatAction = { action: 'team.dissolve', args: { team: 't1' }, summary: 'Dissoudre l’équipe **qa**', vars: { team: 'qa' }, risk: 'destructive', team: 't1' };
const turn = (o: Partial<ChatTurn> = {}): ChatTurn => ({ qid: 'q1', question: 'q', askedAt: T0, answeredAt: T0, steps: [], answer: 'Voici.', actions: [archive, dissolve], ...o });
const base: ChatViewProps = { turns: [turn()], live: null, sessions: [fakeSession('local:otto')], visible: true, offline: null, onAsk: noop, onCancel: noop, onReset: noop, onBack: noop, onClose: noop, onOpenSession: noop, now: Date.parse(T0), docked: true };
const withCard = { ...copy, chat: { ...copy.chat, action: actionCopy } };
const ui = (p: Partial<ChatViewProps>) => <ChatCopyProvider value={withCard}><ChatView {...base} {...p} /></ChatCopyProvider>;

describe('the chat draws a turn\'s generic card (#94)', () => {
  it('its rows in the front\'s words; Apply all, confirmed, goes to onAct', () => {
    const onAct = vi.fn();
    render(ui({ onAct }));
    const card = screen.getByRole('region', { name: 'Plan of 2 actions' });
    expect(card).toHaveTextContent('Archive Otto');
    expect(card).toHaveTextContent('Dissolve the team qa');
    fireEvent.click(screen.getByRole('button', { name: 'Apply all (2)…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply the 2' }));
    expect(onAct).toHaveBeenCalledWith('q1', [0, 1], true);
  });

  it('not drawn without onAct, or before the turn is answered', () => {
    render(ui({}));
    expect(screen.queryByRole('region', { name: 'Plan of 2 actions' })).toBeNull();
  });

  it('Ignore and Review go to onIgnoreCards; ignored, the card is one line', () => {
    const onIgnoreCards = vi.fn();
    const { rerender } = render(ui({ onAct: noop, onIgnoreCards }));
    fireEvent.click(screen.getByRole('button', { name: 'Ignore' }));
    expect(onIgnoreCards).toHaveBeenLastCalledWith('q1', false);
    rerender(ui({ onAct: noop, onIgnoreCards, turns: [turn({ ignoredAt: T0 })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(onIgnoreCards).toHaveBeenLastCalledWith('q1', true);
  });

  it('the rows in flight run; the card waits', () => {
    render(ui({ onAct: noop, actingQid: 'q1', actingRows: [0, 1] }));
    expect([...document.querySelectorAll('[data-action-row]')].map(r => r.getAttribute('data-action-row'))).toEqual(['running', 'running']);
    expect(screen.queryByRole('button', { name: 'Ignore' })).toBeNull();
  });

  it('Deny goes to onDenyAction, with its row', () => {
    const onDenyAction = vi.fn();
    const decide: ChatAction = { action: 'session.decide', args: { session: 'otto', decision: 'accept' }, summary: 'Accepter', vars: { session: 'Otto', decision: 'accept', kind: 'permission' }, risk: 'destructive', session: 'local:otto', detail: 'npm test' };
    render(ui({ onAct: noop, onDenyAction, turns: [turn({ actions: [decide] })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDenyAction).toHaveBeenCalledWith('q1', 0);
  });

  it('Open: the row\'s session, by its qualified id', () => {
    const onOpenSession = vi.fn();
    render(ui({ onAct: noop, onOpenSession, turns: [turn({ actions: [{ ...archive, state: 'refused', code: 'cut' }] })] }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Proposed action' })).getByRole('button', { name: 'Open Otto' }));
    expect(onOpenSession).toHaveBeenCalledWith('local:otto');
  });
});

describe('useActionCards: chat.act and chat.ignore (#94)', () => {
  const setup = (o: Partial<ActionCardsOptions> = {}) => {
    const send = vi.fn<(m: ClientMessage) => void>();
    const props: ActionCardsOptions = { send, chat: [turn()], errors: [], turnReady: () => true, ...o };
    const h = renderHook((p: ActionCardsOptions) => useActionCards(p), { initialProps: props });
    return { send, props, ...h };
  };

  it('sends the rows, confirmed when the card asked again, one at a time', () => {
    const { send, result } = setup();
    act(() => result.current.act('q1', [0, 1], true));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat.act', qid: 'q1', rows: [0, 1], confirmed: true }));
    expect((send.mock.calls[0]![0] as { rid: string }).rid).toBeTruthy();
    expect(result.current.actingQid).toBe('q1');
    expect(result.current.actingRows).toEqual([0, 1]);
    act(() => result.current.act('q1', [0], false));
    expect(send).toHaveBeenCalledOnce();
  });

  it('unconfirmed: no confirmed field', () => {
    const { send, result } = setup();
    act(() => result.current.act('q1', [0], false));
    expect(send.mock.calls[0]![0]).not.toHaveProperty('confirmed');
  });

  it('freed when the turn\'s rows change, by a chat.act refusal, or when its machine goes', () => {
    const a = setup();
    act(() => a.result.current.act('q1', [0], false));
    a.rerender({ ...a.props, chat: [turn({ actions: [{ ...archive, state: 'done' }, dissolve] })] });
    expect(a.result.current.actingQid).toBeNull();
    const b = setup();
    act(() => b.result.current.act('q1', [0], false));
    b.rerender({ ...b.props, errors: [{ seq: 1, message: 'no', request: 'chat.act' }] });
    expect(b.result.current.actingQid).toBeNull();
    const c = setup();
    act(() => c.result.current.act('q1', [0], false));
    c.rerender({ ...c.props, turnReady: () => false });
    expect(c.result.current.actingQid).toBeNull();
  });

  it('Deny: chat.act with deny, its row alone, never confirmed; held as an apply', () => {
    const { send, result } = setup();
    act(() => result.current.deny('q1', 0));
    expect(send).toHaveBeenCalledWith({ type: 'chat.act', rid: expect.any(String), qid: 'q1', rows: [0], deny: true });
    expect(result.current.actingRows).toEqual([0]);
    act(() => result.current.deny('q1', 0));
    expect(send).toHaveBeenCalledOnce();
  });

  it('a plan under way: held while a row sent runs or is still to come; freed once none is', () => {
    const { send, result, rerender, props } = setup();
    act(() => result.current.act('q1', [0, 1], true));
    const at = (states: Array<ChatAction['state']>) => rerender({ ...props, chat: [turn({ actions: [archive, dissolve].map((a, i) => ({ ...a, ...(states[i] ? { state: states[i] } : {}) })) })] });
    at(['running']);
    expect(result.current.actingQid).toBe('q1');
    act(() => result.current.act('q1', [1], true));
    expect(send).toHaveBeenCalledOnce();
    at(['done']);
    expect(result.current.actingQid).toBe('q1');
    at(['done', 'running']);
    expect(result.current.actingQid).toBe('q1');
    at(['done', 'done']);
    expect(result.current.actingQid).toBeNull();
  });

  it('a plan stopped: a row sent failed or refused frees it, the rest still proposed', () => {
    for (const stop of ['failed', 'refused'] as const) {
      const { result, rerender, props } = setup();
      act(() => result.current.act('q1', [0, 1], true));
      rerender({ ...props, chat: [turn({ actions: [{ ...archive, state: stop }, dissolve] })] });
      expect(result.current.actingQid, stop).toBeNull();
    }
  });

  it('its chat.acted frees it, whatever the history says; another rid\'s does not', () => {
    let listener: ((m: ServerMessage) => void) | null = null;
    const onMessage = (fn: (m: ServerMessage) => void) => { listener = fn; return () => { listener = null; }; };
    const { send, result } = setup({ onMessage });
    act(() => result.current.act('q1', [0], false));
    const rid = (send.mock.calls[0]![0] as { rid: string }).rid;
    act(() => listener!({ type: 'chat.acted', rid: 'other', qid: 'q1', done: [], failed: [] }));
    expect(result.current.actingQid).toBe('q1');
    act(() => listener!({ type: 'chat.acted', rid, qid: 'q1', done: [0], failed: [] }));
    expect(result.current.actingQid).toBeNull();
  });

  it('a machine not ready: nothing is sent', () => {
    const { send, result } = setup({ turnReady: () => false });
    act(() => result.current.act('q1', [0], false));
    act(() => result.current.ignore('q1', false));
    expect(send).not.toHaveBeenCalled();
  });

  it('Ignore and Review: chat.ignore, undo for Review', () => {
    const { send, result } = setup();
    act(() => result.current.ignore('q1', false));
    act(() => result.current.ignore('q1', true));
    expect(send.mock.calls.map(c => c[0])).toEqual([{ type: 'chat.ignore', qid: 'q1' }, { type: 'chat.ignore', qid: 'q1', undo: true }]);
  });
});
