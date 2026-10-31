import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RIG_NAME, type Projects, type RigLaunchWhere, type RigPlan, type RigSpecSeat } from '@ledge/protocol';
import type { OpenRigHttp } from './http.js';
import { specSeats } from './specs.js';

export const PLAN_TTL_MS = 30 * 60_000;

/** Where the rig's seats run: a copy under the repo, the repo itself, or an own folder outside any project. */
export function rigCwd(where: RigLaunchWhere, spec: string, home: string): string {
  if (where.kind === 'off-project') return `${home}/rigs/${where.name}`;
  return where.copy ? `${where.repo}/.worktrees/rig-${spec}` : where.repo;
}

/** A plan is imposed when the rig works in the real repository (spec §4.6). */
export function isPlanRequired(where: RigLaunchWhere): boolean { return where.kind === 'project' && !where.copy; }

/** What `rig up` leaves in the working folder, by runtime. */
export function plannedWrites(seats: readonly RigSpecSeat[]): string[] {
  const out = ['.openrig/', '.mcp.json'];
  const add = (f: string): void => { if (!out.includes(f)) out.push(f); };
  if (seats.some(s => s.runtime === 'claude-code')) { add('CLAUDE.md'); add('.claude/settings.local.json'); }
  if (seats.some(s => s.runtime === 'codex')) add('AGENTS.md');
  return out;
}

export function upCommand(spec: string, cwd: string): string { return `rig up ${spec} --cwd ${cwd} --yes --json`; }

export interface Plans {
  put(p: RigPlan): void; take(id: string): RigPlan | 'used' | null; get(id: string): RigPlan | null;
  /** A plan taken whose launch was refused « not now » (`openrig_down`): it can be taken again, until its first 30 min are over. */
  giveBack(id: string): void;
}

/** Plans in memory: a plan is taken once, and is gone after PLAN_TTL_MS. */
export function createPlans(now: () => number): Plans {
  const live = new Map<string, { plan: RigPlan; at: number }>();
  const used = new Set<string>();
  /** The plans taken, kept for `giveBack` until their time is over. */
  const taken = new Map<string, { plan: RigPlan; at: number }>();
  const sweep = (): void => { for (const m of [live, taken]) for (const [id, e] of m) if (now() - e.at > PLAN_TTL_MS) m.delete(id); };
  return {
    put(p) { sweep(); live.set(p.id, { plan: p, at: now() }); },
    get(id) { sweep(); return live.get(id)?.plan ?? null; },
    take(id) {
      sweep();
      const e = live.get(id);
      if (!e) return used.has(id) ? 'used' : null;
      live.delete(id); used.add(id); taken.set(id, e);
      return e.plan;
    },
    giveBack(id) {
      sweep();
      const e = taken.get(id); if (!e) return;
      taken.delete(id); used.delete(id); live.set(id, e);
    }
  };
}

function nonEmptyDir(dir: string): boolean { try { return readdirSync(dir).length > 0; } catch { return false; } }

export async function prepareRigPlan(d: { http: OpenRigHttp; home: string; projects(): Projects; machine: string },
  msg: { spec: string; goal: string; where: RigLaunchWhere }): Promise<RigPlan | { refused: string }> {
  if (msg.goal.trim() === '') return { refused: 'goal required' };
  const entry = (await d.http.specs()).find(e => e.id === msg.spec || e.name === msg.spec);
  if (!entry) return { refused: `unknown spec ${msg.spec}` };
  const w = msg.where;
  if (w.kind === 'project') {
    const project = d.projects().projects.find(p => p.id === w.projectId);
    if (!project || !project.repos.some(r => r.machine === d.machine && r.path === w.repo)) return { refused: 'unknown repo' };
    if (w.copy && w.branch.trim() === '') return { refused: 'branch required' };
    if (w.copy && w.branch.startsWith('-')) return { refused: 'invalid branch' }; // never read by git as an option
  } else {
    if (!RIG_NAME.test(w.name)) return { refused: 'invalid name' };
    if (nonEmptyDir(join(d.home, 'rigs', w.name))) return { refused: 'workspace exists' };
  }
  const seats = specSeats((await d.http.spec(entry.id)).yaml);
  const cwd = rigCwd(w, msg.spec, d.home);
  return { id: `plan-${randomUUID()}`, machine: d.machine, spec: msg.spec, goal: msg.goal, where: w, cwd,
    seats: seats.map(s => ({ address: s.address, runtime: s.runtime, ...(s.model ? { model: s.model } : {}), autonomy: s.profile ?? 'default' })),
    writes: plannedWrites(seats), command: upCommand(msg.spec, cwd), required: isPlanRequired(w) };
}
