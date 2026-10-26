import { proposalRows, type ChatStep, type ChatTurn } from '@ledge/protocol';
import type { Glyphs } from '../glyphs.js';
import type { Messages } from '../i18n/lang.js';
import { C } from '../theme.js';
import { pad, row, wrapSegs, type Line } from './cells.js';
import { markdownLines } from './markdown.js';
import { cardClosed, cardPlan, lineOf } from './actionCard.js';
import { clock } from './time.js';

/** What a step says Ledge read: « les sessions », « le terminal d'Otto »… */
export function stepLabel(s: ChatStep, t: Messages['ask']['steps']): string {
  const name = s.name ?? s.id ?? '';
  return s.kind === 'sessions' ? t.sessions : s.kind === 'repo' ? t.repo(s.path ?? '') : t[s.kind](name);
}

export type ChatView = { lines: Line[]; keys: string[]; turns: Map<string, string> };

/** The conversation as lines, each with its turn's qid (what a scroll stays on): each question, when and what Ledge read,
 *  its answer in Markdown (the streamed text while it writes, ending with a caret), or why it stopped. */
export function chatView(turns: readonly ChatTurn[], live: { qid: string; text: string } | null, o: { t: Messages; g: Glyphs; width: number }): ChatView {
  const { t, g, width } = o;
  const lines: Line[] = [], keys: string[] = [];
  for (const turn of turns) {
    const out: Line[] = [];
    if (lines.length) out.push([{ text: '' }]);
    wrapSegs([{ text: turn.question, color: C.fg, bold: true }], width - 2).forEach((l, k) => out.push([k ? pad(2) : { text: `${g.cursor} `, color: C.coral }, ...l]));
    const steps = [...new Set(turn.steps.map(s => stepLabel(s, t.ask.steps)))];
    out.push(...row([pad(2)], [{ text: [`${t.ask.you} · ${clock(turn.askedAt)}`, ...(steps.length ? [`${t.ask.read} : ${steps.join(' · ')}`] : [])].join(' · '), color: C.faint }], null, width));
    const streaming = !turn.answer && live?.qid === turn.qid ? live.text : undefined;
    const text = turn.answer ?? streaming;
    if (turn.error) out.push([{ text: `  ${turn.error}`, color: C.red }]);
    else if (text) {
      out.push([{ text: '' }], ...markdownLines(text, { width: width - 2, g, color: C.fg }).map(l => [pad(2), ...l]));
      if (streaming !== undefined) out.push([pad(2), { text: g.caret, color: C.coral }]);
    } else out.push([{ text: `  ${t.ask.reading}`, color: C.faint }]);
    // The team and task cards keep their outcome in the conversation once acted on (roles spec §3.8).
    if (turn.team?.teamId && turn.team.launchedAt) out.push([{ text: `  ${g.team} ${turn.team.name} · ${t.ask.teamLaunched(clock(turn.team.launchedAt))}`, color: C.green }]);
    for (const c of turn.tasks ?? []) if (c.taskId) out.push([{ text: `  ${c.title} · ${t.ask.given(c.ownerName ?? c.toName ?? c.to, c.taskId, t.ask.taskState[c.state ?? 'open'])}`, color: C.green }]);
    out.push(...actionTrace(turn, t, g, width));
    for (const l of out) { lines.push(l); keys.push(turn.qid); }
  }
  return { lines, keys, turns: new Map() };
}

export const chatLines = (turns: readonly ChatTurn[], live: { qid: string; text: string } | null, o: { t: Messages; g: Glyphs; width: number }): Line[] => chatView(turns, live, o).lines;

/** What stays of a turn's generic card in the conversation (#94): set aside, with the key that opens it again; once every
 *  row is applied or denied, the plan or its row, and each denial with the request it answered, faded. */
function actionTrace(turn: ChatTurn, t: Messages, g: Glyphs, width: number): Line[] {
  const a = t.ask.action, c = a.copy;
  const cards = !!(turn.actions || turn.proposal || turn.relay || turn.closes || turn.team || turn.tasks || turn.projectProposal);
  if (turn.ignoredAt) return cards ? [[{ text: `  ${a.ignored(turn.actions?.length ?? 1, clock(turn.ignoredAt))}`, color: C.faint }]] : [];
  if (!turn.actions || !cardClosed(turn.actions)) return [];
  const p = cardPlan(turn.actions), out: Line[] = [];
  const done = p.rows.flatMap((r, i) => (p.shown[i] === 'done' ? [r] : []));
  const last = done.map(r => r.doneAt).filter((x): x is string => !!x).sort().at(-1);
  if (done.length > 1) out.push([{ text: `  ${g.ok} ${c.planDone(last ? clock(last) : '')}`, color: C.green }]);
  else if (done.length === 1) out.push([{ text: `  ${g.ok} ${a.done(lineOf(done[0]!, c), last ? clock(last) : '')}`, color: C.green }]);
  p.rows.forEach((r, i) => {
    if (p.shown[i] !== 'denied') return;
    out.push([{ text: `  ${g.ok} `, color: C.dim }, { text: a.denied(r.target ?? '', r.doneAt ? clock(r.doneAt) : ''), color: C.fg }]);
    const asked = r.request?.text ?? r.detail;
    if (asked) for (const l of asked.split('\n').flatMap(x => wrapSegs([{ text: x, color: C.faint }], width - 4))) out.push([pad(4), ...l]);
  });
  return out;
}

/** What was asked, oldest first by its time, each once (at its last time): the questions of the conversation, and those
 *  asked since the TUI started, in conversations cleared since or never answered. */
export function askHistory(turns: readonly ChatTurn[], sent: readonly Asked[]): string[] {
  const all = [...sent, ...turns].sort((a, b) => a.askedAt.localeCompare(b.askedAt)).map(x => x.question);
  return all.filter((q, i) => all.lastIndexOf(q) === i);
}

/** A question asked from the TUI, at its time. */
export type Asked = Pick<ChatTurn, 'question' | 'askedAt'>;

/** A card the answer carries, to act on with ↵. */
export type Card =
  | { kind: 'team'; qid: string }
  | { kind: 'task'; qid: string; rows: number[] }
  | { kind: 'launch'; qid: string; rows: number[] }
  | { kind: 'relay'; qid: string }
  | { kind: 'close'; qid: string; rows: number[] }
  | { kind: 'action'; qid: string };

/** The cards of the answered turns still to act on, the newest turn first: sessions to start (not started yet), an
 *  instruction to relay (not sent yet; a queued one can be taken back), sessions to close (not closed yet). */
export function openCards(turns: readonly ChatTurn[]): Card[] {
  const out: Card[] = [];
  for (const turn of [...turns].reverse()) {
    // Ignored (on any device): none of its cards is offered until it is opened again (ctrl+r).
    if (!turn.answeredAt || turn.ignoredAt) continue;
    if (turn.actions && !cardClosed(turn.actions)) out.push({ kind: 'action', qid: turn.qid });
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
