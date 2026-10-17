import { describe, it, expect } from 'vitest';
import { transition, initialSurface, TIMERS, FINISHED_BUBBLE_MS, type SurfaceState, type SurfaceEvent } from '../src/surface/machine';
import { createSurfaceController } from '../src/surface/controller';

const run = (events: SurfaceEvent[], start: SurfaceState = initialSurface()) => {
  let s = start; const effects: string[] = [];
  for (const e of events) { const r = transition(s, e); s = r.state; effects.push(...r.effects.map(x => `${x.type}:${x.name}`)); }
  return { s, effects };
};
const ask = (id = 'a') => run([{ type: 'ask', id }, { type: 'unfoldElapsed' as never }]).s;

describe('sober surface machine', () => {
  it('the resident opens the chat', () => {
    const { s } = run([{ type: 'homeClick' }]);
    expect(s.mode).toBe('chat');
    expect(s.selectedId).toBeNull();
    expect(run([{ type: 'back' }], s).s.mode).toBe('handle');
  });

  it('an ask grows the bot first, then unfolds, and stays without a clock', () => {
    const r = run([{ type: 'ask', id: 'a' }]);
    expect(r.s.mode).toBe('handle'); expect(r.s.queue).toEqual(['a']); expect(r.effects).toContain('startTimer:unfold');
    const r2 = run([{ type: 'unfoldElapsed' as never }], r.s);
    expect(r2.s).toMatchObject({ mode: 'bubble', bubbleId: 'a', bubbleKind: 'ask' });
    expect(r2.effects).not.toContain('startTimer:bubble');
    expect(run([{ type: 'bubbleElapsed' }], r2.s).s.mode).toBe('bubble');
  });

  it('a second ask queues behind the bubble', () => {
    const { s } = run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }, { type: 'ask', id: 'b' }]);
    expect(s.mode).toBe('bubble'); expect(s.bubbleId).toBe('a'); expect(s.queue).toEqual(['a', 'b']);
  });

  it('Later sets the ask aside and shows the next one that was not', () => {
    const first = ask('a');
    const both = run([{ type: 'ask', id: 'b' }], first).s;
    const later = run([{ type: 'defer' }], both);
    expect(later.s).toMatchObject({ mode: 'bubble', bubbleId: 'b', queue: ['a', 'b'], deferred: ['a'] });
    const none = run([{ type: 'defer' }], later.s);
    expect(none.s).toMatchObject({ mode: 'handle', queue: ['a', 'b'], deferred: ['a', 'b'] });
  });

  it('clicking a bot with an ask shows it again; clicking another opens a peek', () => {
    const aside = run([{ type: 'defer' }], ask()).s;
    const back = run([{ type: 'botClick', id: 'a' }], aside);
    expect(back.s).toMatchObject({ mode: 'bubble', bubbleId: 'a', deferred: [] });
    const peek = run([{ type: 'botClick', id: 'b' }], aside);
    expect(peek.s).toMatchObject({ mode: 'peek', selectedId: 'b', queue: ['a'] });
    expect(run([{ type: 'back' }], peek.s).s.mode).toBe('handle');
  });

  it('hovering the edge no longer opens a list, and an ask waits out the brush', () => {
    const dwell = run([{ type: 'handleEnter' }, { type: 'dwellElapsed' }]);
    expect(dwell.s.mode).toBe('handle');
    const brushed = run([{ type: 'ask', id: 'a' }], dwell.s);
    expect(brushed.s.mode).toBe('handle'); expect(brushed.s.unfoldDue).toBe(true);
    const left = run([{ type: 'handleLeave' }, { type: 'unfoldElapsed' as never }], brushed.s);
    expect(left.s).toMatchObject({ mode: 'bubble', bubbleId: 'a' });
  });

  it('Ctrl+Alt+L opens the first ask, then the chat, and from the chat it folds', () => {
    const queued = run([{ type: 'ask', id: 'a' }]).s;
    const shown = run([{ type: 'shortcut' }], queued);
    expect(shown.s).toMatchObject({ mode: 'bubble', bubbleId: 'a' });
    const chat = run([{ type: 'shortcut' }], shown.s);
    expect(chat.s.mode).toBe('chat'); expect(chat.s.queue).toEqual(['a']);
    expect(run([{ type: 'shortcut' }], chat.s).s.mode).toBe('handle');
    expect(run([{ type: 'shortcut' }]).s.mode).toBe('chat');
  });

  it('a shortcut brings back an ask that was set aside', () => {
    const aside = run([{ type: 'defer' }], ask()).s;
    expect(run([{ type: 'shortcut' }], aside).s).toMatchObject({ mode: 'bubble', bubbleId: 'a', deferred: [] });
  });

  it('the screens that left the island cannot be opened', () => {
    const start = initialSurface();
    for (const type of ['newSession', 'settings', 'help', 'launch', 'rowClick', 'documentOpen', 'openHelper'] as const) {
      const event = type === 'rowClick' || type === 'openHelper' ? { type, id: 'a' } : type === 'documentOpen' ? { type, origin: { kind: 'chat' as const } } : { type };
      expect(run([event as SurfaceEvent], start).s).toBe(start);
    }
  });

  it('do not disturb keeps the queue and unfolds nothing, including an ask that arrives while it is on', () => {
    const up = ask();
    const quiet = run([{ type: 'dnd', on: true }], up);
    expect(quiet.s).toMatchObject({ mode: 'handle', quiet: true, queue: ['a'] });
    expect(quiet.effects).toContain('cancelTimer:unfold');
    const during = run([{ type: 'ask', id: 'b' }, { type: 'unfoldElapsed' as never }], quiet.s);
    expect(during.s).toMatchObject({ mode: 'handle', queue: ['a', 'b'] });
    const off = run([{ type: 'dnd', on: false }], during.s);
    expect(off.s.mode).toBe('handle'); expect(off.s.quiet).toBe(false);
  });

  it('deciding holds until both 900ms and the daemon confirmation, then the next ask follows', () => {
    const both = run([{ type: 'ask', id: 'b' }], ask()).s;
    const held = run([{ type: 'decidedInBubble' }], both);
    expect(held.s.ack).toEqual({ id: 'a', minElapsed: false, confirmed: false });
    expect(run([{ type: 'holdElapsed' }], held.s).s.mode).toBe('bubble');
    const confirmed = run([{ type: 'askCleared', id: 'a' }], run([{ type: 'holdElapsed' }], held.s).s);
    expect(confirmed.s).toMatchObject({ mode: 'bubble', bubbleId: 'b', queue: ['b'], ack: null });
  });

  it('a removal of the acknowledged ask confirms it', () => {
    const held = run([{ type: 'decidedInBubble' }, { type: 'holdElapsed' }], ask()).s;
    expect(run([{ type: 'removed', id: 'a', remaining: [] }], held).s).toMatchObject({ mode: 'handle', queue: [] });
  });

  it('a repeated decision does not restart the acknowledgement', () => {
    const held = run([{ type: 'decidedInBubble' }], ask()).s;
    expect(run([{ type: 'decidedInBubble' }], held).s).toBe(held);
  });

  it('a late confirmation cannot steal a peek opened since', () => {
    const held = run([{ type: 'decidedInBubble' }], ask()).s;
    const peek = run([{ type: 'botClick', id: 'b' }], held).s;
    expect(run([{ type: 'askCleared', id: 'a' }, { type: 'holdElapsed', rev: held.rev }], peek).s).toMatchObject({ mode: 'peek', selectedId: 'b' });
  });

  it('a delayed timer from a previous context is ignored', () => {
    const shown = ask();
    const next = run([{ type: 'close' }], shown).s;
    expect(run([{ type: 'unfoldElapsed', rev: shown.rev }], next).s).toBe(next);
  });

  it('removing the peeked session folds back to the handle', () => {
    const peek = run([{ type: 'botClick', id: 'a' }]).s;
    expect(run([{ type: 'removed', id: 'a', remaining: [] }], peek).s.mode).toBe('handle');
  });

  it('a replaced request confirms an acknowledgement in progress and shows the new one', () => {
    const held = run([{ type: 'decidedInBubble' }], ask()).s;
    const replaced = run([{ type: 'askReplaced', id: 'a' }], held);
    expect(replaced.s.ack?.confirmed).toBe(true);
    expect(run([{ type: 'holdElapsed' }], replaced.s).s).toMatchObject({ mode: 'bubble', bubbleId: 'a', ack: null });
  });

  it('a terminal error unlocks the ask and does not start a clock', () => {
    const acked = run([{ type: 'decidedInBubble' }], ask()).s;
    const r = run([{ type: 'decisionFailed', id: 'a' }], acked);
    expect(r.s).toMatchObject({ mode: 'bubble', bubbleId: 'a', ack: null, failed: 'a', queue: ['a'] });
    expect(r.effects).toEqual(['cancelTimer:hold']);
    expect(run([{ type: 'holdElapsed', rev: acked.rev }], r.s).s).toBe(r.s);
  });

  it('a failure for another id, or outside the bubble, changes nothing', () => {
    const acked = run([{ type: 'decidedInBubble' }], ask()).s;
    expect(run([{ type: 'decisionFailed', id: 'b' }], acked).s).toBe(acked);
    const chat = run([{ type: 'chat' }]).s;
    expect(run([{ type: 'decisionFailed', id: 'a' }], chat).s).toBe(chat);
  });

  it('outside a click folds the chat and a peek, and leaves the handle and a bubble', () => {
    expect(run([{ type: 'outsideClick' }], run([{ type: 'chat' }]).s).s.mode).toBe('handle');
    expect(run([{ type: 'outsideClick' }], run([{ type: 'botClick', id: 'a' }]).s).s.mode).toBe('handle');
    expect(run([{ type: 'outsideClick' }], ask()).s.mode).toBe('bubble');
    expect(run([{ type: 'outsideClick' }]).s.mode).toBe('handle');
  });

  it('a finish on the bare handle unfolds a 6 s notice; an ask replaces it at once', () => {
    const grew = run([{ type: 'finished', id: 'a' }]);
    expect(grew.s.mode).toBe('handle'); expect(grew.effects).toContain('startTimer:unfold');
    const up = run([{ type: 'unfoldElapsed' as never }], grew.s);
    expect(up.s).toMatchObject({ mode: 'bubble', bubbleId: 'a', bubbleKind: 'finished' });
    expect(up.effects).toContain('startTimer:bubble');
    expect(run([{ type: 'bubbleElapsed' }], up.s).s.mode).toBe('handle');
    const replaced = run([{ type: 'ask', id: 'b' }], up.s);
    expect(replaced.s).toMatchObject({ mode: 'bubble', bubbleId: 'b', bubbleKind: 'ask' });
  });

  it('a second notice waits behind the first', () => {
    const up = run([{ type: 'finished', id: 'a' }, { type: 'unfoldElapsed' as never }]).s;
    const chained = run([{ type: 'notice', id: 'm', kind: 'offline' }], up);
    expect(chained.s.bubbleId).toBe('a'); expect(chained.s.done).toEqual(['a', 'm']);
    const next = run([{ type: 'bubbleElapsed' }], chained.s);
    expect(next.s).toMatchObject({ mode: 'bubble', bubbleId: 'm', bubbleKind: 'offline' });
  });

  it('an error notice does not cover an ask; it follows once the ask is done', () => {
    const waiting = run([{ type: 'notice', id: 'a', kind: 'error' }], ask()).s;
    expect(waiting).toMatchObject({ mode: 'bubble', bubbleId: 'a', bubbleKind: 'ask', done: ['a'] });
    expect(run([{ type: 'defer' }], waiting).s).toMatchObject({ mode: 'bubble', bubbleKind: 'error', bubbleId: 'a' });
  });

  it('hovering pauses a notice clock and leaving resumes the remainder', () => {
    const up = run([{ type: 'finished', id: 'a' }, { type: 'unfoldElapsed' as never }]).s;
    const paused = run([{ type: 'surfaceEnter' }], up);
    expect(paused.effects).toContain('pauseTimer:bubble');
    expect(run([{ type: 'surfaceLeave' }], paused.s).effects).toContain('resumeTimer:bubble');
  });

  it('a notice during do not disturb is not unfolded', () => {
    const quiet = run([{ type: 'dnd', on: true }]).s;
    expect(run([{ type: 'finished', id: 'a' }, { type: 'notice', id: 'm', kind: 'offline' }], quiet).s.mode).toBe('handle');
  });

  it('a Ledge finish opens the chat when its bubble is activated', () => {
    const up = run([{ type: 'finished', id: 'ledge' }, { type: 'unfoldElapsed' as never }]).s;
    expect(run([{ type: 'bubbleClick' }], up).s.mode).toBe('chat');
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

const noticeOpen = () => {
  const clock = fakeClock();
  const c = createSurfaceController({ onState: () => {}, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, now: clock.now });
  c.dispatch({ type: 'finished', id: 'a' }); clock.advance(540);
  expect(c.state()).toMatchObject({ mode: 'bubble', bubbleId: 'a', bubbleKind: 'finished' });
  return { clock, c };
};

describe('controller timers', () => {
  it('unfolds an ask after 540 ms and does not arm a bubble clock', () => {
    const timers: Array<{ ms: number; fn: () => void }> = [];
    const c = createSurfaceController({ onState: () => {}, setTimeout: ((fn: () => void, ms: number) => { timers.push({ ms, fn }); return timers.length; }) as never, clearTimeout: (() => {}) as never });
    c.dispatch({ type: 'ask', id: 'a' });
    expect(timers.at(-1)!.ms).toBe(540); timers.at(-1)!.fn();
    expect(c.state().mode).toBe('bubble');
    expect(timers.filter(t => t.ms === 4000)).toHaveLength(0);
    c.dispose();
  });

  it('a notice clock is 6 s and does not follow the animation scaling', () => {
    expect(import.meta.env.VITE_LEDGE_MOTION).toBe('0');
    expect(TIMERS.unfold).toBe(540);
    expect(FINISHED_BUBBLE_MS).toBe(6000);
    const timers: Array<{ ms: number; fn: () => void }> = [];
    const c = createSurfaceController({ onState: () => {}, setTimeout: ((fn: () => void, ms: number) => { timers.push({ ms, fn }); return timers.length; }) as never, clearTimeout: (() => {}) as never });
    c.dispatch({ type: 'finished', id: 'a' }); timers.at(-1)!.fn();
    expect(timers.at(-1)!.ms).toBe(6000);
    c.dispose();
  });

  const holds: Array<[string, SurfaceEvent, SurfaceEvent]> = [
    ['hover', { type: 'surfaceEnter' }, { type: 'surfaceLeave' }],
    ['keyboard focus', { type: 'focusWithin', on: true }, { type: 'focusWithin', on: false }],
    ['a hidden document', { type: 'visibility', hidden: true }, { type: 'visibility', hidden: false }]
  ];
  for (const [name, hold, release] of holds) {
    it(`a notice retains its remaining time under ${name}`, () => {
      const { clock, c } = noticeOpen();
      clock.advance(1000);
      c.dispatch(hold); clock.advance(5000);
      expect(c.state().mode).toBe('bubble');
      expect(c.bubbleRemaining()).toBe(5000);
      c.dispatch(release); clock.advance(4999);
      expect(c.state().mode).toBe('bubble');
      expect(c.bubbleRemaining()).toBe(1);
      clock.advance(1);
      expect(c.state()).toMatchObject({ mode: 'handle', done: [] });
      c.dispose();
    });
  }

  it('the notice clock resumes only when no hold remains', () => {
    const { clock, c } = noticeOpen();
    clock.advance(1000);
    c.dispatch({ type: 'surfaceEnter' }); c.dispatch({ type: 'focusWithin', on: true }); c.dispatch({ type: 'visibility', hidden: true });
    c.dispatch({ type: 'surfaceLeave' }); c.dispatch({ type: 'focusWithin', on: false }); clock.advance(10_000);
    expect(c.state().mode).toBe('bubble');
    c.dispatch({ type: 'visibility', hidden: false }); clock.advance(4999);
    expect(c.state().mode).toBe('bubble');
    clock.advance(1); expect(c.state().mode).toBe('handle');
  });

  it('a decision without daemon confirmation keeps the ask after 900ms', () => {
    const clock = fakeClock();
    const c = createSurfaceController({ onState: () => {}, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, now: clock.now });
    c.dispatch({ type: 'ask', id: 'a' }); clock.advance(540);
    c.dispatch({ type: 'decidedInBubble' }); clock.advance(10_000);
    expect(c.state()).toMatchObject({ mode: 'bubble', bubbleId: 'a', queue: ['a'], ack: { id: 'a', minElapsed: true, confirmed: false } });
    c.dispatch({ type: 'askCleared', id: 'a' });
    expect(c.state()).toMatchObject({ mode: 'handle', queue: [], ack: null });
    c.dispose();
  });

  it('an early confirmation waits for the 900ms minimum', () => {
    const clock = fakeClock();
    const c = createSurfaceController({ onState: () => {}, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, now: clock.now });
    c.dispatch({ type: 'ask', id: 'a' }); clock.advance(540);
    c.dispatch({ type: 'decidedInBubble' }); clock.advance(300);
    c.dispatch({ type: 'askCleared', id: 'a' }); clock.advance(599);
    expect(c.state().mode).toBe('bubble');
    clock.advance(1); expect(c.state().mode).toBe('handle');
    c.dispose();
  });

  it('a late confirmation cannot steal a peek opened since', () => {
    const clock = fakeClock();
    const c = createSurfaceController({ onState: () => {}, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, now: clock.now });
    c.dispatch({ type: 'ask', id: 'a' }); clock.advance(540);
    c.dispatch({ type: 'decidedInBubble' }); clock.advance(200);
    c.dispatch({ type: 'botClick', id: 'b' });
    c.dispatch({ type: 'askCleared', id: 'a' }); clock.advance(10_000);
    expect(c.state()).toMatchObject({ mode: 'peek', selectedId: 'b' });
    expect(clock.pending()).toBe(0);
    c.dispose();
  });

  it('dispose clears pending timers', () => {
    const { clock, c } = noticeOpen();
    c.dispose(); expect(clock.pending()).toBe(0);
  });
});
