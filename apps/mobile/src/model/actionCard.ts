import { actionById, type ChatAction, type PhoneChatAction } from '@ledge/protocol';
import { actionRowOf, type ActionRowState, type ActionRowView } from '@ledge/ui/chat/actionRow';

// The generic card (#94, docs/mockups/ledge-action-card.html, view « Téléphone »): what the phone draws of a turn's
// `actions`, without the DOM.

/** Whether applying the row asks for the device's check (`act`): the registry gives it one, or it cannot be undone. */
export const actionChecked = (a: PhoneChatAction): boolean => a.risk === 'destructive' || !!actionById(a.action)?.phone;

/** A row as the PC's card reads it: the phone's carries no `args`, which only the daemon applies. */
export const phoneRowOf = (a: PhoneChatAction): ActionRowView => actionRowOf({ ...a, args: {} } as ChatAction);

/** A row as drawn: `held` a proposed step after the one the plan stopped at. */
export type Shown = ActionRowState | 'held';

/**
 * The rows' states and what is left to apply: past a step that failed or was refused, the proposed steps are held;
 * `open` are the rows still to apply, `stopAt` the step the plan stopped at (-1: none).
 */
export function cardState(rows: readonly ActionRowView[]): { shown: Shown[]; open: number[]; stopAt: number } {
  const states = rows.map(r => r.state ?? 'proposed');
  const stopAt = states.findIndex(s => s === 'failed' || s === 'refused' || s === 'stale');
  const shown: Shown[] = states.map((s, i) => (s === 'proposed' && stopAt >= 0 && i > stopAt ? 'held' : s));
  const open = shown.flatMap((s, i) => (['done', 'running', 'denied', 'stale', 'cut'].includes(s) ? [] : [i]));
  return { shown, open, stopAt };
}

/** The rows « Tout appliquer » sends: from the failed step again, or past a refused one (it would only be refused again). */
export function allRows(rows: readonly ActionRowView[]): { rows: number[]; from: 'start' | 'resume' | 'skip' } {
  const { open, stopAt, shown } = cardState(rows);
  if (stopAt < 0) return { rows: open, from: 'start' };
  return shown[stopAt] === 'failed' ? { rows: open, from: 'resume' } : { rows: open.filter(i => i !== stopAt), from: 'skip' };
}
