/**
 * The closed notch's activity line (mockup docs/mockups/ledge-notch-activity.html, validated 2026-11-02): which activity
 * holds the one line, when the notch wakes for it and when it sleeps again. Pure: time comes in with every event, the
 * hook (useNotchLine) schedules a `tick` at `nextDeadline`.
 *
 *   Priority   message 3 > notification 2 > track 1.5 > tool = thinking 1 (the contract's `outranks`, plus the track).
 *   Hold       a message keeps the line at least 3 s, a notification 2 s, a track 1.2 s. Meanwhile a lower one is
 *              ignored, except a notification under a message and an action under a track: those wait for the hold to
 *              end (a notification is dropped once it is 5 s old).
 *   Wake       a message, a notification or a new track always wake the notch for 5 s; an action or a thinking only
 *              when it has slept at least 20 s. Awake, the line changes without prolonging the 5 s.
 *   Hover      holds the notch awake; leaving restarts the 5 s.
 *   DND        nothing wakes it but a permission or a question; the line still follows (seen on hover).
 */
import type { NotchActivity } from '@ledge/protocol';

/** A new track on the PC: front-only, between a notification and an action. */
export interface TrackLine { kind: 'track'; title: string; artist: string }
export type NotchLine = NotchActivity | TrackLine;
export type LineKind = NotchLine['kind'];

export const WAKE_MS = 5000;
/** An action or a thinking wakes the notch only once it has slept this long. */
export const QUIET_WAKE_MS = 20_000;
/** A notification waiting behind a message is dropped once it is this old. */
const WAIT_MAX_MS = 5000;
export const RANK: Record<LineKind, number> = { message: 3, notification: 2, track: 1.5, tool: 1, thinking: 1 };
export const HOLD_MS: Record<LineKind, number> = { message: 3000, notification: 2000, track: 1200, tool: 0, thinking: 0 };

export interface Shown { line: NotchLine; seenAt: number }
export interface LineState {
  /** The line shown awake, and the last one seen (greyed with its age on hover once asleep). */
  current: Shown | null;
  holdUntil: number;
  /** A notification behind a message, or an action behind a track. */
  waiting: Shown | null;
  /** Null: asleep. */
  awakeUntil: number | null;
  asleepSince: number;
  hovering: boolean;
  /** Bumped every time a track takes the line: the cover's bounce. */
  trackKey: number;
}

export const initialLine = (now: number): LineState => ({ current: null, holdUntil: 0, waiting: null, awakeUntil: null, asleepSince: now, hovering: false, trackKey: 0 });

const isAwake = (s: LineState) => s.awakeUntil !== null;

/** Whether `line` wakes the notch from `s` (asleep or not: awake, only the wakers restart the 5 s). */
function wakes(s: LineState, line: NotchLine, now: number, dnd: boolean): boolean {
  if (dnd) return line.kind === 'notification' && (line.reason === 'permission' || line.reason === 'question');
  if (line.kind === 'tool' || line.kind === 'thinking') return !isAwake(s) && now - s.asleepSince >= QUIET_WAKE_MS;
  return true;
}

function show(s: LineState, item: Shown, now: number, wake: boolean): LineState {
  const kind = item.line.kind;
  const waiting = s.waiting && RANK[s.waiting.line.kind] < RANK[kind] ? s.waiting : null;
  return {
    ...s, current: item, holdUntil: now + HOLD_MS[kind], waiting,
    awakeUntil: wake ? now + WAKE_MS : s.awakeUntil,
    trackKey: kind === 'track' ? s.trackKey + 1 : s.trackKey
  };
}

export function pushLine(s: LineState, line: NotchLine, now: number, dnd = false): LineState {
  const item = { line, seenAt: now };
  const cur = s.current?.line;
  if (isAwake(s) && cur && now < s.holdUntil && RANK[line.kind] < RANK[cur.kind]) {
    const waits = (cur.kind === 'message' && line.kind === 'notification') || (cur.kind === 'track' && (line.kind === 'tool' || line.kind === 'thinking'));
    return waits ? { ...s, waiting: item } : s;
  }
  return show(s, item, now, wakes(s, line, now, dnd));
}

export function tickLine(s: LineState, now: number, dnd = false): LineState {
  let next = s;
  if (next.waiting && now >= next.holdUntil) {
    const w = next.waiting;
    next = { ...next, waiting: null };
    if (isAwake(next) && (w.line.kind !== 'notification' || now - w.seenAt < WAIT_MAX_MS)) next = show(next, { ...w, seenAt: now }, now, wakes(next, w.line, now, dnd));
  }
  if (next.awakeUntil !== null && !next.hovering && now >= next.awakeUntil) next = { ...next, awakeUntil: null, asleepSince: now, waiting: null };
  return next;
}

export function hoverLine(s: LineState, on: boolean, now: number): LineState {
  if (s.hovering === on) return s;
  return { ...s, hovering: on, awakeUntil: !on && s.awakeUntil !== null ? now + WAKE_MS : s.awakeUntil };
}

/** When the hook must call `tickLine` next (null: nothing pending). */
export function nextDeadline(s: LineState): number | null {
  const times = [s.waiting ? s.holdUntil : null, s.awakeUntil !== null && !s.hovering ? s.awakeUntil : null].filter((t): t is number => t !== null);
  return times.length ? Math.min(...times) : null;
}

/** What the notch shows: `awake` when an activity keeps it awake; otherwise the last line is only seen on hover, aged. */
export function lineView(s: LineState): { awake: boolean; line: NotchLine | null; seenAt: number | null; aged: boolean } {
  const awake = isAwake(s);
  return { awake, line: s.current?.line ?? null, seenAt: s.current?.seenAt ?? null, aged: !awake };
}
