import type { ThreadItem, ToolItem } from '@ledge/protocol';

export type TodoStatus = 'pending' | 'in_progress' | 'completed';
export interface Todo { text: string; status: TodoStatus }

/** The actions that write the agent's work plan: TodoWrite (Claude Code), update_plan (Codex). Cursor keeps none. */
export const TODO_TOOLS: ReadonlySet<string> = new Set(['TodoWrite', 'update_plan']);

const STATUSES: ReadonlySet<string> = new Set<TodoStatus>(['pending', 'in_progress', 'completed']);
const statusOf = (s: unknown): TodoStatus => (typeof s === 'string' && STATUSES.has(s) ? s as TodoStatus : 'pending');
const text = (s: unknown): string | null => (typeof s === 'string' && s.trim() !== '' ? s : null);
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});

/** An update's list, entries without a text left out (possibly none); undefined when its input is unreadable (no JSON, or
 *  no list in it) or it is no update. */
function listOf(t: ToolItem): Todo[] | undefined {
  if (!TODO_TOOLS.has(t.tool) || t.input === undefined) return undefined;
  let input: Record<string, unknown>;
  try { input = record(JSON.parse(t.input)); } catch { return undefined; }
  const claude = t.tool === 'TodoWrite';
  const list = claude ? input.todos : input.plan;
  if (!Array.isArray(list)) return undefined;
  const out: Todo[] = [];
  for (const raw of list) {
    const e = record(raw);
    const status = statusOf(e.status);
    const said = claude ? (status === 'in_progress' ? text(e.activeForm) ?? text(e.content) : text(e.content)) : text(e.step);
    if (said !== null) out.push({ text: said, status });
  }
  return out;
}

/** L'entrée de l'action (JSON) : TodoWrite `{ todos: [{ content, status, activeForm }] }` (en cours : activeForm, sinon content) ;
 *  update_plan `{ plan: [{ step, status }] }`. Un statut inconnu compte comme pending ; JSON illisible, liste vide ou autre outil : null.
 *  An entry without a text is left out. */
export function todosOf(t: ToolItem): Todo[] | null {
  const list = listOf(t);
  return list && list.length > 0 ? list : null;
}

/** La dernière liste du fil affiché (principal ou d'un sous-agent) ; null quand il n'y en a pas (Cursor, ou un agent qui n'en tient pas).
 *  The main thread's items carry no helperId; a subagent's carry its id. The latest update wins, even one that empties the
 *  list (null: the bar goes); an unreadable one leaves the list before it. */
export function latestTodos(items: readonly ThreadItem[], helperId?: string): Todo[] | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind !== 'tool' || it.helperId !== helperId || !TODO_TOOLS.has(it.tool)) continue;
    const list = listOf(it);
    if (list) return list.length > 0 ? list : null;
  }
  return null;
}

/** How many are done. */
export const doneCount = (todos: readonly Todo[]): number => todos.filter(x => x.status === 'completed').length;
