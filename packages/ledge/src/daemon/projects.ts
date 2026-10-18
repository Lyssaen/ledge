import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { DEFAULT_PROJECTS, ProjectsSchema, type Projects } from '@ledge/protocol';
import { paths } from '../paths.js';
import { log } from '../log.js';

/** The projects and folder rules the local fronts share; anything unreadable or invalid means none and is left untouched (build spec §5). */
export function readProjects(file = paths().projects): Projects {
  let raw: string;
  try { raw = readFileSync(file, 'utf8'); } catch { return DEFAULT_PROJECTS; } // absent: no project yet, nothing to say
  try { return ProjectsSchema.parse(JSON.parse(raw)); }
  catch (e) { log(`projects.json is invalid, using no projects: ${(e as Error).message.split('\n')[0]}`); return DEFAULT_PROJECTS; }
}

/** Written whole on each accepted `projects.set`; rename keeps a crash from leaving a half file. */
export function writeProjects(state: Projects, file = paths().projects): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, file);
}
