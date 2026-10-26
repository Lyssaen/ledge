import { ACTION_ERROR_CODES, type ActionErrorCode, type ChatAction } from '@ledge/protocol';
import type { ActionVars } from './actionWords';

// A generic card's row as every front draws it (#94): the Desktop and the island (ActionCard.tsx), and the TUI. No DOM here.

export type ActionRisk = ChatAction['risk'];
/** A row as the card draws it. No state: proposed. `refused`: nothing was sent; `failed`: sent, it went wrong; `denied`: a
 *  permission's « Deny » reached the session; `stale`: the request changed since the card, nothing was sent; `cut`: the
 *  request was too long to be quoted whole (`detailCut`), it is not accepted from the card. */
export type ActionRowState = 'proposed' | 'running' | 'done' | 'failed' | 'refused' | 'denied' | 'stale' | 'cut';

/** One action of the card, as the protocol's `ChatAction` gives it (`actionRowOf`): its registry id `action`, whose verb the
 *  front's copy holds (« Apply » for an id it does not know), the daemon's `summary` (names in **bold**, the fallback),
 *  `detail` to read in full before confirming, `target` the session or team by its name, `code` why it was refused or failed,
 *  `decision` a session.decide's (deny: its verb is « Deny »), `vars` its words, for the front's own line and why (the
 *  daemon's `summary` and `error` are French: the summary is the fallback, the error is for the log, never on screen).
 *  A permission adds its `request` quoted verbatim (`kind` its kind, in the front's words when it knows it) and `deny` its
 *  other button. */
export interface ActionRowView {
  action?: string; summary: string; risk: ActionRisk; state?: ActionRowState; detail?: string;
  request?: { kind: string; text: string }; deny?: { summary: string }; target?: string;
  error?: string; code?: ActionErrorCode; doneAt?: string; decision?: 'accept' | 'deny'; vars?: ActionVars;
}

const CODES: ReadonlySet<string> = new Set(ACTION_ERROR_CODES);
/** A row of the protocol, as the card draws it: its target by name (`vars`; its id stays in the ChatAction, for the link), `changed`
 *  as stale, a code the front does not know yet (a newer daemon) as `failed`. */
export function actionRowOf(a: ChatAction): ActionRowView {
  const row: ActionRowView = { action: a.action, summary: a.summary, risk: a.risk };
  if (a.vars !== undefined) row.vars = a.vars;
  // A session.decide's detail is the request itself, quoted under its kind.
  if (a.detail !== undefined && a.action === 'session.decide' && a.vars?.kind) row.request = { kind: a.vars.kind, text: a.detail };
  else if (a.detail !== undefined) row.detail = a.detail;
  // task.cancel names its owner: the session it holds.
  const target = a.vars?.session ?? a.vars?.owner ?? a.vars?.team;
  if (target !== undefined) row.target = target;
  if (a.vars?.decision === 'accept' || a.vars?.decision === 'deny') row.decision = a.vars.decision;
  if (a.state !== undefined) row.state = a.state;
  if (a.doneAt !== undefined) row.doneAt = a.doneAt;
  if (a.error !== undefined) row.error = a.error;
  if (a.code !== undefined) row.code = CODES.has(a.code) ? a.code as ActionErrorCode : 'failed';
  if (a.code === 'changed') row.state = 'stale';
  // Not accepted from the card, since it was not read whole (codes.md): the daemon's `cut` is that state too, never a refusal.
  if ((a.detailCut && !a.state && row.decision !== 'deny') || a.code === 'cut') { row.state = 'cut'; delete row.code; delete row.error; }
  // Never shown (codes.md): the card was set aside, or a destructive row was sent unconfirmed; it is proposed again.
  if (a.code === 'ignored' || a.code === 'confirm_required') { delete row.state; delete row.code; delete row.error; }
  return row;
}
