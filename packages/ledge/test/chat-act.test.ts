import { describe, it, expect } from 'vitest';
import type { ChatAction } from '@ledge/protocol';
import { actFromChat, ActRefused } from '../src/chat/act.js';
import type { ChatMessage } from '../src/chat/service.js';

/** A card of generic rows, marked as the chat marks them. */
function card(rows: ChatAction[]) {
  const marks: string[] = [];
  const chat = {
    action: (_qid: string, r: number) => rows[r],
    markAction(_qid: string, r: number, patch: Partial<ChatAction>, emit: (m: ChatMessage) => void) {
      const next: ChatAction = { ...rows[r]!, ...patch };
      if (patch.state !== 'failed') delete next.error;
      rows[r] = next; marks.push(`${r}:${patch.state}`); emit({ type: 'chat.history', turns: [] });
    }
  };
  return { chat, rows, marks };
}
const row = (action: ChatAction['action'], args: Record<string, unknown>, extra: Partial<ChatAction> = {}): ChatAction =>
  ({ action, args, summary: action, risk: 'reversible', ...extra });

describe('actFromChat (spec 2026-10-26 action registry §9.2)', () => {
  const deps = (c: ReturnType<typeof card>, extra: Partial<Parameters<typeof actFromChat>[0]> = {}) => {
    const applied: string[] = []; const emitted: ChatMessage[] = [];
    return {
      applied, emitted,
      d: { chat: c.chat, emit: (m: ChatMessage) => emitted.push(m), inFlight: new Set<string>(), now: () => '2026-10-26T10:00:00.000Z',
        resolve: (r: ChatAction) => r, apply: async (r: ChatAction) => { applied.push(String(r.args.session ?? r.args.team)); }, ...extra }
    };
  };

  it('applies the rows in order, each marked done, a history after each mark', async () => {
    const c = card([row('session.archive', { session: 'a' }), row('session.archive', { session: 'b' })]);
    const { d, applied, emitted } = deps(c);
    expect(await actFromChat(d, 'q1')).toEqual({ done: [0, 1], failed: [] });
    expect(applied).toEqual(['a', 'b']);
    expect(c.marks).toEqual(['0:running', '0:done', '1:running', '1:done']);
    expect(c.rows[1]).toMatchObject({ state: 'done', doneAt: '2026-10-26T10:00:00.000Z' });
    expect(emitted).toHaveLength(4);
  });
  it('stops at the first failure: the row says why, the next ones are left as they were', async () => {
    const c = card([row('session.archive', { session: 'a' }), row('session.archive', { session: 'b' }), row('session.archive', { session: 'c' })]);
    const { d, applied } = deps(c, { apply: async r => { if (r.args.session === 'b') throw new Error('busy'); } });
    expect(await actFromChat(d, 'q1')).toEqual({ done: [0], failed: [{ row: 1, message: 'busy' }] });
    expect(c.rows[1]).toMatchObject({ state: 'failed', error: 'busy' });
    expect(c.rows[2]).not.toHaveProperty('state');
    expect(applied).toEqual([]);
  });
  it('applies only the rows asked for, and passes over the done ones and those in flight', async () => {
    const c = card([row('session.archive', { session: 'a' }, { state: 'done' }), row('session.archive', { session: 'b' }), row('session.archive', { session: 'c' })]);
    const { d, applied } = deps(c);
    d.inFlight.add('q1#2');
    expect(await actFromChat(d, 'q1', [0, 1, 2])).toEqual({ done: [1], failed: [] });
    expect(applied).toEqual(['b']);
    expect(d.inFlight).toEqual(new Set(['q1#2']));
  });
  it('a failed row may be tried again', async () => {
    const c = card([row('session.archive', { session: 'a' }, { state: 'failed', error: 'busy' })]);
    const { d } = deps(c);
    expect(await actFromChat(d, 'q1')).toEqual({ done: [0], failed: [] });
    expect(c.rows[0]).not.toHaveProperty('error');
  });
  it('refuses a card with no such row, or nothing left to apply', async () => {
    const { d } = deps(card([row('session.archive', { session: 'a' }, { state: 'done' })]));
    await expect(actFromChat(d, 'q1', [3])).rejects.toThrow(new ActRefused('unknown action'));
    await expect(actFromChat(d, 'q1')).rejects.toThrow(new ActRefused('already done'));
  });
  it('refuses a destructive row without the confirmation, and applies nothing', async () => {
    const c = card([row('session.archive', { session: 'a' }), row('team.dissolve', { team: 't' }, { risk: 'destructive' })]);
    const { d, applied } = deps(c);
    const e = await actFromChat(d, 'q1').then(() => null, (x: unknown) => x as ActRefused);
    expect(e).toBeInstanceOf(ActRefused); expect(e?.code).toBe('confirm_required');
    expect(applied).toEqual([]); expect(c.marks).toEqual([]);
    expect(await actFromChat(d, 'q1', undefined, true)).toEqual({ done: [0, 1], failed: [] });
  });
  it('re-resolves each row first: a refused one, or one whose target changed, fails without being applied', async () => {
    const c = card([row('session.decide', { session: 'a', decision: 'accept', expect: { key: 'k1' } }, { risk: 'destructive' }), row('session.archive', { session: 'b' })]);
    const { d, applied } = deps(c, { resolve: r => (r.action === 'session.decide' ? { ...r, args: { ...r.args, expect: { key: 'k2' } } } : r) });
    expect(await actFromChat(d, 'q1', undefined, true)).toEqual({ done: [], failed: [{ row: 0, message: 'the request has changed since the card' }] });
    expect(applied).toEqual([]);
    const gone = card([row('session.archive', { session: 'a' })]);
    const g = deps(gone, { resolve: () => ({ refused: 'unknown session a' }) });
    expect(await actFromChat(g.d, 'q1')).toEqual({ done: [], failed: [{ row: 0, message: 'unknown session a' }] });
  });
});
