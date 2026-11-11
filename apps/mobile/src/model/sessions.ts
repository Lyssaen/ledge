import type { PhoneSession } from '@ledge/protocol';
import { copy } from '../copy';
import type { DotState } from '../ui/kit/marks';
import { endedAtLabel } from './sessionEnd';
import { requestsOf } from './requests';

/*
 * The Sessions list (docs/mockups/ledge-mobile-refonte/m2-sessions.html §1, Q24, Q25): the filters, the groups by project then by
 * rig, the order inside a group and what a row says.
 */

/** « Toutes », « En attente » (a permission or a question waits on the person), « Au travail » (`working`). */
export type SessionFilter = 'all' | 'waiting' | 'working';
export const SESSION_FILTERS: readonly SessionFilter[] = ['all', 'waiting', 'working'];

/** A request of this session waits on the person: its card is in « À toi ». */
export const waitsOnYou = (s: PhoneSession): boolean =>
  s.pending !== undefined || s.state === 'waiting_permission' || s.state === 'waiting_input';

/** Whether a session is listed under a filter; an ended session is only in « Toutes » (Q25). */
export function inFilter(s: PhoneSession, f: SessionFilter): boolean {
  if (f === 'waiting') return waitsOnYou(s);
  if (f === 'working') return s.state === 'working' && !waitsOnYou(s);
  return true;
}

/** Inside a group: those waiting on you first, then at work, then free, then ended (§1). */
function rank(s: PhoneSession): number {
  if (waitsOnYou(s)) return 0;
  if (s.state === 'working') return 1;
  if (s.state === 'exited') return 3;
  return 2;
}

export interface SessionGroup {
  /** `project:<name>` or `rig:<name>`: two groups never share one. */
  id: string;
  kind: 'project' | 'rig';
  /** The project's name, or the rig's. */
  name: string;
  sessions: PhoneSession[];
}

/**
 * The sessions of a filter by project, then OpenRig's seats by rig, as Desktop's side bar groups them. The groups keep the
 * order the PC lists their first session in; inside a group, `rank` then the PC's order.
 */
export function sessionGroups(sessions: readonly PhoneSession[], f: SessionFilter): SessionGroup[] {
  const projects = new Map<string, SessionGroup>();
  const rigs = new Map<string, SessionGroup>();
  for (const s of sessions) {
    if (!inFilter(s, f)) continue;
    const [map, kind, name] = s.rig ? [rigs, 'rig' as const, s.rig.name] : [projects, 'project' as const, s.project];
    let g = map.get(name);
    if (!g) map.set(name, g = { id: `${kind}:${name}`, kind, name, sessions: [] });
    g.sessions.push(s);
  }
  const sorted = (g: SessionGroup): SessionGroup => ({ ...g, sessions: g.sessions.map((s, i) => [s, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([s]) => s) });
  return [...projects.values(), ...rigs.values()].map(sorted);
}

/** How many sessions each filter holds, for its chip. */
export const filterCounts = (sessions: readonly PhoneSession[]): Record<SessionFilter, number> => ({
  all: sessions.length,
  waiting: sessions.filter(s => inFilter(s, 'waiting')).length,
  working: sessions.filter(s => inFilter(s, 'working')).length
});

/** A row's dot: red a permission, amber a question, blue at work, green free, grey ended. */
export function dotOf(s: PhoneSession): DotState {
  const pending = requestsOf([s])[0];
  if (pending) return pending.kind === 'question' ? 'ask' : 'perm';
  if (s.state === 'waiting_permission') return 'perm';
  if (s.state === 'waiting_input') return 'ask';
  if (s.state === 'working') return 'work';
  if (s.state === 'exited') return 'done';
  return 'idle';
}

/** Its sub-agents still at work: the « +2 » next to its name (Q21). */
export const activeHelpers = (s: PhoneSession): number => s.helpers.filter(h => h.state !== 'exited' && h.finishedAt === undefined).length;

/**
 * What a row says under the name (§1): its state in words and its context, « autorisation demandée », « au travail · 38 % »,
 * « terminée à 14:02 ». Under « Au travail », what it does instead (Q68): its last reply's first line until the PC sends `doing`.
 */
export function rowLine(s: PhoneSession, f: SessionFilter, now: number = Date.now()): string {
  const L = copy.sessions.line;
  if (f === 'working') return doingLine(s);
  const ctx = contextPct(s);
  const pct = ctx === undefined ? '' : ` · ${ctx} %`;
  const pending = requestsOf([s])[0];
  if (pending) return (pending.kind === 'permission' ? L.permission : copy.atoi.pill[pending.kind]) + pct;
  switch (s.state) {
    case 'waiting_permission': return L.permission + pct;
    case 'waiting_input': return copy.atoi.pill.question + pct;
    case 'working': return L.working + pct;
    case 'exited': return s.exitedAt ? L.ended(endedAtLabel(s.exitedAt, now)) : L.endedPlain;
    case 'error': return L.error;
    default: return L.idle + pct;
  }
}

/**
 * What an agent at work is doing (m2-toujours.html §2, Q68): `doing`'s label as the PC sends it (a command, a tool and its target,
 * OMP's intent), with no icon or prefix; between two tools, « Réfléchit… ». Shared by « Au travail » and « En cours » of « À toi ».
 */
export const doingLine = (s: Pick<PhoneSession, 'doing'>): string => s.doing?.label || copy.sessions.line.thinking;

/** Its context in percent of its window, when the PC knows it. */
export const contextPct = (s: PhoneSession): number | undefined => s.context ? Math.round(Math.min(1, s.context.used / s.context.window) * 100) : undefined;

/** On the right of a row: an OpenRig seat's role, else its branch's last segment (« feat/ide-shell » → « ide-shell »). */
export function rowMeta(s: PhoneSession): string | undefined {
  if (s.rig) return s.rig.role;
  if (!s.branch) return undefined;
  return s.branch.split('/').filter(Boolean).pop() ?? s.branch;
}
