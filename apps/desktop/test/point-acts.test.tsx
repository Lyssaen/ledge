import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DaemonError } from '@ledge/fleet';
import type { ChatTurn, PointItem } from '@ledge/protocol';
import { usePointActs } from '../src/chat/useChatCards';

const AT = '2026-11-13T13:32:00.000Z';
const nova: PointItem = { id: 'session.request:nova', event: 3, group: 'atoi', tone: 'perm', who: 'Nova', text: 'pnpm test', at: AT,
  ref: { kind: 'session.request', session: 'nova', key: 'k' }, answers: [{ id: 'accept', label: 'Autoriser', style: 'primary' }] };
const turn = (item: PointItem = nova): ChatTurn => ({ qid: 'p1', question: '', askedAt: AT, steps: [], by: 'ledge', point: { since: AT, lead: 'x', leadBy: 'daemon', items: [item] } });
type Props = { chat: ChatTurn[]; errors: DaemonError[] };

describe('usePointActs', () => {
  const setup = () => {
    const send = vi.fn();
    const hook = renderHook((p: Props) => usePointActs({ send, chat: p.chat, errors: p.errors, turnReady: () => true }), { initialProps: { chat: [turn()], errors: [] as DaemonError[] } });
    return { send, hook };
  };

  it('sends point.act once, and frees the row when it settles', () => {
    const { send, hook } = setup();
    act(() => hook.result.current.answer('p1', nova.id, { id: 'accept' }));
    act(() => hook.result.current.answer('p1', nova.id, { id: 'accept' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'point.act', qid: 'p1', item: nova.id, answer: { id: 'accept' } });
    expect(hook.result.current.busy).toEqual({ qid: 'p1', item: nova.id });
    hook.rerender({ chat: [turn({ ...nova, settled: { at: AT, where: 'chat', answer: 'Autoriser' } })], errors: [] });
    expect(hook.result.current.busy).toBeNull();
  });

  it('confirm_required asks the row again, then sends it confirmed', () => {
    const { send, hook } = setup();
    act(() => hook.result.current.answer('p1', nova.id, { id: 'accept' }));
    hook.rerender({ chat: [turn()], errors: [{ seq: 1, message: 'confirm', request: 'point.act', code: 'confirm_required' }] });
    expect(hook.result.current.busy).toBeNull();
    expect(hook.result.current.confirm).toEqual({ qid: 'p1', item: nova.id, answer: { id: 'accept' } });
    act(() => hook.result.current.settle(true));
    expect(send).toHaveBeenLastCalledWith({ type: 'point.act', qid: 'p1', item: nova.id, answer: { id: 'accept' }, confirmed: true });
    expect(hook.result.current.confirm).toBeNull();
  });

  it('a suggestion goes as suggest; cancelling a confirmation sends nothing', () => {
    const { send, hook } = setup();
    act(() => hook.result.current.suggest('p1', nova.id));
    expect(send).toHaveBeenLastCalledWith({ type: 'point.act', qid: 'p1', item: nova.id, suggest: true });
    hook.rerender({ chat: [turn()], errors: [{ seq: 1, message: 'confirm', request: 'point.act', code: 'confirm_required' }] });
    act(() => hook.result.current.settle(false));
    expect(send).toHaveBeenCalledTimes(1);
    expect(hook.result.current.confirm).toBeNull();
  });
});
