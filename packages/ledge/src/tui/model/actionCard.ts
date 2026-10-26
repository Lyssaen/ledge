import type { ChatAction } from '@ledge/protocol';
import { actionRowOf, type ActionRowState, type ActionRowView } from '@ledge/ui/chat/actionRow';
import type { ActionCopy } from '@ledge/ui/chat/copy';

// The generic card of an answer (#94, docs/mockups/ledge-action-card.html, view TUI), as the Ask screen draws and acts on it.
// The rows are the Desktop's (actionRowOf), their words the shared ones (actionCopy, actionWords).

/** A row's state as drawn: `held` is a proposed row after the step the plan stopped at. */
export type Shown = ActionRowState | 'held';
/** What « a » applies: every open row, from the failed step again (`resume`), or past a refused one (`skip`), `k` that step. */
export type All = { kind: 'all' | 'resume' | 'skip'; rows: number[]; k: number };
/** `cutLines`: the lines a request shown cut quotes, fewer on a short screen. */
export interface CardPlan { rows: ActionRowView[]; shown: Shown[]; open: number[]; stopAt: number; all: All; cutLines: number }

/** Applied, or its request denied: nothing is left to do on the row. */
export const settled = (s: Shown) => s === 'done' || s === 'denied';

/** The first lines of a request shown cut: the rest is read in the session (o). */
export const CUT_LINES = 6;
/** The lines the card has on screen, and a request's height there at a row's indent. */
export interface Room { lines: number; height(text: string, indent: number): number }
/** The card's lines besides its requests: its borders, its keys and what a confirmation adds. */
const CHROME = 5;

/** The card's rows, their states, those a click may still apply, and what « a » applies, as the Desktop's card reads them. In
 *  `room`, an acceptance whose request the screen cannot show whole is cut as the daemon cuts one: not accepted from the card. */
export function cardPlan(actions: readonly ChatAction[], room?: Room): CardPlan {
  const rows = actions.map(actionRowOf);
  let left = room ? room.lines - CHROME - 2 * rows.length : Infinity;
  // Its mark and its note (two lines) follow the quote.
  const cutLines = Math.max(1, Math.min(CUT_LINES, left - 3));
  const states = rows.map((r): ActionRowState => {
    const s = r.state ?? 'proposed';
    if (!room) return s;
    const indent = rows.length > 1 ? 6 : 2;
    // A detail shows on the row chosen and in a confirmation: counted as if shown.
    const detail = r.detail ? room.height(r.detail, indent) : 0;
    if (!r.request) { left -= detail; return s; }
    const need = room.height(r.request.text, indent) + detail;
    // A failed acceptance is accepted again with « Réessayer »: cut as a proposed one.
    if ((s === 'proposed' || s === 'failed') && r.decision !== 'deny' && need > left) { left -= cutLines + 3 + detail; return 'cut'; }
    left -= need;
    return s;
  });
  // A request that changed was refused too: the daemon stopped there. A failed step cut stays the step it stopped at.
  const raw = rows.map(r => r.state ?? 'proposed');
  const stopAt = raw.findIndex(s => s === 'failed' || s === 'refused' || s === 'stale');
  const shown: Shown[] = states.map((s, i) => (s === 'proposed' && stopAt >= 0 && i > stopAt ? 'held' : s));
  const open = shown.flatMap((s, i) => (['done', 'running', 'denied', 'stale', 'cut'].includes(s) ? [] : [i]));
  // A refused step's target is gone: it would only be refused again, so « a » goes on without it.
  const skip = stopAt >= 0 && raw[stopAt] !== 'failed';
  // A failed step cut is read in the session first: « a » does not go past it.
  const rowsAll = skip ? open.filter(i => i !== stopAt) : stopAt >= 0 && states[stopAt] === 'cut' ? [] : open;
  const all: All = { kind: stopAt < 0 ? 'all' : skip ? 'skip' : 'resume', rows: rowsAll, k: stopAt + 1 };
  return { rows, shown, open, stopAt, all, cutLines };
}

/** Every row applied or denied: the box goes, a line stays in the conversation. */
export const cardClosed = (actions: readonly ChatAction[]): boolean => cardPlan(actions).shown.every(settled);

/** The row the selection starts on: the first to act on (proposed, held, failed), else the first not settled. */
export function firstRow(p: CardPlan): number {
  const act = p.shown.findIndex(s => s === 'proposed' || s === 'held' || s === 'failed');
  return act >= 0 ? act : Math.max(0, p.shown.findIndex(s => !settled(s)));
}
/** The row chosen with ↑ ↓, while it is still there and not settled; else the row the selection starts on. */
export const selectedRow = (p: CardPlan, chosen: number | undefined): number =>
  (chosen !== undefined && p.shown[chosen] !== undefined && !settled(p.shown[chosen]!) ? chosen : firstRow(p));
/** ↑ ↓ : the next row not settled that way, or the same at an end. */
export function moveRow(p: CardPlan, from: number, by: 1 | -1): number {
  for (let i = from + by; i >= 0 && i < p.shown.length; i += by) if (!settled(p.shown[i]!)) return i;
  return from;
}

const plain = (s: string) => s.replace(/\*\*/g, '');
/** A row's line in the front's words, the daemon's summary when a word is missing; no bold in a terminal line. */
export const lineOf = (r: ActionRowView, c: ActionCopy): string =>
  plain((r.vars && r.action !== undefined ? c.words.line[r.action]?.(r.vars) : undefined) ?? r.summary);
/** Why a row was refused or failed, in the front's words. */
export const whyOf = (r: ActionRowView, c: ActionCopy): string =>
  plain(c.words.why(r.code ?? (r.state === 'failed' ? 'failed' : undefined), r.action, r.vars ?? {}));
/** The button of a row: its action's verb, « Refuser » for a denial, « Appliquer » for an action the front does not know. */
export const verbOf = (r: ActionRowView, c: ActionCopy): string =>
  (r.decision === 'deny' ? c.deny : (r.action !== undefined ? c.verbs[r.action] : undefined) ?? c.apply);
