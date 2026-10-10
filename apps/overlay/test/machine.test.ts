import { describe, it, expect } from 'vitest';
import { transition, initialSurface, TIMERS, type SurfaceState, type SurfaceEvent } from '../src/surface/machine';
import { createSurfaceController } from '../src/surface/controller';

const run = (events: SurfaceEvent[], start: SurfaceState = initialSurface()) => {
  let s = start; const effects: string[] = [];
  for (const e of events) { const r = transition(s, e); s = r.state; effects.push(...r.effects.map(x => `${x.type}:${x.name}`)); }
  return { s, effects };
};

describe('surface machine', () => {
  it('an ask grows the bot first, then unfolds the bubble', () => {
    const r = run([{ type: 'ask', id: 'a' }]);
    expect(r.s.mode).toBe('handle'); expect(r.s.queue).toEqual(['a']); expect(r.effects).toContain('startTimer:unfold');
    const r2 = run([{ type: 'unfoldElapsed' as never }], r.s);
    expect(r2.s.mode).toBe('bubble'); expect(r2.s.bubbleId).toBe('a'); expect(r2.effects).toContain('startTimer:bubble');
  });
  it('a second ask queues behind the bubble, never stacks a bubble', () => {
    const { s } = run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }, { type: 'ask', id: 'b' }]);
    expect(s.mode).toBe('bubble'); expect(s.bubbleId).toBe('a'); expect(s.queue).toEqual(['a', 'b']);
  });
  it('the bubble folds after its timer and the ask stays queued', () => {
    const { s } = run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }, { type: 'bubbleElapsed' }]);
    expect(s.mode).toBe('handle'); expect(s.queue).toEqual(['a']);
  });
  it('hovering pauses the bubble clock, leaving resumes the remainder', () => {
    const paused = run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }, { type: 'surfaceEnter' }]);
    expect(paused.effects).toContain('pauseTimer:bubble');
    expect(paused.effects).not.toContain('cancelTimer:bubble');
    const left = run([{ type: 'surfaceLeave' }], paused.s);
    expect(left.effects).toContain('resumeTimer:bubble');
    expect(left.effects).not.toContain('startTimer:bubble');
  });
  it('focus inside or a hidden document keeps the bubble paused after the mouse leaves', () => {
    const open = run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }]).s;
    const focused = run([{ type: 'surfaceEnter' }, { type: 'focusWithin', on: true }, { type: 'surfaceLeave' }], open);
    expect(focused.effects.filter(e => e === 'resumeTimer:bubble')).toHaveLength(0);
    expect(run([{ type: 'focusWithin', on: false }], focused.s).effects).toContain('resumeTimer:bubble');
    const hidden = run([{ type: 'visibility', hidden: true }, { type: 'surfaceEnter' }, { type: 'surfaceLeave' }], open);
    expect(hidden.effects.filter(e => e.endsWith(':bubble'))).toEqual(['pauseTimer:bubble']);
    expect(run([{ type: 'visibility', hidden: false }], hidden.s).effects).toContain('resumeTimer:bubble');
  });
  it('edge dwell opens the list by mouse; leaving closes it after the leave timer', () => {
    const { s, effects } = run([{ type: 'edgeEnter' }, { type: 'dwellElapsed' }]);
    expect(effects).toContain('startTimer:dwell'); expect(s.mode).toBe('list'); expect(s.openedBy).toBe('mouse');
    const r = run([{ type: 'surfaceLeave' }, { type: 'leaveElapsed' }], s);
    expect(r.s.mode).toBe('handle');
  });
  it('the leave timer rechecks typing and focus before folding the list', () => {
    const list = run([{ type: 'edgeEnter' }, { type: 'dwellElapsed' }, { type: 'surfaceEnter' }, { type: 'surfaceLeave' }]).s;
    expect(run([{ type: 'focusWithin', on: true }, { type: 'leaveElapsed' }], list).s.mode).toBe('list');
    expect(run([{ type: 'typing', on: true }, { type: 'leaveElapsed' }], list).s.mode).toBe('list');
    expect(run([{ type: 'surfaceEnter' }, { type: 'leaveElapsed' }], list).s.mode).toBe('list');
    expect(run([{ type: 'focusWithin', on: true }, { type: 'surfaceLeave' }], list).effects).not.toContain('startTimer:leave');
  });
  it('an ask during the dwell does not open a bubble over the list', () => {
    const { s, effects } = run([{ type: 'edgeEnter' }, { type: 'ask', id: 'a' }, { type: 'dwellElapsed' }, { type: 'unfoldElapsed' as never }]);
    expect(s.mode).toBe('list'); expect(effects.filter(e => e === 'cancelTimer:unfold').length).toBeGreaterThan(0);
  });
  it('typing keeps the list open when the mouse leaves', () => {
    const { s, effects } = run([{ type: 'edgeEnter' }, { type: 'dwellElapsed' }, { type: 'typing', on: true }, { type: 'surfaceLeave' }]);
    expect(s.mode).toBe('list'); expect(effects).not.toContain('startTimer:leave');
  });
  it('clicking a bot, a row or the bubble opens the session on that bot', () => {
    expect(run([{ type: 'botClick', id: 'b' }]).s).toMatchObject({ mode: 'session', selectedId: 'b' });
    expect(run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }, { type: 'bubbleClick' }]).s).toMatchObject({ mode: 'session', selectedId: 'a', bubbleId: null });
  });
  it('deciding in the bubble holds until both 900ms and the daemon confirmation', () => {
    const r = run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }, { type: 'decidedInBubble' }]);
    expect(r.s.mode).toBe('bubble'); expect(r.effects).toContain('startTimer:hold'); expect(r.effects).toContain('pauseTimer:bubble');
    expect(r.s.ack).toMatchObject({ id: 'a', minElapsed: false, confirmed: false });
    const timedOut = run([{ type: 'holdElapsed' }], r.s);
    expect(timedOut.s.mode).toBe('bubble'); expect(timedOut.s.bubbleId).toBe('a'); expect(timedOut.s.queue).toEqual(['a']);
    const confirmed = run([{ type: 'askCleared', id: 'a' }], timedOut.s);
    expect(confirmed.s.mode).toBe('handle'); expect(confirmed.s.queue).toEqual([]); expect(confirmed.s.ack).toBeNull();
    const early = run([{ type: 'askCleared', id: 'a' }], r.s);
    expect(early.s.mode).toBe('bubble'); expect(early.s.bubbleId).toBe('a');
    expect(run([{ type: 'holdElapsed' }], early.s).s.mode).toBe('handle');
  });
  it('a removal confirms the decision and the next queued ask follows', () => {
    const r = run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }, { type: 'ask', id: 'b' }, { type: 'decidedInBubble' }, { type: 'removed', id: 'a', remaining: ['b'] }]);
    expect(r.s).toMatchObject({ mode: 'bubble', bubbleId: 'a' });
    const next = run([{ type: 'holdElapsed' }], r.s);
    expect(next.s).toMatchObject({ mode: 'bubble', bubbleId: 'b', queue: ['b'], ack: null }); expect(next.effects).toContain('startTimer:bubble');
  });
  it('a repeated decision does not restart the acknowledgement', () => {
    const r = run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }, { type: 'decidedInBubble' }]);
    expect(run([{ type: 'decidedInBubble' }], r.s)).toMatchObject({ s: r.s, effects: [] });
  });
  it('a late confirmation for A does not change the view when B was opened since', () => {
    const decided = run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }, { type: 'decidedInBubble' }]).s;
    const staleRev = decided.rev;
    const opened = run([{ type: 'botClick', id: 'b' }], decided).s;
    const late = run([{ type: 'askCleared', id: 'a' }, { type: 'holdElapsed', rev: staleRev }], opened).s;
    expect(late).toMatchObject({ mode: 'session', selectedId: 'b', queue: [] });
  });
  it('a delayed timer from a previous context is ignored', () => {
    const bubble = run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }]).s;
    const stale = bubble.rev;
    const replaced = run([{ type: 'ask', id: 'b' }, { type: 'askCleared', id: 'a' }], bubble).s;
    expect(replaced).toMatchObject({ mode: 'bubble', bubbleId: 'b' });
    expect(run([{ type: 'bubbleElapsed', rev: stale }], replaced).s).toBe(replaced);
    expect(run([{ type: 'bubbleElapsed', rev: replaced.rev }], replaced).s.mode).toBe('handle');
  });
  it('removing the open session falls back to the list, or the handle when empty', () => {
    const s1 = run([{ type: 'botClick', id: 'a' }, { type: 'removed', id: 'a', remaining: ['b'] }]).s;
    expect(s1.mode).toBe('list'); expect(s1.selectedId).toBeNull();
    const s2 = run([{ type: 'botClick', id: 'a' }, { type: 'removed', id: 'a', remaining: [] }]).s;
    expect(s2.mode).toBe('handle');
  });
  it('shortcut toggles the list opened by keyboard', () => {
    const open = run([{ type: 'shortcut' }]).s; expect(open).toMatchObject({ mode: 'list', openedBy: 'keyboard' });
    expect(run([{ type: 'shortcut' }], open).s.mode).toBe('handle');
  });
  it('back goes to the list, close to the handle and clears reading', () => {
    const s = run([{ type: 'botClick', id: 'a' }, { type: 'reading', on: true }, { type: 'back' }]).s;
    expect(s.mode).toBe('list');
    expect(run([{ type: 'close' }], s).s).toMatchObject({ mode: 'handle', reading: false });
  });
});

