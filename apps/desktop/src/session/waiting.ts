import type { HelperItem, ToolItem } from '@ledge/protocol';
import { target } from '@ledge/ui/thread/tools';
import { kindOf, type Exchange, type ToolKind } from './exchanges';

/** What the agent last did, as the thread shows it: the waiting line's first, factual phrase says only that. */
export type WaitCause =
  | { kind: 'prompt'; from: 'you' | 'parent' }
  | { kind: 'received'; from: string }
  | { kind: 'tool'; verb: ToolKind; target: string; failed: boolean }
  | { kind: 'helper'; name: string }
  | { kind: 'decision' }
  | { kind: 'said' };

/** The staircase: the factual phrase first, then the bank's phrases in turn, then « it takes its time » with the clock. */
export type WaitStage = { stage: 'fact'; cause: WaitCause } | { stage: 'bank'; index: number } | { stage: 'long' };

export interface Wait {
  cause: WaitCause;
  /** The last activity of the exchange (ms): the wait counts from there. */
  since: number;
}

/** The fact lasts up to FACT_S, the bank up to LONG_S, a bank phrase BANK_S; the clock shows from CLOCK_S. */
export const FACT_S = 8, LONG_S = 30, BANK_S = 4, CLOCK_S = 5;

const end = (t: ToolItem) => Date.parse(t.at) + (t.durationMs ?? 0);

/** The cause and start of the wait at the end of an exchange: its last segment, else what opened it. `helperName` names a
 *  subagent as its card does; `helperEnd` is when it finished, if known (its report closes it, not its launch). */
export function waitOf(x: Exchange, helperName: (item: HelperItem) => string, helperEnd: (item: HelperItem) => number | undefined): Wait {
  const s = x.segments[x.segments.length - 1];
  const opened = Math.max(Date.parse(x.at), ...[...x.received, ...x.notices].map(r => Date.parse(r.at)));
  if (!s) {
    const r = x.received[x.received.length - 1];
    // Opened by a prompt, a message from another session, else only by the harness's notice: the agent goes on.
    const cause: WaitCause = x.prompt ? { kind: 'prompt', from: x.prompt.from } : r ? { kind: 'received', from: r.peer ?? r.from } : { kind: 'said' };
    return { cause, since: opened };
  }
  if (s.kind === 'tools') {
    const t = s.tools[s.tools.length - 1];
    const since = Math.max(...[...s.tools, ...s.todos].map(end));
    return { cause: t ? { kind: 'tool', verb: kindOf(t.tool), target: target(t), failed: t.status === 'failed' } : { kind: 'said' }, since };
  }
  if (s.kind === 'helper') return { cause: { kind: 'helper', name: helperName(s.item) }, since: helperEnd(s.item) ?? Date.parse(s.item.at) };
  const since = Date.parse(s.item.at);
  return { cause: s.kind === 'decision' || s.kind === 'plan' ? { kind: 'decision' } : { kind: 'said' }, since };
}

/** The stage `secs` into the wait; the bank starts at `seed` (an exchange's own place in it) and goes round in order, so no
 *  phrase comes back before the others have passed. */
export function stageOf(cause: WaitCause, secs: number, seed: number, bank: number): WaitStage {
  if (secs < FACT_S) return { stage: 'fact', cause };
  if (secs < LONG_S) return { stage: 'bank', index: (seed + Math.floor((secs - FACT_S) / BANK_S)) % bank };
  return { stage: 'long' };
}

/** A key's place in a bank of `n` phrases: the same exchange always starts on the same phrase. */
export function seedOf(key: string, n: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % n;
}
