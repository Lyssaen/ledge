import { log } from '../log.js';
import { DEBOUNCE_MS, MAX_WAKES_PER_HOUR, MIN_WAKE_GAP_MS } from './constants.js';
import type { Journal, JournalEvent } from './journal.js';
import { isWaiting } from './point.js';

export interface WakeDeps {
  journal: Journal; now: () => number; setTimer: (f: () => void, ms: number) => () => void;
  chatIdle: () => Promise<void>; run: (events: JournalEvent[]) => Promise<void>;
}

const HOUR_MS = 3_600_000;

/**
 * When the operator wakes (spec §2): a grouped event arms a wake `DEBOUNCE_MS` later, an immediate one at once; a wake keeps
 * `MIN_WAKE_GAP_MS` from the previous one and the hourly cap, waits for the chat to be idle, and covers every event recorded since
 * the last wake. One wake at a time: what comes during a run arms the next one.
 */
export function createWakes(d: WakeDeps): { onEvent(e: JournalEvent): void; start(): void; stop(): void } {
  const iso = (ms: number) => new Date(ms).toISOString();
  /** The last event a wake covered: the next one starts after it. */
  let floor = 0;
  let cancel: (() => void) | null = null;
  let armedAt = Infinity;
  let running = false;
  /** Set by the events that come during a run: when the next wake is due (an immediate one now, a grouped one `DEBOUNCE_MS` after
   *  itself); the run arms it when it ends. */
  let dueAfter: number | null = null;
  const due = (at: number) => { dueAfter = dueAfter === null ? at : Math.min(dueAfter, at); };
  let lastStart = -Infinity;
  let stopped = false;
  /** Set at start when requests still wait: the first wake covers them even with nothing new. */
  let coverOpen = false;

  function arm(delay: number): void {
    if (stopped) return;
    const at = Math.max(d.now() + delay, lastStart + MIN_WAKE_GAP_MS);
    if (cancel && armedAt <= at) return;
    cancel?.();
    armedAt = at;
    cancel = d.setTimer(() => { cancel = null; armedAt = Infinity; void fire(); }, Math.max(0, at - d.now()));
  }

  async function fire(): Promise<void> {
    if (stopped) return;
    if (running) { due(d.now()); return; }
    // Past the hourly cap the wake waits: it looks again each gap, and the events wait with it (one point covers them then).
    if (d.journal.wakesSince(iso(d.now() - HOUR_MS)) >= MAX_WAKES_PER_HOUR) { arm(MIN_WAKE_GAP_MS); return; }
    running = true;
    try {
      await d.chatIdle();
      if (stopped) return;
      const fresh = d.journal.since(floor);
      const events = fresh.length > 0 ? fresh : coverOpen ? d.journal.open().filter(isWaiting) : [];
      coverOpen = false;
      if (events.length === 0) return;
      floor = Math.max(floor, ...events.map(e => e.id));
      lastStart = d.now();
      await d.run(events);
    } catch (e) {
      log(`operator wake failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
      const next = dueAfter; dueAfter = null;
      if (next !== null) arm(Math.max(0, next - d.now()));
    }
  }

  return {
    onEvent(e) {
      if (e.urgency === 'none') return;
      if (running) { due(d.now() + (e.urgency === 'immediate' ? 0 : DEBOUNCE_MS)); return; }
      arm(e.urgency === 'immediate' ? 0 : DEBOUNCE_MS);
    },
    start() {
      stopped = false;
      const before = d.journal.lastWake();
      // The gap counts from the last wake the journal holds, the one before a restart included.
      if (before) lastStart = Date.parse(before.startedAt);
      const recovered = d.journal.recover(iso(d.now()));
      // A wake the daemon left unfinished is covered again; otherwise the next wake starts after the last one.
      floor = recovered.length > 0 ? Math.min(...recovered.map(w => w.firstEvent)) - 1 : before?.lastEvent ?? 0;
      if (recovered.length > 0) log(`operator: ${recovered.length} unfinished wake(s) marked failed, their events covered again`);
      coverOpen = d.journal.open().some(isWaiting);
      if (coverOpen || d.journal.since(floor, 1).length > 0) arm(0);
    },
    stop() { stopped = true; cancel?.(); cancel = null; armedAt = Infinity; }
  };
}
