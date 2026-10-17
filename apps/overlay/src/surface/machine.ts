import { LEDGE_ID, type Mode } from './geometry';
import type { DocumentOrigin } from '../documents/useDocumentReader';
export type { Mode };
export { LEDGE_ID };

/** Acknowledgement of a decision taken in the bubble: it advances only once the 900 ms minimum
 *  has elapsed AND the daemon confirmed (askCleared or removal of that id). */
export interface Ack { id: string; minElapsed: boolean; confirmed: boolean }
export type BubbleKind = 'ask' | 'finished' | 'error' | 'offline';
export type NoticeKind = 'finished' | 'error' | 'offline';
export interface SurfaceState {
  mode: Mode; selectedId: string | null;
  /** The helper whose thread the helper view shows (spec 2026-10-13 §6). The sober island never opens it. */
  helperId: string | null; bubbleId: string | null; queue: string[]; openedBy: 'mouse' | 'keyboard' | null;
  /** What the bubble shows: a request to decide, or a notice (finished, error, offline). */
  bubbleKind: BubbleKind;
  /** Notices waiting for, or showing in, a bubble; oldest first. Forgotten whenever the surface leaves the bubble for the handle. */
  done: string[];
  /** The kind of each id in `done` (and of the notice currently shown). Absent means `finished`. */
  kinds: Record<string, NoticeKind>;
  /** Asks set aside with Later. They stay in `queue` and come back when their bot is clicked. */
  deferred: string[];
  /** Do not disturb: asks join the queue and nothing unfolds on its own. */
  quiet: boolean;
  hot: boolean; reading: boolean; typing: boolean;
  documentOrigin: DocumentOrigin | null; documentExpanded: boolean;
  /** Facts about the surface that hold a notice clock (hovering also used to guard the leave timer). */
  hovering: boolean; focusWithin: boolean; hidden: boolean;
  /** A text field inside the surface holds the focus. */
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
  | { type: 'ask'; id: string } | { type: 'finished'; id: string } | { type: 'notice'; id: string; kind: 'error' | 'offline' }
  | { type: 'askCleared'; id: string } | { type: 'askReplaced'; id: string } | { type: 'removed'; id: string; remaining: string[] }
  | { type: 'handleEnter' } | { type: 'handleLeave' } | Elapsed<'dwellElapsed'> | Elapsed<'unfoldElapsed'>
  | { type: 'surfaceEnter' } | { type: 'surfaceLeave' } | Elapsed<'leaveElapsed'>
  | { type: 'focusWithin'; on: boolean } | { type: 'editing'; on: boolean } | { type: 'visibility'; hidden: boolean } | { type: 'outsideClick' }
  | { type: 'botClick'; id: string } | { type: 'rowClick'; id: string } | { type: 'homeClick' } | { type: 'bubbleClick' } | Elapsed<'bubbleElapsed'>
  | { type: 'decidedInBubble' } | Elapsed<'holdElapsed'> | { type: 'decisionFailed'; id: string } | { type: 'defer' }
  | { type: 'openHelper'; id: string } | { type: 'back' } | { type: 'close' } | { type: 'shortcut' } | { type: 'newSession' } | { type: 'settings' } | { type: 'help' } | { type: 'launch' } | { type: 'chat' }
  | { type: 'documentOpen'; origin: DocumentOrigin } | { type: 'documentExpanded'; on: boolean }
  | { type: 'typing'; on: boolean } | { type: 'reading'; on: boolean } | { type: 'dnd'; on: boolean };

/** Functional durations: independent of the `ms()` animation scaling. */
export const TIMERS: Record<TimerName, number> = { dwell: 180, leave: 500, bubble: 4000, hold: 900, unfold: 540 };
/** A notice asks nothing, so it may stay a little longer than an ask used to (spec of the sober island). */
export const FINISHED_BUBBLE_MS = 6000;
export const ELAPSED: Record<TimerName, 'dwellElapsed' | 'leaveElapsed' | 'bubbleElapsed' | 'holdElapsed' | 'unfoldElapsed'> =
  { dwell: 'dwellElapsed', leave: 'leaveElapsed', bubble: 'bubbleElapsed', hold: 'holdElapsed', unfold: 'unfoldElapsed' };

export const initialSurface = (): SurfaceState => ({
  mode: 'handle', selectedId: null, helperId: null, bubbleId: null, queue: [], openedBy: null, bubbleKind: 'ask', done: [], kinds: {}, deferred: [], quiet: false,
  hot: false, reading: false, typing: false, documentOrigin: null, documentExpanded: false,
  hovering: false, focusWithin: false, hidden: false, editing: false, ack: null, failed: null, unfoldDue: false, rev: 0
});

type Result = { state: SurfaceState; effects: Effect[] };
const start = (name: TimerName, ms = TIMERS[name]): Effect => ({ type: 'startTimer', name, ms });
const cancel = (name: TimerName): Effect => ({ type: 'cancelTimer', name });
const cancelAll: Effect[] = (['dwell', 'leave', 'bubble', 'hold', 'unfold'] as TimerName[]).map(cancel);
const same = (s: SurfaceState): Result => ({ state: s, effects: [] });
const held = (s: SurfaceState) => s.hovering || s.focusWithin || s.hidden;
const toHandle = (s: SurfaceState): SurfaceState => ({ ...s, mode: 'handle', bubbleId: null, bubbleKind: 'ask', done: [], selectedId: null, helperId: null, openedBy: null, hot: false, reading: false, typing: false, documentOrigin: null, documentExpanded: false, ack: null, failed: null, unfoldDue: false });
const openChat = (s: SurfaceState): Result => ({
  state: { ...s, mode: 'chat', selectedId: null, helperId: null, bubbleId: null, bubbleKind: 'ask', done: [], hot: false, ack: null, failed: null, unfoldDue: false },
  effects: cancelAll
});
const noticeKind = (s: SurfaceState, id: string): NoticeKind => s.kinds[id] ?? 'finished';
/** The next ask that was not set aside. */
const nextAsk = (s: SurfaceState, skip?: string) => s.queue.find(id => id !== skip && !s.deferred.includes(id));
/** Shows the bubble for `id`. An ask stays until the user acts. A notice gets a 6 s clock, paused straight away if something already holds it. */
const showBubble = (s: SurfaceState, id: string, extra: Effect[] = [], kind: BubbleKind = 'ask'): Result => {
  const timed = kind !== 'ask';
  return {
    state: { ...s, mode: 'bubble', bubbleId: id, bubbleKind: kind, ack: null, failed: null },
    effects: [...extra, ...(timed ? [start('bubble', FINISHED_BUBBLE_MS)] : [cancel('bubble')]), ...(timed && held(s) ? [{ type: 'pauseTimer', name: 'bubble' } as Effect] : [])]
  };
};
/** Leaves the bubble after a resolved or set-aside ask: the next ask, a notice that waited, or the handle. */
const advance = (s: SurfaceState): Result => {
  const next = nextAsk(s);
  if (next !== undefined) return showBubble(s, next, [cancel('hold')]);
  const fin = !s.quiet ? s.done[0] : undefined;
  if (fin !== undefined) return showBubble(s, fin, [cancel('hold')], noticeKind(s, fin));
  return { state: toHandle(s), effects: [cancel('bubble'), cancel('hold')] };
};
/** Pause/resume a notice clock when the set of holds flips (an ask has no clock; never during an acknowledgement). */
const holdEffects = (before: SurfaceState, after: SurfaceState): Effect[] => {
  if (after.mode !== 'bubble' || after.bubbleKind === 'ask' || after.ack || held(before) === held(after)) return [];
  return [{ type: held(after) ? 'pauseTimer' : 'resumeTimer', name: 'bubble' }];
};
/** A daemon confirmation (askCleared or removal) for the acknowledged id. */
const confirm = (s: SurfaceState, queue: string[], deferred: string[]): Result => {
  const ack = { ...s.ack!, confirmed: true };
  const next = { ...s, queue, deferred, ack };
  return ack.minElapsed ? advance(next) : same(next);
};
const dropDeferred = (s: SurfaceState, id: string) => s.deferred.filter(x => x !== id);

/** Queue a notice and unfold it when the handle is free. An ask bubble is never replaced; the notice waits. */
function queueNotice(s: SurfaceState, id: string, kind: NoticeKind): Result {
  const kinds = { ...s.kinds, [id]: kind };
  if (s.quiet) return same({ ...s, kinds });
  if (s.mode === 'bubble' && s.bubbleKind !== 'ask' && s.bubbleId === id) return showBubble({ ...s, kinds }, id, [], kind);
  if (s.mode === 'bubble' && s.bubbleKind !== 'ask' && !s.done.includes(id)) return same({ ...s, kinds, done: [...s.done, id] });
  if (s.mode === 'bubble' && s.bubbleKind === 'ask') return same({ ...s, kinds, done: s.done.includes(id) ? s.done : [...s.done, id] });
  if (s.mode !== 'handle' || s.queue.length > 0 || s.done.includes(id)) return same({ ...s, kinds });
  const done = [...s.done, id];
  if (!s.hot) return { state: { ...s, kinds, done, unfoldDue: true }, effects: [start('unfold')] };
  return same({ ...s, kinds, done, unfoldDue: true });
}

function step(s: SurfaceState, e: SurfaceEvent): Result {
  switch (e.type) {
    case 'ask': {
      const queue = s.queue.includes(e.id) ? s.queue : [...s.queue, e.id];
      if (s.quiet) return same({ ...s, queue });
      // A request always comes before a notice: it replaces a finished bubble in place.
      if (s.mode === 'bubble' && s.bubbleKind !== 'ask') return showBubble({ ...s, queue, done: [] }, e.id);
      if (s.mode === 'handle' && !s.hot) return { state: { ...s, queue, unfoldDue: true }, effects: [start('unfold')] };
      // On the edge (dwelling) the unfold waits: leaving the edge re-arms it.
      return same({ ...s, queue, unfoldDue: s.unfoldDue || s.mode === 'handle' });
    }
    /* A bot finished its task (working -> idle). Only the bare handle with nothing asked shows it; elsewhere the handle's
       smiling bot is the whole signal. During an edge dwell it waits like an ask. */
    case 'finished': return queueNotice(s, e.id, 'finished');
    case 'notice': return queueNotice(s, e.id, e.kind);
    case 'unfoldElapsed': {
      const ask = nextAsk(s); const fin = s.done[0];
      if (s.mode !== 'handle' || s.hot || s.quiet || (ask === undefined && fin === undefined)) return same({ ...s, unfoldDue: false });
      return ask !== undefined ? showBubble({ ...s, unfoldDue: false }, ask) : showBubble({ ...s, unfoldDue: false }, fin!, [], noticeKind(s, fin!));
    }
    case 'askCleared': {
      const queue = s.queue.filter(id => id !== e.id);
      const deferred = dropDeferred(s, e.id);
      if (s.mode === 'bubble' && s.ack?.id === e.id) return confirm(s, queue, deferred);
      if (s.mode === 'bubble' && s.bubbleId === e.id && s.bubbleKind === 'ask') return advance({ ...s, queue, deferred });
      return same({ ...s, queue, deferred });
    }
    /* The session's request was replaced in place by a new one. An acknowledgement in progress is confirmed (the old
       request is gone) and the new one comes back as the next bubble; a bubble without one shows the new request afresh. */
    case 'askReplaced': {
      if (s.mode !== 'bubble' || s.bubbleId !== e.id || s.bubbleKind !== 'ask') return same(s);
      const queue = s.queue.includes(e.id) ? s.queue : [e.id, ...s.queue];
      const deferred = dropDeferred(s, e.id);
      if (s.ack?.id === e.id) return confirm({ ...s, deferred }, queue, deferred);
      return showBubble({ ...s, queue, deferred }, e.id);
    }
    case 'removed': {
      const queue = s.queue.filter(id => id !== e.id);
      const done = s.done.filter(id => id !== e.id);
      const deferred = dropDeferred(s, e.id);
      if (s.mode === 'peek' && s.selectedId === e.id) return { state: toHandle({ ...s, queue, deferred }), effects: cancelAll };
      if (s.mode === 'bubble' && s.bubbleKind !== 'ask' && s.bubbleId === e.id)
        return done.length ? showBubble({ ...s, queue, done, deferred }, done[0]!, [], noticeKind(s, done[0]!)) : { state: toHandle({ ...s, queue, deferred }), effects: cancelAll };
      if (s.mode === 'bubble' && s.ack?.id === e.id) return confirm({ ...s, done, deferred }, queue, deferred);
      if (s.mode === 'bubble' && s.bubbleId === e.id && s.bubbleKind === 'ask') return advance({ ...s, queue, done, deferred });
      return same({ ...s, queue, done, deferred });
    }
    case 'handleEnter': return s.mode === 'handle' && !s.hot ? { state: { ...s, hot: true }, effects: [start('dwell'), cancel('unfold')] } : same(s);
    case 'handleLeave': {
      // An ask deferred by the edge brush unfolds once the pointer leaves the edge.
      const rearm = s.mode === 'handle' && s.unfoldDue && (s.queue.length > 0 || s.done.length > 0) && !s.quiet;
      return { state: { ...s, hot: false }, effects: [cancel('dwell'), ...(rearm ? [start('unfold')] : [])] };
    }
    // The sober island has no list to drop down. The dwell still marks the edge so an ask waits out the brush.
    case 'dwellElapsed': return same(s);
    case 'surfaceEnter': {
      const next = { ...s, hovering: true };
      return { state: next, effects: [cancel('leave'), ...holdEffects(s, next)] };
    }
    case 'surfaceLeave': {
      const next = { ...s, hovering: false };
      return { state: next, effects: holdEffects(s, next) };
    }
    case 'focusWithin': {
      const next = { ...s, focusWithin: e.on };
      return { state: next, effects: holdEffects(s, next) };
    }
    case 'editing': return same({ ...s, editing: e.on });
    case 'visibility': {
      const next = { ...s, hidden: e.hidden };
      return { state: next, effects: holdEffects(s, next) };
    }
    case 'leaveElapsed': return same(s);
    case 'botClick': {
      if (s.queue.includes(e.id)) return showBubble({ ...s, deferred: dropDeferred(s, e.id) }, e.id);
      return {
        state: { ...s, mode: 'peek', selectedId: e.id, helperId: null, bubbleId: null, bubbleKind: 'ask', hot: false, ack: null, failed: null, unfoldDue: false, openedBy: 'mouse' },
        effects: cancelAll
      };
    }
    case 'rowClick': return same(s);
    case 'homeClick': return s.mode === 'chat' ? same(s) : openChat(s);
    case 'bubbleClick':
      if (s.bubbleId === LEDGE_ID) return openChat(s);
      return same(s);
    case 'bubbleElapsed': {
      if (s.mode !== 'bubble' || s.ack || s.bubbleKind === 'ask') return same(s);
      if (s.done.length > 1) return showBubble({ ...s, done: s.done.slice(1) }, s.done[1]!, [], noticeKind(s, s.done[1]!));
      return { state: toHandle(s), effects: [] };
    }
    case 'decidedInBubble':
      if (s.mode !== 'bubble' || !s.bubbleId || s.ack || s.bubbleKind !== 'ask') return same(s);
      return { state: { ...s, ack: { id: s.bubbleId, minElapsed: false, confirmed: false } }, effects: [cancel('bubble'), start('hold')] };
    case 'holdElapsed': {
      if (s.mode !== 'bubble' || !s.ack) return same(s);
      const next = { ...s, ack: { ...s.ack, minElapsed: true } };
      return next.ack.confirmed ? advance(next) : same(next);
    }
    /* A terminal error for the acknowledged decision: unlock the actions (never a success). An ask has no clock to restart. */
    case 'decisionFailed': {
      if (s.mode !== 'bubble' || s.bubbleId !== e.id || s.bubbleKind !== 'ask') return same(s);
      if (s.ack?.id !== e.id) return s.failed === e.id ? same(s) : same({ ...s, failed: e.id });
      return { state: { ...s, ack: null, failed: e.id }, effects: [cancel('hold')] };
    }
    case 'defer': {
      if (s.mode !== 'bubble' || s.bubbleKind !== 'ask' || !s.bubbleId || s.ack) return same(s);
      const id = s.bubbleId;
      const deferred = s.deferred.includes(id) ? s.deferred : [...s.deferred, id];
      const next = nextAsk({ ...s, deferred }, id);
      if (next) return showBubble({ ...s, deferred }, next, [cancel('hold')]);
      return advance({ ...s, deferred });
    }
    /* These views left the island. The events stay so an old caller changes nothing. */
    case 'settings': case 'help': case 'launch': case 'newSession':
    case 'documentOpen': case 'documentExpanded': case 'openHelper':
      return same(s);
    case 'chat': return s.mode === 'chat' ? same(s) : openChat(s);
    case 'back':
      return s.mode === 'peek' || s.mode === 'chat' ? { state: toHandle(s), effects: cancelAll } : same(s);
    case 'close': return { state: toHandle(s), effects: cancelAll };
    /* A press outside the window folds an open panel; the handle and a bubble are left alone. */
    case 'outsideClick': return s.mode === 'handle' || s.mode === 'bubble' ? same(s) : { state: toHandle(s), effects: cancelAll };
    /* Ctrl+Alt+L: the first ask that was not set aside, else the chat. From the chat, fold. */
    case 'shortcut': {
      if (s.mode === 'chat') return { state: toHandle(s), effects: cancelAll };
      const next = nextAsk(s) ?? s.queue[0];
      const showing = !!next && s.mode === 'bubble' && s.bubbleKind === 'ask' && s.bubbleId === next;
      if (next && !showing) return showBubble({ ...s, deferred: dropDeferred(s, next), openedBy: 'keyboard' }, next);
      return openChat({ ...s, openedBy: 'keyboard' });
    }
    case 'typing': return same({ ...s, typing: e.on });
    case 'reading': return same({ ...s, reading: e.on });
    /* DND on: the bubble folds. The queue stays, and nothing unfolds until the user asks. Off does not re-bubble. */
    case 'dnd': {
      if (!e.on) return same({ ...s, quiet: false });
      const quiet = { ...s, quiet: true, unfoldDue: false };
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
