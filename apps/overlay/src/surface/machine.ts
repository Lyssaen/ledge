import type { Mode } from './geometry';
export type { Mode };

/** Acknowledgement of a decision taken in the bubble: it advances only once the 900 ms minimum
 *  has elapsed AND the daemon confirmed (askCleared or removal of that id). */
export interface Ack { id: string; minElapsed: boolean; confirmed: boolean }
export interface SurfaceState {
  mode: Mode; selectedId: string | null; bubbleId: string | null; queue: string[]; openedBy: 'mouse' | 'keyboard' | null;
  hot: boolean; reading: boolean; typing: boolean;
  /** Facts about the surface that hold the bubble clock (and guard the list's leave timer). */
  hovering: boolean; focusWithin: boolean; hidden: boolean;
  ack: Ack | null;
  /** Bumped whenever the view context (mode, bubble, selection) changes; delayed events carrying an older rev are ignored. */
  rev: number;
}
export type TimerName = 'dwell' | 'leave' | 'bubble' | 'hold' | 'unfold';
export type Effect =
  | { type: 'startTimer'; name: TimerName; ms: number } | { type: 'cancelTimer'; name: TimerName }
  | { type: 'pauseTimer'; name: 'bubble' } | { type: 'resumeTimer'; name: 'bubble' };
/** `rev` is stamped by the controller on timer events; omitted, the event is accepted. */
type Elapsed<T extends string> = { type: T; rev?: number };
export type SurfaceEvent =
  | { type: 'ask'; id: string } | { type: 'askCleared'; id: string } | { type: 'removed'; id: string; remaining: string[] }
  | { type: 'edgeEnter' } | { type: 'edgeLeave' } | Elapsed<'dwellElapsed'> | Elapsed<'unfoldElapsed'>
  | { type: 'surfaceEnter' } | { type: 'surfaceLeave' } | Elapsed<'leaveElapsed'>
  | { type: 'focusWithin'; on: boolean } | { type: 'visibility'; hidden: boolean }
  | { type: 'botClick'; id: string } | { type: 'rowClick'; id: string } | { type: 'bubbleClick' } | Elapsed<'bubbleElapsed'>
  | { type: 'decidedInBubble' } | Elapsed<'holdElapsed'> | { type: 'back' } | { type: 'close' } | { type: 'shortcut' }
  | { type: 'typing'; on: boolean } | { type: 'reading'; on: boolean };

/** Functional durations: independent of the `ms()` animation scaling. */
export const TIMERS: Record<TimerName, number> = { dwell: 180, leave: 500, bubble: 4000, hold: 900, unfold: 540 };
export const ELAPSED: Record<TimerName, 'dwellElapsed' | 'leaveElapsed' | 'bubbleElapsed' | 'holdElapsed' | 'unfoldElapsed'> =
  { dwell: 'dwellElapsed', leave: 'leaveElapsed', bubble: 'bubbleElapsed', hold: 'holdElapsed', unfold: 'unfoldElapsed' };

export const initialSurface = (): SurfaceState => ({
  mode: 'handle', selectedId: null, bubbleId: null, queue: [], openedBy: null, hot: false, reading: false, typing: false,
  hovering: false, focusWithin: false, hidden: false, ack: null, rev: 0
});

type Result = { state: SurfaceState; effects: Effect[] };
const start = (name: TimerName, ms = TIMERS[name]): Effect => ({ type: 'startTimer', name, ms });
const cancel = (name: TimerName): Effect => ({ type: 'cancelTimer', name });
const cancelAll: Effect[] = (['dwell', 'leave', 'bubble', 'hold', 'unfold'] as TimerName[]).map(cancel);
const same = (s: SurfaceState): Result => ({ state: s, effects: [] });
const held = (s: SurfaceState) => s.hovering || s.focusWithin || s.hidden;
const toHandle = (s: SurfaceState): SurfaceState => ({ ...s, mode: 'handle', bubbleId: null, selectedId: null, openedBy: null, hot: false, reading: false, typing: false, ack: null });
const open = (s: SurfaceState, id: string): Result => ({ state: { ...s, mode: 'session', selectedId: id, bubbleId: null, hot: false, ack: null }, effects: cancelAll });
/** Shows the bubble for `id` with a fresh clock, paused straight away if something already holds it. */
const showBubble = (s: SurfaceState, id: string, extra: Effect[] = []): Result => ({
  state: { ...s, mode: 'bubble', bubbleId: id, ack: null },
  effects: [...extra, start('bubble'), ...(held(s) ? [{ type: 'pauseTimer', name: 'bubble' } as Effect] : [])]
});
/** Leaves the bubble after a resolved ask: next queued ask, or the handle. */
const advance = (s: SurfaceState): Result => {
  const next = s.queue[0];
  return next !== undefined ? showBubble(s, next, [cancel('hold')]) : { state: toHandle(s), effects: [cancel('bubble'), cancel('hold')] };
};
/** Pause/resume the bubble clock when the set of holds flips (never during an acknowledgement). */
const holdEffects = (before: SurfaceState, after: SurfaceState): Effect[] => {
  if (after.mode !== 'bubble' || after.ack || held(before) === held(after)) return [];
  return [{ type: held(after) ? 'pauseTimer' : 'resumeTimer', name: 'bubble' }];
};
const listMayFold = (s: SurfaceState) => s.mode === 'list' && s.openedBy === 'mouse' && !s.typing && !s.focusWithin && !s.hovering;
/** A daemon confirmation (askCleared or removal) for the acknowledged id. */
const confirm = (s: SurfaceState, queue: string[]): Result => {
  const ack = { ...s.ack!, confirmed: true };
  const next = { ...s, queue, ack };
  return ack.minElapsed ? advance(next) : same(next);
};

