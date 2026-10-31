import type { Projects, Rig } from '@ledge/protocol';

/** A path's last folder name, whatever its separators (a Windows path too). */
const base = (path: string): string => path.split(/[\\/]+/).filter(Boolean).pop() ?? path;

/** The projects with a repository whose folder is named `name`. */
const owning = (projects: Projects, name: string): string[] => projects.projects.filter(p => p.repos.some(r => base(r.path) === name)).map(p => p.id);

/** Where Ledge would file an off-project rig (spec §8.2), or null when it cannot tell. Never acts: the user decides.
 *  - the only found repository with changes carries the folder name of a project's repository → that project (`only-modified`);
 *  - else exactly one project has a repository named like one of the found ones → that project (`name`). */
export function proposeProject(rig: Rig, projects: Projects): { projectId: string; why: 'only-modified' | 'name' } | null {
  const modified = rig.repos.filter(r => r.modified > 0);
  if (modified.length === 1) {
    const ids = owning(projects, modified[0]!.name);
    if (ids.length === 1) return { projectId: ids[0]!, why: 'only-modified' };
  }
  const ids = new Set(rig.repos.flatMap(r => owning(projects, r.name)));
  return ids.size === 1 ? { projectId: [...ids][0]!, why: 'name' } : null;
}

/** A rig of this daemon in a space off any project that no project holds yet (once filed, `projectId` is set; the daemon keeps
 *  `offProject`). Another machine's rig is never offered: projects belong to the local daemon, `rig.adopt` cannot file it there. */
export const isUnfiled = (rig: Rig): boolean => rig.machine === 'local' && rig.offProject && !rig.projectId && rig.lifecycle !== 'unreachable';