function fakeClock() {
  let t = 0; let seq = 0;
  const q = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimeout: ((fn: () => void, ms: number) => { q.set(++seq, { at: t + ms, fn }); return seq; }) as never,
    clearTimeout: ((h: number) => { q.delete(h); }) as never,
    pending: () => q.size,
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | undefined;
        for (const entry of q) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
        if (!next) break;
        q.delete(next[0]); t = next[1].at; next[1].fn();
      }
      t = end;
    }
  };
}

const bubbleOpen = () => {
  const clock = fakeClock();
  const c = createSurfaceController({ onState: () => {}, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, now: clock.now });
  c.dispatch({ type: 'ask', id: 'a' }); clock.advance(540);
  expect(c.state()).toMatchObject({ mode: 'bubble', bubbleId: 'a' });
  return { clock, c };
};

describe('controller timers', () => {
  it('runs the unfold then bubble timers with the spec durations', () => {
    const timers: Array<{ ms: number; fn: () => void }> = [];
    const states: string[] = [];
    const c = createSurfaceController({ onState: s => states.push(s.mode), setTimeout: ((fn: () => void, ms: number) => { timers.push({ ms, fn }); return timers.length; }) as never, clearTimeout: (() => {}) as never });
    c.dispatch({ type: 'ask', id: 'a' });
    expect(timers.at(-1)!.ms).toBe(540); timers.at(-1)!.fn();
    expect(c.state().mode).toBe('bubble');
    expect(timers.at(-1)!.ms).toBe(4000); timers.at(-1)!.fn();
    expect(c.state().mode).toBe('handle');
    c.dispatch({ type: 'edgeEnter' }); expect(timers.at(-1)!.ms).toBe(180);
    c.dispose();
  });
  it('the functional timings do not follow the animation scaling', () => {
    expect(import.meta.env.VITE_LEDGE_MOTION).toBe('0');
    expect(TIMERS).toEqual({ dwell: 180, leave: 500, bubble: 4000, hold: 900, unfold: 540 });
  });
  const holds: Array<[string, SurfaceEvent, SurfaceEvent]> = [
    ['hover', { type: 'surfaceEnter' }, { type: 'surfaceLeave' }],
    ['keyboard focus', { type: 'focusWithin', on: true }, { type: 'focusWithin', on: false }],
    ['a hidden document', { type: 'visibility', hidden: true }, { type: 'visibility', hidden: false }]
  ];
  for (const [name, hold, release] of holds) {
    it(`the bubble retains its remaining time under ${name}`, () => {
      const { clock, c } = bubbleOpen();
      clock.advance(1000);
      c.dispatch(hold); clock.advance(5000);
      expect(c.state().mode).toBe('bubble');
      expect(c.bubbleRemaining()).toBe(3000);
      c.dispatch(release); clock.advance(2999);
      expect(c.state().mode).toBe('bubble');
      expect(c.bubbleRemaining()).toBe(1);
      clock.advance(1);
      expect(c.state()).toMatchObject({ mode: 'handle', queue: ['a'] });
      c.dispose();
    });
  }
  it('the clock resumes only when no hold remains', () => {
    const { clock, c } = bubbleOpen();
    clock.advance(1000);
    c.dispatch({ type: 'surfaceEnter' }); c.dispatch({ type: 'focusWithin', on: true }); c.dispatch({ type: 'visibility', hidden: true });
    c.dispatch({ type: 'surfaceLeave' }); c.dispatch({ type: 'focusWithin', on: false }); clock.advance(10_000);
    expect(c.state().mode).toBe('bubble');
    c.dispatch({ type: 'visibility', hidden: false }); clock.advance(2999);
    expect(c.state().mode).toBe('bubble');
    clock.advance(1); expect(c.state().mode).toBe('handle');
  });
  it('a decision without daemon confirmation keeps the bubble after 900ms', () => {
    const { clock, c } = bubbleOpen();
    c.dispatch({ type: 'decidedInBubble' }); clock.advance(10_000);
    expect(c.state()).toMatchObject({ mode: 'bubble', bubbleId: 'a', queue: ['a'], ack: { id: 'a', minElapsed: true, confirmed: false } });
    c.dispatch({ type: 'askCleared', id: 'a' });
    expect(c.state()).toMatchObject({ mode: 'handle', queue: [], ack: null });
  });
  it('an early confirmation waits for the 900ms minimum', () => {
    const { clock, c } = bubbleOpen();
    c.dispatch({ type: 'decidedInBubble' }); clock.advance(300);
    c.dispatch({ type: 'askCleared', id: 'a' }); clock.advance(599);
    expect(c.state().mode).toBe('bubble');
    clock.advance(1); expect(c.state().mode).toBe('handle');
  });
  it('a late confirmation cannot steal the view from a session opened since', () => {
    const { clock, c } = bubbleOpen();
    c.dispatch({ type: 'decidedInBubble' }); clock.advance(200);
    c.dispatch({ type: 'botClick', id: 'b' });
    c.dispatch({ type: 'askCleared', id: 'a' }); clock.advance(10_000);
    expect(c.state()).toMatchObject({ mode: 'session', selectedId: 'b' });
    expect(clock.pending()).toBe(0);
  });
  it('dispose clears pending timers', () => {
    const { clock, c } = bubbleOpen();
    c.dispose(); expect(clock.pending()).toBe(0);
  });
});
