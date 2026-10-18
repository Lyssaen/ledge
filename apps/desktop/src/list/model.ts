import type { Helper, Project, Projects, Session } from '@ledge/protocol';
import type { MachineState } from '@ledge/fleet';
import { botState } from '@ledge/ui/bots/poseFor';
import { folderOf } from '../atelier/filing';
import { helperState, tableBranch } from '../atelier/layout';
import { fold, machineOf, taskOf } from '../nav/agents';
import type { ProjectFilter } from '../nav/state';

export type Bucket = 'decide' | 'running' | 'done' | 'offline';
export const BUCKETS: readonly Bucket[] = ['decide', 'running', 'done', 'offline'];
export type Chip = Bucket | 'all';
export type GroupBy = 'project' | 'machine' | 'state';

const bucketOfBot = (b: ReturnType<typeof botState>): Bucket => (b === 'approval' || b === 'question' ? 'decide' : b === 'done' || b === 'idle' ? 'done' : 'running');

export function bucketOf(s: Session): Bucket {
  return s.offline ? 'offline' : bucketOfBot(botState(s));
}
export function helperBucket(h: Helper, parent: Session): Bucket {
  return parent.offline ? 'offline' : bucketOfBot(helperState(h));
}
/** A row's repository: `s.repo`, else the name of the `cwd` folder. */
export const repoOf = (s: Session): string => s.repo ?? folderOf(s.cwd);

/** What the row offers: Allow / Deny for a permission or a diff (not a question, not a plan to read), Reply for a question;
 *  never offline nor read-only (`hook_only`). */
export function quickActions(s: Session): { decide: boolean; reply: boolean } {
  const none = { decide: false, reply: false };
  if (s.offline || s.source === 'hook_only' || !s.pending) return none;
  const k = s.pending.kind;
  return { decide: k === 'permission' || k === 'diff', reply: k === 'question' };
}

export type ListRow =
  | { kind: 'main'; key: string; session: Session; context: boolean; kids: number; expanded: boolean }
  | { kind: 'helper'; key: string; helper: Helper; parent: Session; last: boolean };
export interface ListGroup {
  key: string;
  kind: GroupBy;
  label: string;
  project?: Project;
  unassigned?: true;
  machine?: { id: string; offline: boolean };
  bucket?: Bucket;
  branch: string | null;
  members: readonly Session[];
  tally: Record<Bucket, number>;
  shown: number;
  rows: readonly ListRow[];
}
export interface ListCtx {
  projects: Projects | null;
  projectIdOf: (s: Session) => string | null;
  machines: readonly Pick<MachineState, 'id' | 'label' | 'status'>[];
  waits: ReadonlyMap<string, string>;
  labels: { unassigned: string; buckets: Record<Bucket, string> };
}
export interface ListQuery { text: string; chip: Chip; group: GroupBy; helpers: boolean; toggled: ReadonlySet<string>; filter: ProjectFilter }
export interface ListModel { groups: ListGroup[]; counts: Record<Chip, number>; total: number; filtering: boolean; empty: Project | null }

