import { changeOf, splitId, type MachineState, type SessionChange } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import type { Cue } from '@ledge/ui/sounds/cues';
import type { Messages } from '../i18n/messages';
import type { FinishedNotify } from './prefs';

/** The island's cue for each change (apps/overlay/src/sounds/useSounds.ts). */
export function cueOf(c: SessionChange): Cue {
  switch (c.kind) {
    case 'asked': return c.ask === 'approval' ? 'approval' : 'question';
    case 'finished': return 'finished';
    case 'failed': return 'error';
    case 'joined': return 'join';
    case 'left': return 'leave';
  }
}

const STRENGTH: readonly Cue[] = ['approval', 'question', 'error', 'finished', 'join', 'leave'];
/** One cue per update: the one that matters most (a burst plays once, spec §7 ter of the island). */
export function strongestCue(changes: readonly SessionChange[]): Cue | null {
  const cues = changes.map(cueOf);
  return STRENGTH.find(c => cues.includes(c)) ?? null;
}

/** What the alerts knew at the previous update: each session as it was, and the machines that had delivered theirs. */
export interface AlertBase { sessions: ReadonlyMap<string, Session>; machines: ReadonlySet<string> }
export const baselineOf = (sessions: readonly Session[], machines: readonly string[]): AlertBase => ({ sessions: new Map(sessions.map(s => [s.id, s])), machines: new Set(machines) });
/** Open and with its sessions delivered: only then is a change on that machine news. */
export const settledMachines = (machines: readonly MachineState[]): string[] => machines.filter(m => m.status === 'open' && m.ready).map(m => m.id);

/** The changes since the previous update that may alert (spec §10). A machine that was not settled then (start-up,
 *  first connection, return from offline) brings a baseline, not news; a frozen (offline) session changes nothing. */
export function diffSessions(base: AlertBase, now: readonly Session[]): SessionChange[] {
  const out: SessionChange[] = [];
  for (const s of now) {
    if (s.offline) continue;
    const m = splitId(s.id)?.machine;
    if (!m || !base.machines.has(m)) continue;
    const c = changeOf(base.sessions.get(s.id), s);
    if (c) out.push(c);
  }
  return out;
}

export type ToastKind = 'approval' | 'question' | 'finished' | 'failed';
/** An ask always toasts (it blocks the agent); a finish or a failure only when the finish alert is visual. */
export function toastKind(c: SessionChange, mode: FinishedNotify): ToastKind | null {
  if (c.kind === 'asked') return c.ask;
  if (c.kind === 'finished' || c.kind === 'failed') return mode === 'both' || mode === 'bubble' ? c.kind : null;
  return null;
}

export interface Toast { title: string; body: string }
const clip = (text: string) => (text.length > 120 ? `${text.slice(0, 119)}…` : text);
/** One toast per update: the session's own when alone, a grouped one for a burst. */
export function toastFor(changes: readonly SessionChange[], sessions: readonly Session[], mode: FinishedNotify, copy: Messages['notify']): Toast | null {
  const items = changes.flatMap(c => { const kind = toastKind(c, mode); return kind ? [{ id: c.id, kind }] : []; });
  if (items.length === 0) return null;
  if (items.length > 1) return { title: copy.manyTitle, body: copy.many(items.length) };
  const { id, kind } = items[0]!;
  const s = sessions.find(x => x.id === id);
  const name = s?.name ?? id;
  const body = (kind === 'approval' || kind === 'question') && s?.pending?.text ? clip(s.pending.text) : (s?.project ?? '');
  return { title: copy[kind](name), body };
}
