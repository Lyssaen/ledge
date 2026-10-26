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
      if (patch.state !== 'failed' && patch.state !== 'refused') delete next.error;
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
  it('re-resolves each row first: a refused one, or one whose target changed, is refused without being sent, and stops the plan', async () => {
    const c = card([row('session.decide', { session: 'a', decision: 'accept', expect: { key: 'k1' } }, { risk: 'destructive' }), row('session.archive', { session: 'b' })]);
    const { d, applied } = deps(c, { resolve: r => (r.action === 'session.decide' ? { ...r, args: { ...r.args, expect: { key: 'k2' } } } : r) });
    expect(await actFromChat(d, 'q1', undefined, true)).toEqual({ done: [], failed: [{ row: 0, message: 'the request has changed since the card', refused: true }] });
    expect(c.rows[0]).toMatchObject({ state: 'refused', error: 'the request has changed since the card' });
    expect(c.rows[1]).not.toHaveProperty('state');
    expect(applied).toEqual([]);
    const gone = card([row('session.archive', { session: 'a' })]);
    const g = deps(gone, { resolve: () => ({ refused: 'unknown session a', code: 'unknown' as const }) });
    expect(await actFromChat(g.d, 'q1')).toEqual({ done: [], failed: [{ row: 0, message: 'unknown session a', refused: true }] });
    expect(gone.rows[0]).toMatchObject({ state: 'refused', error: 'unknown session a', code: 'unknown' });
  });
  it('a changed target is refused with the code changed, a failure sent with failed', async () => {
    const c = card([row('session.interrupt', { session: 'a' })]);
    const { d } = deps(c, { resolve: (r: ChatAction) => ({ ...r, args: { session: 'b' } }) });
    await actFromChat(d, 'q1');
    expect(c.rows[0]).toMatchObject({ state: 'refused', code: 'changed' });
    const f = card([row('session.interrupt', { session: 'a' })]);
    const x = deps(f, { apply: async () => { throw new Error('tmux died'); } });
    await actFromChat(x.d, 'q1');
    expect(f.rows[0]).toMatchObject({ state: 'failed', error: 'tmux died', code: 'failed' });
  });
  it('accepting a cut request from the card is refused before it is sent; denying it is sent', async () => {
    const accept = row('session.decide', { session: 'a', decision: 'accept' }, { detail: 'x…', detailCut: true });
    const c = card([accept]);
    const { d, applied } = deps(c);
    expect((await actFromChat(d, 'q1', undefined, true)).failed).toEqual([{ row: 0, message: 'a\'s request is cut on the card: accept it in the session', refused: true }]);
    expect(c.rows[0]).toMatchObject({ state: 'refused', code: 'cut' });
    expect(applied).toEqual([]);
    const deny = card([row('session.decide', { session: 'a', decision: 'deny' }, { detail: 'x…', detailCut: true })]);
    const x = deps(deny);
    expect(await actFromChat(x.d, 'q1')).toEqual({ done: [0], failed: [] });
    expect(x.applied).toEqual(['a']);
  });
  describe('« Refuser » (deny)', () => {
    const accept = (extra: Partial<ChatAction> = {}) => row('session.decide', { session: 'a', decision: 'accept', expect: { kind: 'plan', text: 'P', key: 'k' } }, { risk: 'destructive', ...extra });
    it('answers the request with deny, unconfirmed, and marks the row denied with its time', async () => {
      const c = card([accept()]);
      const sent: ChatAction[] = [];
      const { d } = deps(c, { apply: async (r: ChatAction) => { sent.push(r); } });
      expect(await actFromChat(d, 'q1', undefined, undefined, true)).toEqual({ done: [0], failed: [] });
      expect(sent.map(r => r.args)).toEqual([{ session: 'a', decision: 'deny', expect: { kind: 'plan', text: 'P', key: 'k' } }]);
      expect(c.rows[0]).toMatchObject({ state: 'denied', doneAt: '2026-10-26T10:00:00.000Z' });
      expect(c.rows[0]!.args.decision).toBe('accept');
      // Denied is settled, as done is.
      await expect(actFromChat(d, 'q1', undefined, undefined, true)).rejects.toThrow('already done');
      await expect(actFromChat(d, 'q1', undefined, true)).rejects.toThrow('already done');
    });
    it('is allowed on a request shown cut', async () => {
      const c = card([accept({ detail: 'x…', detailCut: true })]);
      const { d, applied } = deps(c);
      expect(await actFromChat(d, 'q1', undefined, undefined, true)).toEqual({ done: [0], failed: [] });
      expect(applied).toEqual(['a']);
    });
    it('refuses a row that is not a request, and sends nothing', async () => {
      const c = card([accept(), row('team.dissolve', { team: 't' }, { risk: 'destructive' })]);
      const { d, applied } = deps(c);
      await expect(actFromChat(d, 'q1', undefined, undefined, true)).rejects.toThrow('only a request is refused');
      expect(applied).toEqual([]);
    });
  });
  it('the same args at another risk (a template saved meanwhile) is refused: it was confirmed at the old one', async () => {
    const c = card([row('team.save', { team: 't', name: 'api', seats: [] })]);
    const { d, applied } = deps(c, { resolve: (r: ChatAction) => ({ ...r, risk: 'destructive' as const }) });
    expect((await actFromChat(d, 'q1')).failed).toEqual([{ row: 0, message: 'the target has changed since the card', refused: true }]);
    expect(applied).toEqual([]);
  });
});
