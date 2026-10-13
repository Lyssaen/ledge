import { LEDGE_ID, type Mode } from './geometry';
import type { DocumentOrigin } from '../documents/useDocumentReader';
export type { Mode };
export { LEDGE_ID };

/** Acknowledgement of a decision taken in the bubble: it advances only once the 900 ms minimum
 *  has elapsed AND the daemon confirmed (askCleared or removal of that id). */
export interface Ack { id: string; minElapsed: boolean; confirmed: boolean }
export type BubbleKind = 'ask' | 'finished';
export interface SurfaceState {
  mode: Mode; selectedId: string | null;
  /** The helper whose thread the helper view shows (spec 2026-10-13 §6). */
  helperId: string | null; bubbleId: string | null; queue: string[]; openedBy: 'mouse' | 'keyboard' | null;
  /** What the bubble shows: a request to decide, or a finished notice (spec §5). */
  bubbleKind: BubbleKind;
  /** Finished notices waiting for, or showing in, a bubble; oldest first. Forgotten whenever the surface leaves the bubble. */
  done: string[];
  hot: boolean; reading: boolean; typing: boolean;
  documentOrigin: DocumentOrigin | null; documentExpanded: boolean;
  /** Facts about the surface that hold the bubble clock (hovering also guards the leave timer). */
  hovering: boolean; focusWithin: boolean; hidden: boolean;
  /** A text field inside the surface holds the focus: a mouse-opened panel stays open when the pointer leaves. */
  editing: boolean;
  ack: Ack | null;
  /** The bubble id whose decision ended in a terminal error: recovery is unlocked, no success is shown. */
  failed: string | null;
  /** An ask arrived on the handle and its bubble has not unfolded yet (an edge brush may have deferred it). */
  unfoldDue: boolean;
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
  | { type: 'ask'; id: string } | { type: 'finished'; id: string } | { type: 'askCleared'; id: string } | { type: 'askReplaced'; id: string } | { type: 'removed'; id: string; remaining: string[] }
  | { type: 'handleEnter' } | { type: 'handleLeave' } | Elapsed<'dwellElapsed'> | Elapsed<'unfoldElapsed'>
  | { type: 'surfaceEnter' } | { type: 'surfaceLeave' } | Elapsed<'leaveElapsed'>
  | { type: 'focusWithin'; on: boolean } | { type: 'editing'; on: boolean } | { type: 'visibility'; hidden: boolean } | { type: 'outsideClick' }
  | { type: 'botClick'; id: string } | { type: 'rowClick'; id: string } | { type: 'homeClick' } | { type: 'bubbleClick' } | Elapsed<'bubbleElapsed'>
  | { type: 'decidedInBubble' } | Elapsed<'holdElapsed'> | { type: 'decisionFailed'; id: string }
  | { type: 'openHelper'; id: string } | { type: 'back' } | { type: 'close' } | { type: 'shortcut' } | { type: 'newSession' } | { type: 'settings' } | { type: 'help' } | { type: 'launch' } | { type: 'chat' }
  | { type: 'documentOpen'; origin: DocumentOrigin } | { type: 'documentExpanded'; on: boolean }
  | { type: 'typing'; on: boolean } | { type: 'reading'; on: boolean } | { type: 'dnd'; on: boolean };

/** Functional durations: independent of the `ms()` animation scaling. */
export const TIMERS: Record<TimerName, number> = { dwell: 180, leave: 500, bubble: 4000, hold: 900, unfold: 540 };
/** A finished notice asks nothing, so it may stay a little longer than an ask (spec §5). */
export const FINISHED_BUBBLE_MS = 6000;
export const ELAPSED: Record<TimerName, 'dwellElapsed' | 'leaveElapsed' | 'bubbleElapsed' | 'holdElapsed' | 'unfoldElapsed'> =
  { dwell: 'dwellElapsed', leave: 'leaveElapsed', bubble: 'bubbleElapsed', hold: 'holdElapsed', unfold: 'unfoldElapsed' };

export const initialSurface = (): SurfaceState => ({
  mode: 'handle', selectedId: null, helperId: null, bubbleId: null, queue: [], openedBy: null, bubbleKind: 'ask', done: [], hot: false, reading: false, typing: false, documentOrigin: null, documentExpanded: false,
  hovering: false, focusWithin: false, hidden: false, editing: false, ack: null, failed: null, unfoldDue: false, rev: 0
});

type Result = { state: SurfaceState; effects: Effect[] };
const start = (name: TimerName, ms = TIMERS[name]): Effect => ({ type: 'startTimer', name, ms });
const cancel = (name: TimerName): Effect => ({ type: 'cancelTimer', name });
const cancelAll: Effect[] = (['dwell', 'leave', 'bubble', 'hold', 'unfold'] as TimerName[]).map(cancel);
const same = (s: SurfaceState): Result => ({ state: s, effects: [] });
const held = (s: SurfaceState) => s.hovering || s.focusWithin || s.hidden;
const toHandle = (s: SurfaceState): SurfaceState => ({ ...s, mode: 'handle', bubbleId: null, bubbleKind: 'ask', done: [], selectedId: null, helperId: null, openedBy: null, hot: false, reading: false, typing: false, documentOrigin: null, documentExpanded: false, ack: null, failed: null, unfoldDue: false });
const open = (s: SurfaceState, id: string): Result => ({ state: { ...s, mode: 'session', selectedId: id, helperId: null, bubbleId: null, bubbleKind: 'ask', done: [], hot: false, ack: null, failed: null }, effects: cancelAll });
/** Panels opened inside the same surface; Escape/back from a detail view returns to the list. */
const detail = (m: Mode) => m === 'session' || m === 'helper' || m === 'settings' || m === 'help' || m === 'launch' || m === 'chat';
/** Shows the bubble for `id` with a fresh clock, paused straight away if something already holds it. */
const showBubble = (s: SurfaceState, id: string, extra: Effect[] = [], kind: BubbleKind = 'ask'): Result => ({
  state: { ...s, mode: 'bubble', bubbleId: id, bubbleKind: kind, ack: null, failed: null },
  effects: [...extra, start('bubble', kind === 'finished' ? FINISHED_BUBBLE_MS : TIMERS.bubble), ...(held(s) ? [{ type: 'pauseTimer', name: 'bubble' } as Effect] : [])]
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
/** A panel opened by hovering the handle folds once the pointer leaves it, unless a field is being filled. A document
 *  being read stays: it is opened on purpose and often read from a distance. */
const listMayFold = (s: SurfaceState) => s.mode !== 'handle' && s.mode !== 'bubble' && s.mode !== 'reader' && s.openedBy === 'mouse' && !s.typing && !s.editing && !s.hovering;
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
      // A request always comes before a notice: it replaces a finished bubble in place.
      if (s.mode === 'bubble' && s.bubbleKind === 'finished') return showBubble({ ...s, queue, done: [] }, e.id);
      if (s.mode === 'handle' && !s.hot) return { state: { ...s, queue, unfoldDue: true }, effects: [start('unfold')] };
      // On the edge (dwelling) the unfold waits: leaving the edge re-arms it.
      return same({ ...s, queue, unfoldDue: s.unfoldDue || s.mode === 'handle' });
    }
    /* A bot finished its task (working -> idle). Only the bare handle with nothing asked shows it; elsewhere the handle's
       smiling bot is the whole signal. During an edge dwell it waits like an ask. */
    case 'finished': {
      // The session whose finished bubble is up finished again (a quick turn): the bubble stays, with a fresh clock.
      if (s.mode === 'bubble' && s.bubbleKind === 'finished' && s.bubbleId === e.id) return showBubble(s, e.id, [], 'finished');
      // A finished bubble already up: the new notice chains behind it (an ask bubble is never replaced).
      if (s.mode === 'bubble' && s.bubbleKind === 'finished' && !s.done.includes(e.id)) return same({ ...s, done: [...s.done, e.id] });
      if (s.mode !== 'handle' || s.queue.length > 0 || s.done.includes(e.id)) return same(s);
      const done = [...s.done, e.id];
      if (!s.hot) return { state: { ...s, done, unfoldDue: true }, effects: [start('unfold')] };
      return same({ ...s, done, unfoldDue: true });
    }
    case 'unfoldElapsed': {
      const ask = s.queue[0]; const fin = s.done[0];
      if (s.mode !== 'handle' || s.hot || (ask === undefined && fin === undefined)) return same({ ...s, unfoldDue: false });
      return ask !== undefined ? showBubble({ ...s, unfoldDue: false }, ask) : showBubble({ ...s, unfoldDue: false }, fin!, [], 'finished');
    }
    case 'askCleared': {
      const queue = s.queue.filter(id => id !== e.id);
      if (s.mode === 'bubble' && s.ack?.id === e.id) return confirm(s, queue);
      if (s.mode === 'bubble' && s.bubbleId === e.id) return advance({ ...s, queue });
      return same({ ...s, queue });
    }
    /* The session's request was replaced in place by a new one. An acknowledgement in progress is confirmed (the old
       request is gone) and the new one comes back as the next bubble; a bubble without one shows the new request afresh. */
    case 'askReplaced': {
      if (s.mode !== 'bubble' || s.bubbleId !== e.id) return same(s);
      const queue = s.queue.includes(e.id) ? s.queue : [e.id, ...s.queue];
      if (s.ack?.id === e.id) return confirm(s, queue);
      return showBubble({ ...s, queue }, e.id);
    }
    case 'removed': {
      const queue = s.queue.filter(id => id !== e.id);
      const done = s.done.filter(id => id !== e.id);
      if ((s.mode === 'session' || s.mode === 'helper') && s.selectedId === e.id) return { state: e.remaining.length ? { ...s, queue, done, mode: 'list', selectedId: null, helperId: null, reading: false } : toHandle({ ...s, queue }), effects: cancelAll };
      if (s.mode === 'reader' && s.documentOrigin?.kind === 'session' && s.documentOrigin.sessionId === e.id) return same({ ...s, queue, done, selectedId: null, helperId: null });
      if (s.mode === 'bubble' && s.bubbleKind === 'finished' && s.bubbleId === e.id)
        return done.length ? showBubble({ ...s, queue, done }, done[0]!, [], 'finished') : { state: toHandle({ ...s, queue }), effects: cancelAll };
      if (s.mode === 'bubble' && s.ack?.id === e.id) return confirm({ ...s, done }, queue);
      if (s.mode === 'bubble' && s.bubbleId === e.id) return advance({ ...s, queue, done });
      return same({ ...s, queue, done });
    }
    case 'handleEnter': return s.mode === 'handle' && !s.hot ? { state: { ...s, hot: true }, effects: [start('dwell'), cancel('unfold')] } : same(s);
    case 'handleLeave': {
      // An ask deferred by the edge brush unfolds once the pointer leaves the edge.
      const rearm = s.mode === 'handle' && s.unfoldDue && (s.queue.length > 0 || s.done.length > 0);
      return { state: { ...s, hot: false }, effects: [cancel('dwell'), ...(rearm ? [start('unfold')] : [])] };
    }
    case 'dwellElapsed': return s.mode === 'handle' && s.hot ? { state: { ...s, mode: 'list', openedBy: 'mouse', hot: false, unfoldDue: false }, effects: [cancel('unfold')] } : same(s);
    // Over the handle, entering the surface is also entering the handle: the dwell it started keeps running.
    case 'surfaceEnter': {
      const next = { ...s, hovering: true };
      return { state: next, effects: [cancel('leave'), ...holdEffects(s, next)] };
    }
    case 'surfaceLeave': {
      const next = { ...s, hovering: false };
      return { state: next, effects: [...holdEffects(s, next), ...(listMayFold(next) ? [start('leave')] : [])] };
    }
    case 'focusWithin': {
      const next = { ...s, focusWithin: e.on };
      return { state: next, effects: holdEffects(s, next) };
    }
    case 'editing': {
      const next = { ...s, editing: e.on };
      return { state: next, effects: e.on ? [cancel('leave')] : listMayFold(next) ? [start('leave')] : [] };
    }
    case 'visibility': {
      const next = { ...s, hidden: e.hidden };
      return { state: next, effects: holdEffects(s, next) };
    }
    case 'leaveElapsed': return listMayFold(s) ? { state: toHandle(s), effects: [] } : same(s);
    // A bot clicked on the bare handle is a mouse open: its session folds on leave like a hover-opened list.
    case 'botClick': return open(s.mode === 'handle' ? { ...s, openedBy: 'mouse' } : s, e.id);
    case 'rowClick': return open(s, e.id);
    case 'homeClick': return s.mode === 'handle' ? { state: { ...s, mode: 'list', openedBy: 'mouse', hot: false, unfoldDue: false }, effects: cancelAll } : same(s);
    case 'bubbleClick':
      if (s.bubbleId === LEDGE_ID) return { state: { ...s, mode: 'chat', selectedId: null, helperId: null, bubbleId: null, bubbleKind: 'ask', done: [], hot: false, ack: null, failed: null }, effects: cancelAll };
      return s.bubbleId ? open(s, s.bubbleId) : same(s);
    case 'bubbleElapsed': {
      if (s.mode !== 'bubble' || s.ack) return same(s);
      if (s.bubbleKind === 'finished' && s.done.length > 1) return showBubble({ ...s, done: s.done.slice(1) }, s.done[1]!, [], 'finished');
      return { state: toHandle(s), effects: [] };
    }
    case 'decidedInBubble':
      if (s.mode !== 'bubble' || !s.bubbleId || s.ack || s.bubbleKind !== 'ask') return same(s);
      return { state: { ...s, ack: { id: s.bubbleId, minElapsed: false, confirmed: false } }, effects: [{ type: 'pauseTimer', name: 'bubble' }, start('hold')] };
    case 'holdElapsed': {
      if (s.mode !== 'bubble' || !s.ack) return same(s);
      const next = { ...s, ack: { ...s.ack, minElapsed: true } };
      return next.ack.confirmed ? advance(next) : same(next);
    }
    /* A terminal error for the acknowledged decision: unlock the actions (never a success), and give a fresh clock to retry. */
    case 'decisionFailed': {
      if (s.mode !== 'bubble' || s.bubbleId !== e.id) return same(s);
      if (s.ack?.id !== e.id) return s.failed === e.id ? same(s) : same({ ...s, failed: e.id });
      return { state: { ...s, ack: null, failed: e.id }, effects: [cancel('hold'), start('bubble'), ...(held(s) ? [{ type: 'pauseTimer', name: 'bubble' } as Effect] : [])] };
    }
    /* Settings, help and the launch form: detail views over the list (never from the handle or a bubble). */
    case 'settings': case 'help': case 'launch': {
      if (s.mode === 'handle' || s.mode === 'bubble' || s.mode === e.type) return same(s);
      return { state: { ...s, mode: e.type, selectedId: null, helperId: null, reading: false }, effects: [cancel('leave')] };
    }
    case 'chat': {
      if (s.mode === 'chat') return same(s);
      if (s.mode === 'handle' || s.mode === 'bubble') {
        return { state: { ...s, mode: 'chat', selectedId: null, helperId: null, bubbleId: null, bubbleKind: 'ask', done: [], hot: false, ack: null, failed: null, unfoldDue: false }, effects: cancelAll };
      }
      return { state: { ...s, mode: 'chat', selectedId: null, helperId: null, reading: false }, effects: [cancel('leave')] };
    }
    case 'documentOpen': return s.mode === 'session' || s.mode === 'chat' ? { state: { ...s, mode: 'reader', documentOrigin: e.origin, documentExpanded: false }, effects: [cancel('leave')] } : same(s);
    case 'documentExpanded': return s.mode === 'reader' ? same({ ...s, documentExpanded: e.on }) : same(s);
    case 'openHelper':
      return s.mode === 'session' && s.selectedId ? { state: { ...s, mode: 'helper', helperId: e.id }, effects: [] } : same(s);
    case 'back': {
      if (s.mode === 'helper') return { state: { ...s, mode: 'session', helperId: null }, effects: [] };
      if (s.mode === 'reader') {
        const origin = s.documentOrigin;
        const available = origin?.kind === 'session' && s.selectedId !== null;
        return { state: { ...s, mode: origin?.kind === 'chat' ? 'chat' : available ? 'session' : 'list', selectedId: available ? s.selectedId : null, helperId: null, documentOrigin: null, documentExpanded: false }, effects: [] };
      }
      return detail(s.mode) ? { state: { ...s, mode: 'list', selectedId: null, helperId: null, reading: false }, effects: [] } : same(s);
    }
    case 'close': return { state: toHandle(s), effects: cancelAll };
    /* A press outside the window folds an open panel; the handle and a bubble are left alone. */
    case 'outsideClick': return s.mode === 'handle' || s.mode === 'bubble' ? same(s) : { state: toHandle(s), effects: cancelAll };
    /* Ctrl+Alt+N opens the launch form from anywhere (over a bubble the ask stays queued), and folds it when it shows. */
    case 'newSession': {
      if (s.mode === 'launch') return { state: toHandle(s), effects: cancelAll };
      const quiet = s.mode === 'handle' || s.mode === 'bubble';
      return { state: { ...s, mode: 'launch', openedBy: 'keyboard', selectedId: null, helperId: null, reading: false, documentOrigin: null, documentExpanded: false, hot: false, bubbleId: null, bubbleKind: 'ask', done: quiet ? [] : s.done, ack: null, failed: null, unfoldDue: false }, effects: cancelAll };
    }
    /* Ctrl+Alt+L opens the list from the handle or over a bubble (the ask stays queued), and closes any open panel. */
    case 'shortcut': return s.mode === 'handle' || s.mode === 'bubble'
      ? { state: { ...s, mode: 'list', openedBy: 'keyboard', hot: false, bubbleId: null, bubbleKind: 'ask', done: [], ack: null, failed: null, unfoldDue: false }, effects: cancelAll }
      : { state: toHandle(s), effects: cancelAll };
    case 'typing': return { state: { ...s, typing: e.on }, effects: e.on ? [cancel('leave')] : [] };
    case 'reading': return same({ ...s, reading: e.on });
    /* DND on: the bubble (an in-flight acknowledgement included: the decision is already sent) folds and the queue
       is dropped, so nothing surfaces later. Off is a no-op: asks already pending are not re-bubbled. */
    case 'dnd': {
      if (!e.on) return same(s);
      const quiet = { ...s, queue: [], done: [], unfoldDue: false };
      return { state: s.mode === 'bubble' ? toHandle(quiet) : quiet, effects: [cancel('unfold'), cancel('bubble'), cancel('hold')] };
    }
  }
}

/** Pure: no timers, no clock. Delayed events stamped with a stale `rev` are dropped. */
export function transition(s: SurfaceState, e: SurfaceEvent): Result {
  if ('rev' in e && e.rev !== undefined && e.rev !== s.rev) return same(s);
  const r = step(s, e);
  const n = r.state;
  if (n !== s && (n.mode !== s.mode || n.bubbleId !== s.bubbleId || n.bubbleKind !== s.bubbleKind || n.selectedId !== s.selectedId)) return { state: { ...n, rev: s.rev + 1 }, effects: r.effects };
  return r;
}
