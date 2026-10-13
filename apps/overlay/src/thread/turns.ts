import type { Helper, Session, ThreadItem, HelperItem } from '@ledge/protocol';
import { liveHelpers } from '../bots/poseFor';

type Prompt = Extract<ThreadItem, { kind: 'prompt' }>;
type Reply = Extract<ThreadItem, { kind: 'reply' }>;
export type Turn = { n: number; prompt?: Prompt; reply?: Reply; items: ThreadItem[] };
export type HelperRow = { id: string; kind: string; task: string; state: Helper['state'] };

const byTime = (a: ThreadItem, b: ThreadItem) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

/** The daemon keeps both the agent's last message (from the transcript) and the reply that repeats it: the reply is
 *  shown, its echo is not. Only the last message, and only when its text is the reply's. */
function withoutEcho(items: ThreadItem[], reply?: Reply): ThreadItem[] {
  if (!reply) return items;
  let last = -1;
  items.forEach((it, i) => { if (it.kind === 'message') last = i; });
  const echo = items[last];
  return echo?.kind === 'message' && echo.text.trim() === reply.text.trim() ? items.filter((_, i) => i !== last) : items;
}

/** The main thread by turn (spec 2026-10-13 §6). Items are sorted by time: a synced message lands after the row it announced. */
export function turns(items: ThreadItem[]): Turn[] {
  const map = new Map<number, Turn>();
  for (const it of items) {
    if (it.helperId) continue;
    const t = map.get(it.turn) ?? { n: it.turn, items: [] };
    t.items.push(it);
    if (it.kind === 'prompt') t.prompt = it;
    if (it.kind === 'reply') t.reply = it;
    map.set(it.turn, t);
  }
  return [...map.values()].sort((a, b) => a.n - b.n).map(t => ({ ...t, items: withoutEcho([...t.items].sort(byTime), t.reply) }));
}

/** A helper's own thread: its row, what it said and did (sorted by time), its report. */
export function helperThread(items: ThreadItem[], helperId: string): { helper?: HelperItem; items: ThreadItem[]; report?: Reply } {
  const helper = items.find((i): i is HelperItem => i.kind === 'helper' && i.id === helperId);
  const own = items.filter(i => i.helperId === helperId);
  const report = own.find((i): i is Reply => i.kind === 'reply');
  return { ...(helper ? { helper } : {}), items: withoutEcho(own.filter(i => i.kind !== 'reply').sort(byTime), report), ...(report ? { report } : {}) };
}

/** The rows under the title: the current turn's helpers, finished ones kept (their thread stays readable); live state
 *  from the session when it has it. Without a thread, today's live helpers. */
export function helperRows(session: Session, items?: ThreadItem[]): HelperRow[] {
  if (!items) return liveHelpers(session).map(h => ({ id: h.id, kind: h.kind, task: h.task, state: h.state }));
  const last = turns(items).at(-1);
  if (!last) return [];
  return last.items.filter((i): i is HelperItem => i.kind === 'helper').map(h => {
    const live = session.helpers.find(x => x.id === h.id);
    return { id: h.id, kind: h.agentType ?? live?.kind ?? '', task: h.task || live?.task || '', state: live?.state ?? h.state };
  });
}