function step(s: SurfaceState, e: SurfaceEvent): Result {
  switch (e.type) {
    case 'ask': {
      const queue = s.queue.includes(e.id) ? s.queue : [...s.queue, e.id];
      if (s.mode === 'handle' && !s.hot) return { state: { ...s, queue }, effects: [start('unfold')] };
      return same({ ...s, queue });
    }
    case 'unfoldElapsed': {
      const first = s.queue[0];
      if (s.mode !== 'handle' || s.hot || first === undefined) return same(s);
      return showBubble(s, first);
    }
    case 'askCleared': {
      const queue = s.queue.filter(id => id !== e.id);
      if (s.mode === 'bubble' && s.ack?.id === e.id) return confirm(s, queue);
      if (s.mode === 'bubble' && s.bubbleId === e.id) return advance({ ...s, queue });
      return same({ ...s, queue });
    }
    case 'removed': {
      const queue = s.queue.filter(id => id !== e.id);
      if (s.mode === 'session' && s.selectedId === e.id) return { state: e.remaining.length ? { ...s, queue, mode: 'list', selectedId: null, reading: false } : toHandle({ ...s, queue }), effects: cancelAll };
      if (s.mode === 'bubble' && s.ack?.id === e.id) return confirm(s, queue);
      if (s.mode === 'bubble' && s.bubbleId === e.id) return { state: toHandle({ ...s, queue }), effects: cancelAll };
      return same({ ...s, queue });
    }
    case 'edgeEnter': return s.mode === 'handle' && !s.hot ? { state: { ...s, hot: true }, effects: [start('dwell'), cancel('unfold')] } : same(s);
    case 'edgeLeave': return { state: { ...s, hot: false }, effects: [cancel('dwell')] };
    case 'dwellElapsed': return s.mode === 'handle' && s.hot ? { state: { ...s, mode: 'list', openedBy: 'mouse', hot: false }, effects: [cancel('unfold')] } : same(s);
    case 'surfaceEnter': {
      const next = { ...s, hovering: true, hot: false };
      return { state: next, effects: [cancel('leave'), cancel('dwell'), ...holdEffects(s, next)] };
    }
    case 'surfaceLeave': {
      const next = { ...s, hovering: false };
      return { state: next, effects: [...holdEffects(s, next), ...(listMayFold(next) ? [start('leave')] : [])] };
    }
    case 'focusWithin': {
      const next = { ...s, focusWithin: e.on };
      const leave = e.on ? [cancel('leave')] : listMayFold(next) ? [start('leave')] : [];
      return { state: next, effects: [...holdEffects(s, next), ...leave] };
    }
    case 'visibility': {
      const next = { ...s, hidden: e.hidden };
      return { state: next, effects: holdEffects(s, next) };
    }
    case 'leaveElapsed': return listMayFold(s) ? { state: toHandle(s), effects: [] } : same(s);
    case 'botClick': case 'rowClick': return open(s, e.id);
    case 'bubbleClick': return s.bubbleId ? open(s, s.bubbleId) : same(s);
    case 'bubbleElapsed': return s.mode === 'bubble' && !s.ack ? { state: toHandle(s), effects: [] } : same(s);
    case 'decidedInBubble':
      if (s.mode !== 'bubble' || !s.bubbleId || s.ack) return same(s);
      return { state: { ...s, ack: { id: s.bubbleId, minElapsed: false, confirmed: false } }, effects: [{ type: 'pauseTimer', name: 'bubble' }, start('hold')] };
    case 'holdElapsed': {
      if (s.mode !== 'bubble' || !s.ack) return same(s);
      const next = { ...s, ack: { ...s.ack, minElapsed: true } };
      return next.ack.confirmed ? advance(next) : same(next);
    }
    case 'back': return s.mode === 'session' ? { state: { ...s, mode: 'list', selectedId: null, reading: false }, effects: [] } : same(s);
    case 'close': return { state: toHandle(s), effects: cancelAll };
    case 'shortcut': return s.mode === 'handle' ? { state: { ...s, mode: 'list', openedBy: 'keyboard', hot: false }, effects: cancelAll } : { state: toHandle(s), effects: cancelAll };
    case 'typing': return { state: { ...s, typing: e.on }, effects: e.on ? [cancel('leave')] : [] };
    case 'reading': return same({ ...s, reading: e.on });
  }
}

/** Pure: no timers, no clock. Delayed events stamped with a stale `rev` are dropped. */
export function transition(s: SurfaceState, e: SurfaceEvent): Result {
  if ('rev' in e && e.rev !== undefined && e.rev !== s.rev) return same(s);
  const r = step(s, e);
  const n = r.state;
  if (n !== s && (n.mode !== s.mode || n.bubbleId !== s.bubbleId || n.selectedId !== s.selectedId)) return { state: { ...n, rev: s.rev + 1 }, effects: r.effects };
  return r;
}
