import { projectOf, type Projects, type Rig } from '@ledge/protocol';

/** Files a rig in a project: out of every other project's `rigs`, into this one's. Nothing moves on disk. */
export function adoptRig(projects: Projects, projectId: string, rigId: string): Projects | { refused: 'unknown project' } {
  if (!projects.projects.some(p => p.id === projectId)) return { refused: 'unknown project' };
  return { ...projects, projects: projects.projects.map(p => {
    const rest = p.rigs.filter(id => id !== rigId);
    return { ...p, rigs: p.id === projectId ? [...rest, rigId] : rest };
  }) };
}

/** The project that lists the rig, else the one whose repository contains its cwd on this machine (lot 2), else none. */
export function rigProjectId(rig: Pick<Rig, 'id' | 'cwd' | 'machine'>, projects: Projects): string | null {
  const filed = projects.projects.find(p => p.rigs.includes(rig.id));
  if (filed) return filed.id;
  return rig.cwd ? projectOf({ machineId: rig.machine, cwd: rig.cwd }, projects) : null;
}