const zero = (): Record<Bucket, number> => ({ decide: 0, running: 0, done: 0, offline: 0 });
const ms = (iso: string | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

interface Entry { session: Session; bucket: Bucket; hits: readonly Helper[]; context: boolean }

export function listModel(order: readonly Session[], ctx: ListCtx, q: ListQuery): ListModel {
  const list = ctx.projects?.projects ?? [];
  const known = new Map(list.map(p => [p.id, p]));
  const idOf = (s: Session): string | null => { const id = ctx.projectIdOf(s); return id !== null && known.has(id) ? id : null; };
  const scoped = order.filter(s => q.filter === 'all' || (q.filter === 'none' ? idOf(s) === null : idOf(s) === q.filter));
  const text = fold(q.text.trim());
  const filtering = text !== '' || q.chip !== 'all';

  const entries = new Map<string, Entry>();
  const counts: Record<Chip, number> = { all: 0, ...zero() };
  for (const s of scoped) {
    let hits: readonly Helper[] = [];
    let mine = text === '';
    if (text !== '') {
      const project = idOf(s);
      mine = fold([s.name, taskOf(s), machineOf(s), repoOf(s), project === null ? ctx.labels.unassigned : known.get(project)!.name].join('\n')).includes(text);
      if (q.helpers) hits = (s.helpers ?? []).filter(h => fold(`${h.kind}\n${h.task}`).includes(text));
    }
    if (!mine && hits.length === 0) continue;
    const bucket = bucketOf(s);
    counts[bucket]++;
    counts.all++;
    entries.set(s.id, { session: s, bucket, hits, context: !mine });
  }

  const rowsOf = (members: readonly Session[]): ListRow[] => {
    const shown = members.map(m => entries.get(m.id)).filter((e): e is Entry => !!e && (q.chip === 'all' || e.bucket === q.chip));
    const start = (e: Entry) => ms(ctx.waits.get(e.session.id) ?? e.session.lastActivityAt);
    const sorted = [...shown.filter(e => e.bucket === 'decide').sort((a, b) => start(a) - start(b)), ...shown.filter(e => e.bucket !== 'decide')];
    return sorted.flatMap((e): ListRow[] => {
      const s = e.session;
      const helpers = q.helpers ? s.helpers ?? [] : [];
      const searching = e.hits.length > 0;
      const expanded = helpers.length > 0 && (searching || (helpers.some(h => helperBucket(h, s) === 'decide') !== q.toggled.has(s.id)));
      const main: ListRow = { kind: 'main', key: s.id, session: s, context: e.context, kids: helpers.length, expanded };
      if (!expanded) return [main];
      const kids = searching ? e.hits : helpers;
      return [main, ...kids.map((helper, i): ListRow => ({ kind: 'helper', key: `${s.id}:${helper.id}`, helper, parent: s, last: i === kids.length - 1 }))];
    });
  };

  const buckets = new Map<string, { key: string; kind: GroupBy; label: string; members: Session[]; extra: Partial<ListGroup> }>();
  const open = (key: string, kind: GroupBy, label: string, extra: Partial<ListGroup> = {}) => {
    if (!buckets.has(key)) buckets.set(key, { key, kind, label, members: [], extra });
    return buckets.get(key)!;
  };
  if (q.group === 'project') {
    for (const p of list) open(`project:${p.id}`, 'project', p.name, { project: p });
    open('project:none', 'project', ctx.labels.unassigned, { unassigned: true });
    for (const s of scoped) { const id = idOf(s); buckets.get(id === null ? 'project:none' : `project:${id}`)!.members.push(s); }
  } else if (q.group === 'machine') {
    for (const m of ctx.machines) open(`machine:${m.id}`, 'machine', m.label, { machine: { id: m.id, offline: m.status === 'unreachable' } });
    for (const s of scoped) {
      const id = s.machineId ?? 'local';
      (buckets.get(`machine:${id}`) ?? open(`machine:${id}`, 'machine', machineOf(s), { machine: { id, offline: false } })).members.push(s);
    }
  } else {
    for (const b of BUCKETS) open(`state:${b}`, 'state', ctx.labels.buckets[b], { bucket: b });
    for (const s of scoped) buckets.get(`state:${bucketOf(s)}`)!.members.push(s);
  }

  const groups: ListGroup[] = [];
  for (const g of buckets.values()) {
    if (g.members.length === 0) continue;
    const rows = rowsOf(g.members);
    if (rows.length === 0) continue;
    const tally = zero();
    for (const m of g.members) tally[bucketOf(m)]++;
    groups.push({
      key: g.key, kind: g.kind, label: g.label, ...g.extra,
      branch: g.kind === 'project' ? tableBranch(g.members) : null,
      members: g.members, tally, shown: rows.filter(r => r.kind === 'main').length, rows
    });
  }

  const target = q.filter === 'all' || q.filter === 'none' ? undefined : known.get(q.filter);
  return { groups, counts, total: scoped.length, filtering, empty: target && scoped.length === 0 ? target : null };
}

/** The displayed order, the one J / K walk: group by group, collapsed groups left out, unfolded subagent rows included. */
export function walkRows(groups: readonly ListGroup[], collapsed: ReadonlySet<string>): ListRow[] {
  return groups.filter(g => !collapsed.has(g.key)).flatMap(g => g.rows);
}
