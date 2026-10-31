import { RIG_NAME } from '@ledge/protocol';
import type { OpenRigStatus, Project, RigLaunchWhere, RigSpecInfo, RigSpecSeat } from '@ledge/protocol';
import type { MachineState } from '@ledge/fleet';

/** The rig launch window's form. `place.kind === 'off'` is a space outside any project (the contract's `off-project`). */
export interface RigForm {
  goal: string;
  spec: string | null;
  machine: string;
  place:
    | { kind: 'project'; projectId: string; repo: string | null; branch: string; copy: boolean }
    | { kind: 'off'; name: string; nameTouched: boolean };
}
export type RigMissing = 'goal' | 'spec' | 'repo' | 'branch' | 'name';

const STOP = new Set(['le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'et', 'à', 'au', 'pour', 'sur', 'après', 'avant']);
const LONG_WORDS = ['jours', 'durée', 'produit', 'livrer', 'plusieurs'];
export const LONG_GOAL = 160;

const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** « Prototyper la reprise des rigs après un reboot de WSL » → « reboot-wsl »: the last two significant words; always a valid RIG_NAME. */
export function slugOfGoal(goal: string): string {
  const words = goal.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w)).map(fold)
    .map((w) => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
  const slug = words.slice(-2).join('-').slice(0, 40).replace(/-+$/, '');
  return RIG_NAME.test(slug) ? slug : 'rig';
}

export function rigFormDefaults(p: {
  projects: readonly Project[]; machines: readonly MachineState[];
  wanted: { project?: string; spec?: string; goal?: string; machine?: string; off?: string };
}): RigForm {
  const goal = p.wanted.goal ?? '';
  const spec = p.wanted.spec ?? null;
  const machine = p.machines.find((m) => m.id === p.wanted.machine)?.id ?? p.machines.find((m) => m.id === 'local')?.id ?? p.machines[0]?.id ?? 'local';
  const project = p.projects.find((x) => x.id === p.wanted.project);
  // An off-project name given (the brain's card) is kept as the user's; otherwise it follows the goal.
  if (!project) return { goal, spec, machine, place: p.wanted.off ? { kind: 'off', name: p.wanted.off, nameTouched: true } : { kind: 'off', name: slugOfGoal(goal), nameTouched: false } };
  const repo = project.repos.find((r) => r.machine === machine)?.path ?? null;
  return { goal, spec, machine, place: { kind: 'project', projectId: project.id, repo, branch: spec ? `feat/${spec}` : '', copy: true } };
}

/** The form with a new goal; an untouched space name follows the goal. */
export function withGoal(f: RigForm, goal: string): RigForm {
  const place = f.place.kind === 'off' && !f.place.nameTouched ? { ...f.place, name: slugOfGoal(goal) } : f.place;
  return { ...f, goal, place };
}

export function recommendSpec(goal: string, specs: readonly RigSpecInfo[]): { spec: string; why: 'bounded' | 'long' } | null {
  const g = goal.toLowerCase();
  const long = goal.length > LONG_GOAL || LONG_WORDS.some((w) => g.includes(w));
  const spec = long ? 'factory' : 'starter';
  return specs.some((s) => s.name === spec || s.id === spec) ? { spec, why: long ? 'long' : 'bounded' } : null;
}

export function missingOf(f: RigForm): RigMissing[] {
  const out: RigMissing[] = [];
  if (!f.goal.trim()) out.push('goal');
  if (!f.spec) out.push('spec');
  if (f.place.kind === 'project') {
    if (!f.place.repo) out.push('repo');
    const b = f.place.branch.trim();
    if (!b || b.startsWith('-')) out.push('branch');
  } else if (!RIG_NAME.test(f.place.name)) out.push('name');
  return out;
}

/** The launch place, or null while a field is missing. */
export function whereOf(f: RigForm): RigLaunchWhere | null {
  const missing = missingOf(f);
  if (f.place.kind === 'project') {
    if (missing.includes('repo') || missing.includes('branch') || !f.place.repo) return null;
    return { kind: 'project', projectId: f.place.projectId, repo: f.place.repo, branch: f.place.branch.trim(), copy: f.place.copy };
  }
  return missing.includes('name') ? null : { kind: 'off-project', name: f.place.name };
}

/** A plan is imposed on the real repository (no copy); optional elsewhere. */
export const planRequired = (f: RigForm): boolean => f.place.kind === 'project' && !f.place.copy;
export const primaryAction = (f: RigForm): 'launch' | 'plan' => (planRequired(f) ? 'plan' : 'launch');

export function providers(seats: readonly RigSpecSeat[]): { runtime: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of seats) counts.set(s.runtime, (counts.get(s.runtime) ?? 0) + 1);
  return [...counts].map(([runtime, count]) => ({ runtime, count }));
}

/** Ledge starts OpenRig itself, so running, stopped and starting all launch. */
export function launchability(
  m: Pick<MachineState, 'status'>, status: OpenRigStatus | undefined,
): { ok: true } | { ok: false; why: 'offline' | 'absent' | 'unsupported' | 'unreachable'; install?: string } {
  if (m.status !== 'open') return { ok: false, why: 'offline' };
  if (!status) return { ok: false, why: 'unreachable' };
  switch (status.state) {
    case 'running': case 'stopped': case 'starting': return { ok: true };
    case 'absent': return status.install ? { ok: false, why: 'absent', install: status.install } : { ok: false, why: 'absent' };
    case 'unsupported': return { ok: false, why: 'unsupported' };
    default: return { ok: false, why: 'unreachable' };
  }
}
