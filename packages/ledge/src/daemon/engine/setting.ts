import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { DEFAULT_TEAMS_ENGINE, TeamsEngineSchema, type OpenRigStatus, type Rig, type Team, type TeamsEngine } from '@ledge/protocol';
import { log } from '../../log.js';
import { readOpenRigFile } from '../openrig/cursor.js';

/** The engine in force (teams.engine): 'ledge' when the file is missing or invalid. */
export function readTeamsEngine(path: string): TeamsEngine {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { engine?: unknown };
    const parsed = TeamsEngineSchema.safeParse(raw?.engine);
    return parsed.success ? parsed.data : DEFAULT_TEAMS_ENGINE;
  } catch { return DEFAULT_TEAMS_ENGINE; }
}

/** Whether the OpenRig bridge followed OpenRig on this machine before: openrig.json keeps, for `local`, the rigs it mirrored
 *  or the cursor of the event stream it read (only kept while OpenRig ran and the bridge mirrored it, never in probe only). */
export function openrigUsedHere(openrigPath: string): boolean {
  const local = readOpenRigFile(openrigPath).machines.local;
  return !!local && (local.rigs.length > 0 || local.lastEventId !== null);
}

/**
 * The engine at the daemon's start (branch review I1). The file is the user's choice. Without it, a machine where OpenRig was
 * used before keeps OpenRig, written down so this seeding happens once; any other machine gets Ledge, the default, and nothing
 * is written (a later OpenRig use is no reason to switch it). Said in one line of the log either way.
 */
export function initialTeamsEngine(enginePath: string, openrigPath: string): TeamsEngine {
  if (existsSync(enginePath)) return readTeamsEngine(enginePath);
  if (!openrigUsedHere(openrigPath)) {
    log(`teams engine: no ${enginePath}, none of OpenRig in openrig.json: ${DEFAULT_TEAMS_ENGINE} (the default)`);
    return DEFAULT_TEAMS_ENGINE;
  }
  try { writeTeamsEngine(enginePath, 'openrig'); log(`teams engine: no ${enginePath}, OpenRig was used on this machine (openrig.json): openrig, written`); }
  catch (e) { log(`teams engine: OpenRig was used on this machine: openrig, not written (${(e as Error).message})`); }
  return 'openrig';
}

/** Written whole, through a temporary file and a rename, as the island's. */
export function writeTeamsEngine(path: string, e: TeamsEngine): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ engine: e }, null, 2) + '\n');
  renameSync(tmp, path);
}

/** Is a team of this engine running? Ledge: an active team. OpenRig: a non-kernel rig launching, running or partial. */
export function engineRunning(engine: TeamsEngine, d: { teams: Team[]; rigs: Rig[] }): boolean {
  if (engine === 'ledge') return d.teams.some(t => t.state === 'active');
  return d.rigs.some(r => !r.kernel && (r.lifecycle === 'running' || r.lifecycle === 'partial' || r.lifecycle === 'launching'));
}

/** States that say nothing of OpenRig being there: not installed, a Ledge that does not know it, a machine out of reach. */
const NOT_THERE: ReadonlySet<OpenRigStatus['state']> = new Set(['absent', 'unsupported', 'unreachable']);
/** OpenRig is installed somewhere when at least one machine's state is another one (running, stopped, starting, error). */
export const openrigAvailable = (statuses: OpenRigStatus[]): boolean => statuses.some(s => !NOT_THERE.has(s.state));

/** Why the engine cannot be switched now (the text is shown as is), or null. */
export function switchRefusal(from: TeamsEngine, to: TeamsEngine, d: { teams: Team[]; rigs: Rig[]; statuses: OpenRigStatus[] }): string | null {
  if (from === to) return null;
  if (to === 'openrig' && !openrigAvailable(d.statuses)) return "OpenRig n'est installé sur aucune machine : installe-le (npm i -g @openrig/cli) avant de le choisir";
  if (engineRunning(from, d)) return from === 'ledge'
    ? "une équipe Ledge tourne : mets-la au repos ou dissous-la avant de changer de moteur"
    : "un rig OpenRig tourne : arrête-le avant de changer de moteur";
  return null;
}
