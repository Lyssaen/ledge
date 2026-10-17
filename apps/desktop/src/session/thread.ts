import type { FileChange, Helper, HelperItem, Pending, Session, ThreadItem, ToolItem } from '@ledge/protocol';
import { helperThread, turns } from '@ledge/ui/thread/turns';
import { elapsedMs, liveTool } from '@ledge/ui/thread/tools';
import { findDocumentReferences } from '@ledge/ui/documents/references';
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
  | { kind: 'helper'; item: HelperItem }
  | { kind: 'plan'; item: ToolItem; plan: PlanDoc };
export interface Exchange {
  key: string;
  at: string;
  prompt: { id: string; text: string; from: 'you' | 'parent' } | null;
  segments: Segment[];
}

/** Les éléments à plat en segments : les actions consécutives se replient, une action ExitPlanMode en sort (son plan),
 *  une permission non décidée n'en est pas un. */
function segmentsOf(items: readonly ThreadItem[]): Segment[] {
  const out: Segment[] = [];
  for (const it of items) {
    if (it.kind === 'tool') {
      const plan = planOf(it);
      if (plan) { out.push({ kind: 'plan', item: it, plan }); continue; }
      const last = out.at(-1);
      if (last?.kind === 'tools') last.tools.push(it); else out.push({ kind: 'tools', key: `tools-${it.id}`, tools: [it] });
    } else if (it.kind === 'message' || it.kind === 'reply') out.push({ kind: 'say', item: it });
    else if (it.kind === 'permission') { if (it.decision) out.push({ kind: 'decision', item: it }); }
    else if (it.kind === 'helper') out.push({ kind: 'helper', item: it });
  }
  return out;
}

export interface PlanDoc { key: string; title: string; markdown: string; steps: string[]; status: 'proposed' | 'approved' | 'revised' }

/** Les étapes numérotées (stepsOf de la maquette : `1. **Titre** — suite` → « Titre », `2. Suite` → « Suite »). */
export function stepsOf(markdown: string): string[] {
  return [...markdown.matchAll(/^\d+\. (?:\*\*(.+?)\*\*)?(.*)$/gm)].map(m => (m[1] ?? m[2] ?? '').replace(/^ — /, '').trim());
}

/** La première ligne non vide, sans ses `#` ni espaces de tête. */
export function planTitle(markdown: string): string {
  return (markdown.split('\n').find(l => l.trim() !== '') ?? '').replace(/^\s*#+\s*/, '').trim();
}

const planDoc = (key: string, markdown: string, status: PlanDoc['status']): PlanDoc =>
  ({ key, title: planTitle(markdown), markdown, steps: stepsOf(markdown), status });

const PLAN_STATUS: Record<ToolItem['status'], PlanDoc['status']> = { running: 'proposed', success: 'approved', failed: 'revised', unknown: 'revised' };

/** Une action ExitPlanMode : le plan de son entrée (JSON `{ plan }`), key = id ; running → proposed, success → approved,
 *  failed / unknown → revised. null sinon (une autre action, ou une entrée sans plan lisible : elle reste une action). */
export function planOf(t: ToolItem): PlanDoc | null {
  if (t.tool !== 'ExitPlanMode' || t.input === undefined) return null;
  let plan: unknown;
  try { plan = (JSON.parse(t.input) as { plan?: unknown } | null)?.plan; } catch { return null; }
  return typeof plan === 'string' && plan.trim() !== '' ? planDoc(t.id, plan, PLAN_STATUS[t.status]) : null;
}

/** Le plan d'une demande `plan` (body, sinon text), key 'pending', proposed — Codex et Cursor n'ont pas d'action ExitPlanMode. */
export function pendingPlan(p: Pending): PlanDoc | null {
  return p.kind === 'plan' ? planDoc('pending', p.body ?? p.text, 'proposed') : null;
}

/** Le fil principal par tour (turns : sous-agents écartés, écho de la réponse retiré), ou celui d'un sous-agent (helperThread) :
 *  un échange, sa consigne = la tâche de l'élément helper (from 'parent'), puis ses éléments et son rapport.
 *  Les actions consécutives se replient en un segment ; une permission non décidée est la demande épinglée, pas un segment.
 *  Un plan encore en attente qu'un plan plus récent du même fil suit est révisé. */
export function exchanges(items: readonly ThreadItem[], helperId?: string): Exchange[] {
  return superseded(exchangesOf(items, helperId));
}

/** A plan still waiting when the same thread proposes a later one was sent back: the daemon settles its action only at
 *  the turn's end (or on a failure it is told of), so until then it would read « En attente de votre accord » twice. */
function superseded(xs: Exchange[]): Exchange[] {
  const plans = xs.flatMap(x => x.segments.filter((s): s is Extract<Segment, { kind: 'plan' }> => s.kind === 'plan'));
  for (const s of plans.slice(0, -1)) if (s.plan.status === 'proposed') s.plan = { ...s.plan, status: 'revised' };
  return xs;
}

function exchangesOf(items: readonly ThreadItem[], helperId?: string): Exchange[] {
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

/** The subagent of a place: helperOf, else — known by neither (its thread not there yet, or gone) — named by its id alone, finished. */
export function subagentOf(session: Session, items: readonly ThreadItem[] | undefined, id: string): Helper {
  return helperOf(session, items, id) ?? { id, kind: 'subagent', task: '', state: 'exited' };
}

/** A message shows at most this many document cards. */
const DOC_CARDS = 3;
/** The Markdown files a message names or links (findDocumentReferences), distinct, in order, three at most. */
export function docRefs(text: string): string[] {
  const out: string[] = [];
  for (const { reference } of findDocumentReferences(text)) {
    if (!out.includes(reference.path)) out.push(reference.path);
    if (out.length === DOC_CARDS) break;
  }
  return out;
}
