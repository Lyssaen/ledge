// The IDE launch modal's rules, pure (no DOM): the project rows, an agent's 5 h limit, where a session opens.
import type { MachineState } from '@ledge/fleet';
import type { Project, UsageHarness } from '@ledge/protocol';
import type { UsageGroup } from '../usage/model';
import type { OpenSession } from '../workspace/openPrefs';
import { isUp, type Tool } from './model';

/** One row of the Project field: a project's folder on a machine. */
export interface ProjectRow { key: string; project: string; projectName: string; machine: string; machineLabel: string; path: string; up: boolean }

/** The projects in their order, then their folders in the project's order; `key` = `${project}|${machine}|${path}`. */
export function projectRows(projects: readonly Project[], machines: readonly MachineState[]): ProjectRow[] {
  const byId = new Map(machines.map(m => [m.id, m]));
  return projects.flatMap(p => p.repos.map(r => {
    const m = byId.get(r.machine);
    return { key: `${p.id}|${r.machine}|${r.path}`, project: p.id, projectName: p.name, machine: r.machine, machineLabel: m?.label ?? r.machine, path: r.path, up: m ? isUp(m) : false };
  }));
}

const HARNESS: Partial<Record<Tool, UsageHarness>> = { claude: 'claude', codex: 'codex' };

/** The 5 h window of `tool`'s account on `machine`; null: « Limite non lue ». */
export function agentLimit(groups: readonly UsageGroup[], tool: Tool, machine: string | null, threshold: number): { pct: number; resetsAt: string | null; warn: boolean } | null {
  const harness = HARNESS[tool];
  if (!harness) return null;
  const mine = groups.filter(g => g.harness === harness);
  const group = (machine !== null ? mine.find(g => g.machines.includes(machine)) : undefined) ?? mine[0];
  const w = group?.windows.find(x => x.kind === 'five_hour');
  return w ? { pct: w.pct, resetsAt: w.resetsAt, warn: w.pct >= threshold * 100 } : null;
}

/** The starting value of « Open »: « + » opens in the active pane, the other doors follow the setting. */
export function openWhere(setting: OpenSession, from: 'plus' | 'other'): 'active' | 'right' {
  return from === 'plus' ? 'active' : setting;
}
