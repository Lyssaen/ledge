import type { ChatTurn, Session } from '@ledge/protocol';
import { splitId } from '@ledge/fleet';

/** The pseudo-machine of the chat (spec §5, §7): `desktop.selected`, `desktop.drafts` and `desktop.thread` key. Never a session id. */
export const CHAT_ID = 'ledge';

let seq = 0;
/** A question id (1 to 100 characters, `chat.route`). No crypto.randomUUID: some jsdom builds lack it. */
export function newQid(): string {
  return `q-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const isRunning = (t: ChatTurn): boolean => t.answeredAt === undefined && t.error === undefined;
/** The fleet answers one question at a time: at most one turn runs. */
export const runningTurn = (turns: readonly ChatTurn[]): ChatTurn | null => turns.find(isRunning) ?? null;

export interface SessionLink { id: string; name: string; live: boolean }

/** The sessions an answered turn points at (spec §9.3 « liens vers les sessions par id qualifié »): the ones its steps read, its relay
 *  target, the session its card launched; first appearance wins. `live` is false once the session left the fleet's list (the link is
 *  then shown disabled); a stale session of a fallen machine is still listed, so still live. */
export function turnLinks(turn: ChatTurn, sessions: readonly Session[]): SessionLink[] {
  if (turn.answeredAt === undefined) return [];
  const found: { id: string; name?: string }[] = [];
  for (const s of turn.steps) if ((s.kind === 'pane' || s.kind === 'reply' || s.kind === 'git') && s.id) found.push({ id: s.id, name: s.name });
  if (turn.relay) found.push({ id: turn.relay.id, name: turn.relay.name });
  if (turn.proposal?.launchedId) found.push({ id: turn.proposal.launchedId });
  const seen = new Set<string>();
  const out: SessionLink[] = [];
  for (const f of found) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    const listed = sessions.find(s => s.id === f.id);
    out.push({ id: f.id, name: listed?.name ?? f.name ?? splitId(f.id)?.id ?? f.id, live: !!listed });
  }
  return out;
}

/** Names `**Name**` may link in an answer: sessions of the turn's machine whose name is unique there. A name shared by two sessions,
 *  or only found on another machine, stays plain bold: never a link to the wrong session. */
export function mentionable(turn: ChatTurn, sessions: readonly Session[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!turn.machineId) return out;
  const twice = new Set<string>();
  for (const s of sessions) {
    if (s.machineId !== turn.machineId) continue;
    if (out.has(s.name)) twice.add(s.name); else out.set(s.name, s.id);
  }
  for (const n of twice) out.delete(n);
  return out;
}

export type Inline = { kind: 'text'; text: string } | { kind: 'strong'; text: string } | { kind: 'code'; text: string } | { kind: 'session'; id: string; name: string };
const TRAIL = /[\s:,.;!?]+$/;
const MARKS = /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\([^)\s]*\)/g;

/** Inline marks of an answer: bold (a session link when `names` knows it), code, and markdown links kept as their text only
 *  (Desktop opens no URL from Ledge's answer). */
export function inline(text: string, names: ReadonlyMap<string, string>): Inline[] {
  const out: Inline[] = [];
  const push = (i: Inline) => {
    const last = out.at(-1);
    if (i.kind === 'text' && last?.kind === 'text') last.text += i.text; else out.push(i);
  };
  let at = 0;
  for (const m of text.matchAll(MARKS)) {
    if (m.index > at) push({ kind: 'text', text: text.slice(at, m.index) });
    if (m[1] !== undefined) {
      // `**Otto:**` / `**Otto ,**`: the name is looked up without its trailing punctuation, which stays in the text.
      const name = m[1].replace(TRAIL, '');
      const id = names.get(name);
      if (id) { push({ kind: 'session', id, name }); if (name.length < m[1].length) push({ kind: 'text', text: m[1].slice(name.length) }); }
      else push({ kind: 'strong', text: m[1] });
    } else if (m[2] !== undefined) push({ kind: 'code', text: m[2] });
    else push({ kind: 'text', text: m[3]! });
    at = m.index + m[0].length;
  }
  if (at < text.length) push({ kind: 'text', text: text.slice(at) });
  return out;
}

export type AnswerBlock = { kind: 'p'; lines: Inline[][] } | { kind: 'ul'; items: Inline[][] } | { kind: 'h'; text: Inline[] };

/** Simple Markdown, as the island renders it: paragraphs (one line per `<br>`), `-` / `*` lists, `#` to `###` headings. */
export function answerBlocks(text: string, names: ReadonlyMap<string, string>): AnswerBlock[] {
  const out: AnswerBlock[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const endPara = () => { if (para.length) out.push({ kind: 'p', lines: para.map(l => inline(l, names)) }); para = []; };
  const endList = () => { if (list.length) out.push({ kind: 'ul', items: list.map(l => inline(l, names)) }); list = []; };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { endPara(); endList(); continue; }
    const head = /^#{1,3} (.*)$/.exec(line);
    if (head) { endPara(); endList(); out.push({ kind: 'h', text: inline(head[1]!, names) }); continue; }
    const item = /^\s*[-*] (.*)$/.exec(line);
    if (item) { endPara(); list.push(item[1]!); continue; }
    endList();
    para.push(line);
  }
  endPara(); endList();
  return out;
}

/** The card an answered turn carries (the relay first, like the island). */
export function cardKind(turn: ChatTurn): 'launch' | 'relay' | null {
  if (turn.answeredAt === undefined) return null;
  return turn.relay ? 'relay' : turn.proposal ? 'launch' : null;
}

/** What changes when a card action has an outcome (`launchedId`, `error`, relay `status`): compared before and after the click. */
export const cardMark = (turn: ChatTurn): string => JSON.stringify([turn.proposal ?? null, turn.relay ?? null]);
