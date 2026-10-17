import type { FileChange, Helper, HelperItem, Session, ThreadItem, ToolItem } from '@ledge/protocol';
import { helperThread, turns } from '@ledge/ui/thread/turns';
import { elapsedMs, liveTool } from '@ledge/ui/thread/tools';
import type { Lang } from '../i18n/lang';

export type ToolKind = 'read' | 'search' | 'command' | 'edit';
const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch']);
const SEARCH = new Set(['Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch']);
/** edit : Edit, Write, MultiEdit, NotebookEdit, apply_patch ; search : Grep, Glob, LS, WebFetch, WebSearch ; read : Read ; le reste : command. */
export function kindOf(tool: string): ToolKind {
  return EDIT.has(tool) ? 'edit' : SEARCH.has(tool) ? 'search' : tool === 'Read' ? 'read' : 'command';
}

export type Verb = 'create' | 'delete' | ToolKind;
/** Le premier fichier ajouté → create, supprimé → delete ; sinon kindOf. */
export function verbOf(t: ToolItem): Verb {
  const change: FileChange['change'] | undefined = t.files[0]?.change;
  return change === 'add' ? 'create' : change === 'delete' ? 'delete' : kindOf(t.tool);
}

type Say = Extract<ThreadItem, { kind: 'message' | 'reply' }>;
type Permission = Extract<ThreadItem, { kind: 'permission' }>;
export type Segment =
  | { kind: 'tools'; key: string; tools: ToolItem[] }
  | { kind: 'say'; item: Say }
  | { kind: 'decision'; item: Permission }
  | { kind: 'helper'; item: HelperItem };
export interface Exchange {
  key: string;
  at: string;
  prompt: { id: string; text: string; from: 'you' | 'parent' } | null;
  segments: Segment[];
}

/** Les éléments à plat en segments : les actions consécutives se replient, une permission non décidée n'en est pas un. */
function segmentsOf(items: readonly ThreadItem[]): Segment[] {
  const out: Segment[] = [];
  for (const it of items) {
    if (it.kind === 'tool') {
      const last = out.at(-1);
      if (last?.kind === 'tools') last.tools.push(it); else out.push({ kind: 'tools', key: `tools-${it.id}`, tools: [it] });
    } else if (it.kind === 'message' || it.kind === 'reply') out.push({ kind: 'say', item: it });
    else if (it.kind === 'permission') { if (it.decision) out.push({ kind: 'decision', item: it }); }
    else if (it.kind === 'helper') out.push({ kind: 'helper', item: it });
  }
  return out;
}

/** Le fil principal par tour (turns : sous-agents écartés, écho de la réponse retiré), ou celui d'un sous-agent (helperThread) :
 *  un échange, sa consigne = la tâche de l'élément helper (from 'parent'), puis ses éléments et son rapport.
 *  Les actions consécutives se replient en un segment ; une permission non décidée est la demande épinglée, pas un segment. */
export function exchanges(items: readonly ThreadItem[], helperId?: string): Exchange[] {
  if (helperId !== undefined) {
    const { helper, items: own, report } = helperThread([...items], helperId);
    const rest = [...own, ...(report ? [report] : [])];
    if (!helper && rest.length === 0) return [];
    return [{
      key: helper?.id ?? `helper-${helperId}`, at: helper?.at ?? rest[0]!.at,
      prompt: helper ? { id: helper.id, text: helper.task, from: 'parent' } : null,
      segments: segmentsOf(rest)
    }];
  }
  return turns([...items]).map(t => {
    const rest = t.items.filter(i => i.kind !== 'prompt');
    return {
      key: t.prompt?.id ?? `turn-${t.n}`, at: t.prompt?.at ?? t.items[0]!.at,
      prompt: t.prompt ? { id: t.prompt.id, text: t.prompt.text, from: 'you' as const } : null,
      segments: segmentsOf(rest)
    };
  });
}

/** Les ids dans l'ordre affiché : consigne, puis chaque segment (chaque action d'un repli). */
export function displayIds(xs: readonly Exchange[]): string[] {
  return xs.flatMap(x => [...(x.prompt ? [x.prompt.id] : []), ...x.segments.flatMap(s => s.kind === 'tools' ? s.tools.map(t => t.id) : [s.item.id])]);
}

export interface Summary {
  count: number; kinds: Record<ToolKind, number>;
  files: number; failed: number; cut: number; ms: number;
  running: ToolItem | null;
}
export function summarize(tools: readonly ToolItem[], now: number, live: boolean): Summary {
  const kinds: Record<ToolKind, number> = { read: 0, search: 0, command: 0, edit: 0 };
  const files = new Set<string>();
  let failed = 0, cut = 0, ms = 0;
  for (const t of tools) {
    kinds[kindOf(t.tool)]++;
    ms += elapsedMs(t, now);
    if (t.status === 'failed') failed++;
    else if (t.status === 'unknown') cut++;
    else if (t.status === 'success') for (const f of t.files) files.add(f.path);
  }
  return { count: tools.length, kinds, files: files.size, failed, cut, ms, running: live ? liveTool([...tools]) ?? null : null };
}

/** « 0,4 s », « 48 s », « 2 min 14 s », « 2 min », « 1 h 35 » ; en anglais le séparateur décimal est le point. */
export function fmtDur(ms: number, lang: Lang): string {
  const s = ms / 1000;
  if (s < 9.95) return `${s.toFixed(1)} s`.replace('.', lang === 'fr' ? ',' : '.');
  const total = Math.round(s);
  if (total < 60) return `${total} s`;
  if (total < 3600) { const m = Math.floor(total / 60), r = total % 60; return r ? `${m} min ${r} s` : `${m} min`; }
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60);
  return `${h} h ${String(m).padStart(2, '0')}`;
}

/** La marque d'heure d'un échange : « 14:32 » le jour même (heure locale), sinon « 16 oct. · 09:05 » (fr-BE) / « Oct 16 · 09:05 » (en-US). */
export function timeMark(at: string, now: number, lang: Lang): string {
  const d = new Date(at), n = new Date(now);
  const p2 = (x: number) => String(x).padStart(2, '0');
  const hour = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  if (d.toDateString() === n.toDateString()) return hour;
  const day = d.toLocaleDateString(lang === 'fr' ? 'fr-BE' : 'en-US', { day: 'numeric', month: 'short' });
  return `${day} · ${hour}`;
}

/** Le premier id affiché après `seen` ; null à la première visite (seen null), quand seen est le dernier ou n'existe plus. */
export function unreadFrom(ids: readonly string[], seen: string | null): string | null {
  if (seen === null) return null;
  const i = ids.indexOf(seen);
  return i < 0 ? null : ids[i + 1] ?? null;
}

export const FOLLOW_SLACK = 60;
/** Le lecteur est au bout du fil (à 60 px près) : un nouvel élément y reste en vue. */
export function atEnd(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK;
}

/** Le sous-agent d'une page : session.helpers d'abord, sinon l'élément helper du fil (kind = agentType ?? 'subagent', state 'exited'), sinon null. */
export function helperOf(session: Session, items: readonly ThreadItem[] | undefined, id: string): Helper | null {
  const live = session.helpers.find(h => h.id === id);
  if (live) return live;
  const row = items?.find((i): i is HelperItem => i.kind === 'helper' && i.id === id);
  return row ? { id, kind: row.agentType ?? 'subagent', task: row.task, state: 'exited' } : null;
}
