import { describe, it, expect } from 'vitest';
import { transition, initialSurface, TIMERS, type SurfaceState, type SurfaceEvent } from '../src/surface/machine';
import { createSurfaceController } from '../src/surface/controller';

const run = (events: SurfaceEvent[], start: SurfaceState = initialSurface()) => {
  let s = start; const effects: string[] = [];
  for (const e of events) { const r = transition(s, e); s = r.state; effects.push(...r.effects.map(x => `${x.type}:${x.name}`)); }
  return { s, effects };
};

describe('surface machine', () => {
  it('returns from a document to its source and keeps later asks queued', () => {
    const origin = { kind: 'session' as const, sessionId: 'a' };
    const { s } = run([{ type: 'homeClick' }, { type: 'rowClick', id: 'a' }, { type: 'documentOpen', origin }, { type: 'ask', id: 'b' }, { type: 'documentExpanded', on: true }, { type: 'surfaceLeave' }, { type: 'back' }]);
    expect(s).toMatchObject({ mode: 'session', selectedId: 'a', queue: ['b'], documentOrigin: null, documentExpanded: false });
    const missing = run([{ type: 'documentOpen', origin }, { type: 'removed', id: 'a', remaining: ['b'] }, { type: 'back' }], run([{ type: 'rowClick', id: 'a' }]).s);
    expect(missing.s.mode).toBe('list');
    const chat = run([{ type: 'chat' }, { type: 'documentOpen', origin: { kind: 'chat' } }, { type: 'back' }]);
    expect(chat.s.mode).toBe('chat');
  });
  it('the resident opens the list without selecting a session', () => {
    const { s } = run([{ type: 'homeClick' }]);
    expect(s.mode).toBe('list');
    expect(s.selectedId).toBeNull();
    expect(s.openedBy).toBe('mouse');
  });
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
    const { s, effects } = run([{ type: 'handleEnter' }, { type: 'dwellElapsed' }]);
    expect(effects).toContain('startTimer:dwell'); expect(s.mode).toBe('list'); expect(s.openedBy).toBe('mouse');
    const r = run([{ type: 'surfaceLeave' }, { type: 'leaveElapsed' }], s);
    expect(r.s.mode).toBe('handle');
  });
  it('the leave timer rechecks typing and an edited field before folding the list', () => {
    const list = run([{ type: 'handleEnter' }, { type: 'dwellElapsed' }, { type: 'surfaceEnter' }, { type: 'surfaceLeave' }]).s;
    expect(run([{ type: 'editing', on: true }, { type: 'leaveElapsed' }], list).s.mode).toBe('list');
    expect(run([{ type: 'typing', on: true }, { type: 'leaveElapsed' }], list).s.mode).toBe('list');
    expect(run([{ type: 'surfaceEnter' }, { type: 'leaveElapsed' }], list).s.mode).toBe('list');
    expect(run([{ type: 'editing', on: true }, { type: 'surfaceLeave' }], list).effects).not.toContain('startTimer:leave');
  });
  it('focus on a button or a row no longer keeps a mouse-opened list open', () => {
    const list = run([{ type: 'handleEnter' }, { type: 'dwellElapsed' }, { type: 'surfaceEnter' }, { type: 'focusWithin', on: true }]).s;
    expect(run([{ type: 'surfaceLeave' }], list).effects).toContain('startTimer:leave');
    expect(run([{ type: 'surfaceLeave' }, { type: 'leaveElapsed' }], list).s.mode).toBe('handle');
  });
  it('leaving an edited field while the pointer is out arms the leave timer', () => {
    const list = run([{ type: 'handleEnter' }, { type: 'dwellElapsed' }, { type: 'editing', on: true }, { type: 'surfaceLeave' }]).s;
    expect(run([{ type: 'editing', on: false }], list).effects).toContain('startTimer:leave');
    expect(run([{ type: 'editing', on: true }], run([{ type: 'surfaceLeave' }], list).s).effects).toContain('cancelTimer:leave');
  });
  it('an ask during the dwell does not open a bubble over the list', () => {
    const { s, effects } = run([{ type: 'handleEnter' }, { type: 'ask', id: 'a' }, { type: 'dwellElapsed' }, { type: 'unfoldElapsed' as never }]);
    expect(s.mode).toBe('list'); expect(effects.filter(e => e === 'cancelTimer:unfold').length).toBeGreaterThan(0);
  });
  it('typing keeps the list open when the mouse leaves', () => {
    const { s, effects } = run([{ type: 'handleEnter' }, { type: 'dwellElapsed' }, { type: 'typing', on: true }, { type: 'surfaceLeave' }]);
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
  it('turning dnd on folds the bubble, drops the queue and cancels the unfold; off is a no-op', () => {
    const shown = run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }, { type: 'ask', id: 'b' }, { type: 'dnd', on: true }]);
    expect(shown.s.mode).toBe('handle'); expect(shown.s.bubbleId).toBeNull(); expect(shown.s.queue).toEqual([]);
    expect(shown.effects).toEqual(expect.arrayContaining(['cancelTimer:bubble', 'cancelTimer:unfold', 'cancelTimer:hold']));
    const acking = run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }, { type: 'decidedInBubble' }, { type: 'dnd', on: true }]);
    expect(acking.s.mode).toBe('handle'); expect(acking.s.ack).toBeNull();
    const growing = run([{ type: 'ask', id: 'a' }, { type: 'dnd', on: true }, { type: 'unfoldElapsed' as never }]);
    expect(growing.s.mode).toBe('handle'); expect(growing.s.queue).toEqual([]);
    const list = run([{ type: 'shortcut' }, { type: 'ask', id: 'a' }, { type: 'dnd', on: true }]);
    expect(list.s.mode).toBe('list'); expect(list.s.queue).toEqual([]);
    const off = run([{ type: 'dnd', on: false }], shown.s);
    expect(off.s).toBe(shown.s); expect(off.effects).toEqual([]);
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
    c.dispatch({ type: 'handleEnter' }); expect(timers.at(-1)!.ms).toBe(180);
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

