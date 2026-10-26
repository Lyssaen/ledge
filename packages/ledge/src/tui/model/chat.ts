import { proposalRows, type ChatStep, type ChatTurn } from '@ledge/protocol';
import type { Glyphs } from '../glyphs.js';
import type { Messages } from '../i18n/lang.js';
import { C } from '../theme.js';
import { wrap, type Line } from './thread.js';
import { clock } from './time.js';

/** What a step says Ledge read: « les sessions », « le terminal d'Otto »… */
export function stepLabel(s: ChatStep, t: Messages['ask']['steps']): string {
  const name = s.name ?? s.id ?? '';
  return s.kind === 'sessions' ? t.sessions : s.kind === 'repo' ? t.repo(s.path ?? '') : t[s.kind](name);
}

/** The conversation as lines: each question, what Ledge read, its answer (the streamed text while it writes), or why it stopped. */
export function chatLines(turns: readonly ChatTurn[], live: { qid: string; text: string } | null, o: { t: Messages; g: Glyphs; width: number }): Line[] {
  const { t, g, width } = o;
  const out: Line[] = [];
  for (const turn of turns) {
    if (out.length) out.push([{ text: '' }]);
    for (const l of wrap(turn.question, width - 2)) out.push([{ text: `${g.cursor} `, color: C.coral }, { text: l, color: C.fg, bold: true }]);
    out.push([{ text: `  ${t.ask.you} · ${clock(turn.askedAt)}`, color: C.faint }]);
    const steps = [...new Set(turn.steps.map(s => stepLabel(s, t.ask.steps)))];
    if (steps.length) out.push([{ text: `  ${t.ask.read} : ${steps.join(' · ')}`, color: C.faint }]);
    const text = turn.answer ?? (live?.qid === turn.qid ? live.text : undefined);
    if (turn.error) out.push([{ text: `  ${turn.error}`, color: C.red }]);
    else if (text) { out.push([{ text: '' }]); for (const l of wrap(text, width - 2)) out.push([{ text: '  ' }, { text: l, color: C.fg }]); }
    else out.push([{ text: `  ${t.ask.reading}`, color: C.faint }]);
    // The team and task cards keep their outcome in the conversation once acted on (roles spec §3.8).
    if (turn.team?.teamId && turn.team.launchedAt) out.push([{ text: `  ${g.team} ${turn.team.name} · ${t.ask.teamLaunched(clock(turn.team.launchedAt))}`, color: C.green }]);
    for (const c of turn.tasks ?? []) if (c.taskId) out.push([{ text: `  ${c.title} · ${t.ask.given(c.ownerName ?? c.toName ?? c.to, c.taskId, t.ask.taskState[c.state ?? 'open'])}`, color: C.green }]);
  }
  return out;
}

/** A card the answer carries, to act on with ↵. */
export type Card =
  | { kind: 'team'; qid: string }
  | { kind: 'task'; qid: string; rows: number[] }
  | { kind: 'launch'; qid: string; rows: number[] }
  | { kind: 'relay'; qid: string }
  | { kind: 'close'; qid: string; rows: number[] };

/** The cards of the answered turns still to act on, the newest turn first: sessions to start (not started yet), an
 *  instruction to relay (not sent yet; a queued one can be taken back), sessions to close (not closed yet). */
export function openCards(turns: readonly ChatTurn[]): Card[] {
  const out: Card[] = [];
  for (const turn of [...turns].reverse()) {
    if (!turn.answeredAt) continue;
    if (turn.team && !turn.team.teamId) out.push({ kind: 'team', qid: turn.qid });
    const tasks = (turn.tasks ?? []).map((c, i) => (c.taskId ? -1 : i)).filter(i => i >= 0);
    if (tasks.length) out.push({ kind: 'task', qid: turn.qid, rows: tasks });
    const launch = proposalRows(turn).map((p, i) => (p.launchedId ? -1 : i)).filter(i => i >= 0);
    if (launch.length) out.push({ kind: 'launch', qid: turn.qid, rows: launch });
    if (turn.relay && turn.relay.status !== 'sent') out.push({ kind: 'relay', qid: turn.qid });
    const close = (turn.closes ?? []).map((c, i) => (c.closedAt ? -1 : i)).filter(i => i >= 0);
    if (close.length) out.push({ kind: 'close', qid: turn.qid, rows: close });
  }
  return out;
}