describe('surface machine: decision failure and detail views', () => {
  const bubble = () => run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }]).s;
  it('a terminal error for the acknowledged decision unlocks recovery, never advances as a success', () => {
    const acked = run([{ type: 'decidedInBubble' }], bubble()).s;
    const r = run([{ type: 'decisionFailed', id: 'a' }], acked);
    expect(r.s.mode).toBe('bubble'); expect(r.s.bubbleId).toBe('a');
    expect(r.s.ack).toBeNull(); expect(r.s.failed).toBe('a'); expect(r.s.queue).toEqual(['a']);
    expect(r.effects).toEqual(['cancelTimer:hold', 'startTimer:bubble']);
    // The 900 ms hold that was cancelled cannot advance it later, and a retry acknowledges again.
    expect(run([{ type: 'holdElapsed', rev: acked.rev }], r.s).s).toBe(r.s);
    const retry = run([{ type: 'decidedInBubble' }], r.s).s;
    expect(retry.ack).toEqual({ id: 'a', minElapsed: false, confirmed: false });
  });
  it('a failure while something holds the bubble restarts its clock paused', () => {
    const held = run([{ type: 'surfaceEnter' }, { type: 'decidedInBubble' }], bubble()).s;
    expect(run([{ type: 'decisionFailed', id: 'a' }], held).effects).toEqual(['cancelTimer:hold', 'startTimer:bubble', 'pauseTimer:bubble']);
  });
  it('a failure for another id, or outside the bubble, changes nothing', () => {
    const acked = run([{ type: 'decidedInBubble' }], bubble()).s;
    expect(run([{ type: 'decisionFailed', id: 'b' }], acked).s).toBe(acked);
    const list = run([{ type: 'shortcut' }]).s;
    expect(run([{ type: 'decisionFailed', id: 'a' }], list).s).toBe(list);
  });
  it('a confirmation after the hold advances; an error after confirmation is ignored', () => {
    const done = run([{ type: 'decidedInBubble' }, { type: 'holdElapsed' }, { type: 'askCleared', id: 'a' }], bubble()).s;
    expect(done.mode).toBe('handle');
    expect(run([{ type: 'decisionFailed', id: 'a' }], done).s).toBe(done);
  });
  it('settings and help open inside the panel; back returns to the list, then close folds', () => {
    const list = run([{ type: 'shortcut' }]).s;
    const settings = run([{ type: 'settings' }], list).s;
    expect(settings.mode).toBe('settings'); expect(settings.openedBy).toBe('keyboard');
    expect(run([{ type: 'back' }], settings).s.mode).toBe('list');
    const help = run([{ type: 'help' }], run([{ type: 'rowClick', id: 'a' }], list).s).s;
    expect(help.mode).toBe('help'); expect(help.selectedId).toBeNull();
    expect(run([{ type: 'back' }, { type: 'close' }], help).s.mode).toBe('handle');
    // Never from the handle or over a bubble.
    expect(run([{ type: 'settings' }]).s.mode).toBe('handle');
    expect(run([{ type: 'help' }], bubble()).s.mode).toBe('bubble');
  });
  it('the launch form opens over the list or a session like settings; back returns to the list', () => {
    const list = run([{ type: 'shortcut' }]).s;
    const form = run([{ type: 'launch' }], list).s;
    expect(form.mode).toBe('launch'); expect(form.openedBy).toBe('keyboard');
    expect(run([{ type: 'launch' }], form).s).toBe(form);
    expect(run([{ type: 'back' }], form).s.mode).toBe('list');
    expect(run([{ type: 'launch' }], run([{ type: 'rowClick', id: 'a' }], list).s).s).toMatchObject({ mode: 'launch', selectedId: null });
    expect(run([{ type: 'settings' }], form).s.mode).toBe('settings');
    expect(run([{ type: 'launch' }]).s.mode).toBe('handle');
    expect(run([{ type: 'launch' }], bubble()).s.mode).toBe('bubble');
    // Mouse-opened: folds on leave unless a field being filled holds the focus.
    const byMouse = run([{ type: 'handleEnter' }, { type: 'dwellElapsed' as never }, { type: 'surfaceEnter' }, { type: 'launch' }]).s;
    expect(run([{ type: 'surfaceLeave' }], byMouse).effects).toContain('startTimer:leave');
    expect(run([{ type: 'editing', on: true }, { type: 'surfaceLeave' }], byMouse).effects).not.toContain('startTimer:leave');
  });
  it('a mouse-opened settings view folds on leave like the list, unless a field is edited', () => {
    const open = run([{ type: 'handleEnter' }, { type: 'dwellElapsed' as never }, { type: 'surfaceEnter' }, { type: 'settings' }]).s;
    expect(run([{ type: 'surfaceLeave' }], open).effects).toContain('startTimer:leave');
    expect(run([{ type: 'editing', on: true }, { type: 'surfaceLeave' }], open).effects).not.toContain('startTimer:leave');
  });
  it('a request replaced during the acknowledgement confirms it and the new request bubbles unlocked', () => {
    const held = run([{ type: 'decidedInBubble' }, { type: 'holdElapsed' }], bubble()).s;
    expect(held.ack).toEqual({ id: 'a', minElapsed: true, confirmed: false });
    const r = run([{ type: 'askReplaced', id: 'a' }], held);
    expect(r.s).toMatchObject({ mode: 'bubble', bubbleId: 'a', ack: null, failed: null });
    expect(r.effects).toContain('startTimer:bubble');
    // Replaced before the hold: confirmed now, the new request shows once the 900 ms minimum is over.
    const early = run([{ type: 'decidedInBubble' }, { type: 'askReplaced', id: 'a' }], bubble()).s;
    expect(early.ack).toMatchObject({ confirmed: true });
    expect(run([{ type: 'holdElapsed' }], early).s).toMatchObject({ mode: 'bubble', bubbleId: 'a', ack: null });
    // No acknowledgement: the bubble shows the new request with a fresh clock and no stale failure.
    const failed = run([{ type: 'decisionFailed', id: 'a' }], bubble()).s;
    const fresh = run([{ type: 'askReplaced', id: 'a' }], failed);
    expect(fresh.s).toMatchObject({ mode: 'bubble', failed: null }); expect(fresh.effects).toContain('startTimer:bubble');
    // Another session's replacement changes nothing.
    const b = bubble(); expect(run([{ type: 'askReplaced', id: 'z' }], b).s).toBe(b);
  });
  it('Ctrl+Alt+L over a bubble opens the list from the keyboard, the ask stays queued', () => {
    const r = run([{ type: 'shortcut' }], bubble());
    expect(r.s).toMatchObject({ mode: 'list', openedBy: 'keyboard', bubbleId: null, ack: null, queue: ['a'] });
    expect(r.effects).toContain('cancelTimer:bubble');
    expect(run([{ type: 'shortcut' }], r.s).s.mode).toBe('handle');
  });
  it('removing the bubble session advances to the next queued ask', () => {
    const two = run([{ type: 'ask', id: 'b' }], bubble()).s;
    expect(run([{ type: 'removed', id: 'a', remaining: ['b'] }], two).s).toMatchObject({ mode: 'bubble', bubbleId: 'b', queue: ['b'] });
    expect(run([{ type: 'removed', id: 'a', remaining: [] }], bubble()).s.mode).toBe('handle');
  });
  it('an edge brush right after an ask defers the bubble, leaving the edge re-arms it', () => {
    const brushed = run([{ type: 'ask', id: 'a' }, { type: 'handleEnter' }]);
    expect(brushed.effects).toContain('cancelTimer:unfold');
    const left = run([{ type: 'handleLeave' }], brushed.s);
    expect(left.effects).toContain('startTimer:unfold');
    expect(run([{ type: 'unfoldElapsed' as never }], left.s).s).toMatchObject({ mode: 'bubble', bubbleId: 'a' });
    // An ask during the dwell, then a leave before it opens the list: same.
    const during = run([{ type: 'handleEnter' }, { type: 'ask', id: 'a' }, { type: 'handleLeave' }]);
    expect(during.effects.at(-1)).toBe('startTimer:unfold');
    // A bubble that already timed out does not come back on an edge brush.
    const timedOut = run([{ type: 'bubbleElapsed' }], bubble()).s;
    expect(run([{ type: 'handleEnter' }, { type: 'handleLeave' }], timedOut).effects).not.toContain('startTimer:unfold');
  });

  describe('hover on the handle', () => {
    const hovered = () => run([{ type: 'handleEnter' }, { type: 'dwellElapsed' }, { type: 'surfaceEnter' }]).s;
    it('the pointer entering the surface over the handle keeps the dwell running', () => {
      const { s, effects } = run([{ type: 'surfaceEnter' }, { type: 'handleEnter' }, { type: 'surfaceEnter' }, { type: 'dwellElapsed' }]);
      expect(effects).not.toContain('cancelTimer:dwell');
      expect(s).toMatchObject({ mode: 'list', openedBy: 'mouse' });
    });
    it('a session opened from a hover-opened list folds when the pointer leaves', () => {
      const session = run([{ type: 'rowClick', id: 'a' }], hovered()).s;
      expect(session.openedBy).toBe('mouse');
      const r = run([{ type: 'surfaceLeave' }], session);
      expect(r.effects).toContain('startTimer:leave');
      expect(run([{ type: 'leaveElapsed' }], r.s).s.mode).toBe('handle');
    });
    it('the chat opened from a hover-opened list folds when the pointer leaves', () => {
      const r = run([{ type: 'chat' }, { type: 'surfaceLeave' }, { type: 'leaveElapsed' }], hovered());
      expect(r.effects).toContain('startTimer:leave'); expect(r.s.mode).toBe('handle');
    });
    it('a bot clicked on the handle opens its session as a mouse open', () => {
      const r = run([{ type: 'botClick', id: 'a' }, { type: 'surfaceLeave' }, { type: 'leaveElapsed' }]);
      expect(r.effects).toContain('startTimer:leave'); expect(r.s.mode).toBe('handle');
    });
    it('a document being read never folds on leave', () => {
      const reader = run([{ type: 'rowClick', id: 'a' }, { type: 'documentOpen', origin: { kind: 'session', sessionId: 'a' } }], hovered()).s;
      const r = run([{ type: 'surfaceLeave' }, { type: 'leaveElapsed' }], reader);
      expect(r.effects).not.toContain('startTimer:leave'); expect(r.s.mode).toBe('reader');
    });
    it('a keyboard-opened session never folds on leave', () => {
      const r = run([{ type: 'shortcut' }, { type: 'rowClick', id: 'a' }, { type: 'surfaceEnter' }, { type: 'surfaceLeave' }]);
      expect(r.effects).not.toContain('startTimer:leave');
    });
  });

  describe('outside click', () => {
    it('folds any open panel back to the handle', () => {
      const open = run([{ type: 'shortcut' }]).s;
      for (const s of [open, run([{ type: 'rowClick', id: 'a' }], open).s, run([{ type: 'settings' }], open).s, run([{ type: 'chat' }], open).s,
        run([{ type: 'rowClick', id: 'a' }, { type: 'documentOpen', origin: { kind: 'session', sessionId: 'a' } }], open).s]) {
        const r = run([{ type: 'outsideClick' }], s);
        expect(r.s.mode).toBe('handle'); expect(r.effects).toContain('cancelTimer:leave');
      }
    });
    it('leaves the handle and a bubble alone', () => {
      const handle = initialSurface(); expect(run([{ type: 'outsideClick' }], handle).s).toBe(handle);
      const b = bubble(); expect(run([{ type: 'outsideClick' }], b).s).toBe(b);
    });
  });

  describe('new session shortcut', () => {
    it('opens the launch form from the handle as a keyboard open', () => {
      const r = run([{ type: 'newSession' }]);
      expect(r.s).toMatchObject({ mode: 'launch', openedBy: 'keyboard' }); expect(r.effects).toContain('cancelTimer:unfold');
    });
    it('over a bubble, the ask stays queued', () => {
      expect(run([{ type: 'newSession' }], bubble()).s).toMatchObject({ mode: 'launch', openedBy: 'keyboard', bubbleId: null, ack: null, queue: ['a'] });
    });
    it('from any other view it opens the form, and on the form it folds back to the handle', () => {
      const session = run([{ type: 'shortcut' }, { type: 'rowClick', id: 'a' }]).s;
      const form = run([{ type: 'newSession' }], session).s;
      expect(form).toMatchObject({ mode: 'launch', selectedId: null, openedBy: 'keyboard' });
      expect(run([{ type: 'newSession' }], form).s.mode).toBe('handle');
      const reader = run([{ type: 'documentOpen', origin: { kind: 'session', sessionId: 'a' } }, { type: 'newSession' }], session).s;
      expect(reader).toMatchObject({ mode: 'launch', documentOrigin: null });
    });
  });

  describe('finished bubble', () => {
    const unfold = { type: 'unfoldElapsed' } as never;
    it('a finish on the bare handle grows the bot, then unfolds a finished bubble with a 6 s clock', () => {
      const r = run([{ type: 'finished', id: 'a' }]);
      expect(r.s.mode).toBe('handle'); expect(r.s.done).toEqual(['a']); expect(r.s.unfoldDue).toBe(true); expect(r.effects).toContain('startTimer:unfold');
      const r2 = run([unfold], r.s);
      expect(r2.s.mode).toBe('bubble'); expect(r2.s.bubbleId).toBe('a'); expect(r2.s.bubbleKind).toBe('finished');
      expect(r2.effects).toContain('startTimer:bubble');
    });
    it('the finished bubble folds after its clock and forgets the notice', () => {
      const { s } = run([{ type: 'finished', id: 'a' }, unfold, { type: 'bubbleElapsed' }]);
      expect(s.mode).toBe('handle'); expect(s.done).toEqual([]); expect(s.bubbleKind).toBe('ask');
    });
    it('a second finished notice chains after the first, oldest first, with a fresh clock', () => {
      const up = run([{ type: 'finished', id: 'a' }, unfold, { type: 'finished', id: 'b' }]);
      expect(up.s.mode).toBe('bubble'); expect(up.s.bubbleId).toBe('a'); expect(up.s.done).toEqual(['a', 'b']);
      // Appending a different id behind the bubble touches no clock.
      const shown = run([{ type: 'finished', id: 'a' }, unfold]).s;
      expect(run([{ type: 'finished', id: 'b' }], shown).effects).toEqual([]);
      const next = run([{ type: 'bubbleElapsed' }], up.s);
      expect(next.s.mode).toBe('bubble'); expect(next.s.bubbleId).toBe('b'); expect(next.s.done).toEqual(['b']); expect(next.effects).toContain('startTimer:bubble');
      expect(run([{ type: 'bubbleElapsed' }], next.s).s.mode).toBe('handle');
    });
    it('the same session finishing again re-arms its finished bubble', () => {
      const up = run([{ type: 'finished', id: 'a' }, unfold]).s;
      const again = run([{ type: 'finished', id: 'a' }], up);
      expect(again.s.mode).toBe('bubble'); expect(again.s.bubbleId).toBe('a'); expect(again.s.bubbleKind).toBe('finished');
      expect(again.s.done).toEqual(['a']);
      expect(again.effects).toContain('startTimer:bubble');
    });
    it('the same id twice is one notice', () => {
      expect(run([{ type: 'finished', id: 'a' }, { type: 'finished', id: 'a' }]).s.done).toEqual(['a']);
    });
    it('an ask replaces a finished bubble at once; a finish never replaces an ask bubble', () => {
      const r = run([{ type: 'finished', id: 'a' }, unfold, { type: 'ask', id: 'b' }]);
      expect(r.s.mode).toBe('bubble'); expect(r.s.bubbleId).toBe('b'); expect(r.s.bubbleKind).toBe('ask'); expect(r.s.done).toEqual([]);
      const r2 = run([{ type: 'ask', id: 'b' }, unfold, { type: 'finished', id: 'a' }]);
      expect(r2.s.bubbleId).toBe('b'); expect(r2.s.bubbleKind).toBe('ask'); expect(r2.s.done).toEqual([]);
    });
    it('a finish while an ask waits in the handle, or while the list or a session is open, only shows in the handle', () => {
      expect(run([{ type: 'ask', id: 'b' }, { type: 'finished', id: 'a' }]).s.done).toEqual([]);
      expect(run([{ type: 'handleEnter' }, { type: 'dwellElapsed' }, { type: 'finished', id: 'a' }]).s.done).toEqual([]);
      expect(run([{ type: 'botClick', id: 'b' }, { type: 'finished', id: 'a' }]).s.done).toEqual([]);
    });
    it('a finish during an edge dwell waits, and unfolds once the pointer leaves the edge', () => {
      const r = run([{ type: 'handleEnter' }, { type: 'finished', id: 'a' }]);
      expect(r.s.done).toEqual(['a']); expect(r.s.unfoldDue).toBe(true); expect(r.effects.filter(e => e === 'startTimer:unfold')).toHaveLength(0);
      expect(run([{ type: 'handleLeave' }], r.s).effects).toContain('startTimer:unfold');
    });
    it('hover pauses the 6 s clock, OK (close) and Open leave it, DND drops it, removal advances it', () => {
      const up = run([{ type: 'finished', id: 'a' }, unfold]).s;
      expect(run([{ type: 'surfaceEnter' }], up).effects).toContain('pauseTimer:bubble');
      expect(run([{ type: 'close' }], up).s).toMatchObject({ mode: 'handle', done: [] });
      expect(run([{ type: 'bubbleClick' }], up).s).toMatchObject({ mode: 'session', selectedId: 'a', done: [] });
      expect(run([{ type: 'dnd', on: true }], up).s).toMatchObject({ mode: 'handle', done: [] });
      expect(run([{ type: 'removed', id: 'a', remaining: ['b'] }], up).s).toMatchObject({ mode: 'handle', done: [] });
      expect(run([{ type: 'decidedInBubble' }], up).s.ack).toBeNull();
    });
  });

  it('opens the chat over the list and goes back to it', () => {
    let r = transition({ ...initialSurface(), mode: 'list', openedBy: 'mouse' }, { type: 'chat' });
    expect(r.state.mode).toBe('chat');
    r = transition(r.state, { type: 'back' }); expect(r.state.mode).toBe('list');
    expect(transition(initialSurface(), { type: 'chat' }).state.mode).toBe('chat');
  });
  it('a mouse-opened chat folds when the pointer leaves, like the list, unless its field is edited', () => {
    const chat = transition({ ...initialSurface(), mode: 'chat', openedBy: 'mouse', hovering: true }, { type: 'surfaceLeave' });
    expect(chat.effects.filter(e => e.type === 'startTimer' && e.name === 'leave')).toHaveLength(1);
    expect(run([{ type: 'leaveElapsed' }], chat.state).s.mode).toBe('handle');
    expect(run([{ type: 'editing', on: true }, { type: 'leaveElapsed' }], chat.state).s.mode).toBe('chat');
    const list = transition({ ...initialSurface(), mode: 'list', openedBy: 'mouse', hovering: true }, { type: 'surfaceLeave' });
    expect(list.effects.some(e => e.type === 'startTimer' && e.name === 'leave')).toBe(true);
  });
  it('a Ledge finish unfolds like a bot, and opening it goes to the chat', () => {
    const unfold = { type: 'unfoldElapsed' } as never;
    const r = run([{ type: 'finished', id: 'ledge' }, unfold]);
    expect(r.s).toMatchObject({ mode: 'bubble', bubbleId: 'ledge', bubbleKind: 'finished' });
    expect(run([{ type: 'bubbleClick' }], r.s).s).toMatchObject({ mode: 'chat', bubbleId: null, selectedId: null });
  });
  it('opens a helper from a session and comes back to the same session', () => {
    const { s } = run([{ type: 'rowClick', id: 'a' }, { type: 'openHelper', id: 'h1' }]);
    expect(s).toMatchObject({ mode: 'helper', selectedId: 'a', helperId: 'h1' });
    const back = run([{ type: 'back' }], s).s;
    expect(back).toMatchObject({ mode: 'session', selectedId: 'a', helperId: null });
    expect(run([{ type: 'openHelper', id: 'h1' }], run([{ type: 'homeClick' }]).s).s.mode).toBe('list'); // only from a session
    const closed = run([{ type: 'close' }], s).s;
    expect(closed.mode).not.toBe('helper');
    expect(closed.helperId).toBeNull();
    // Same as a session: the list while other sessions remain, the handle when none do.
    expect(run([{ type: 'removed', id: 'a', remaining: ['b'] }], s).s).toMatchObject({ mode: 'list', helperId: null, selectedId: null });
    expect(run([{ type: 'removed', id: 'a', remaining: [] }], s).s).toMatchObject({ mode: 'handle', helperId: null });
  });
});
