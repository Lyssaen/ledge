import { useTeamsEngine, type DaemonClient, type TeamsEngineState } from '@ledge/fleet';
import type { Project, Projects, TeamsEngine } from '@ledge/protocol';
import type { NavAction } from '../nav/state';

/** The teams engine in force, as the local daemon says it (lot D). A daemon that never says (before lot D) ran OpenRig's rigs. */
export const engineOf = (state: TeamsEngineState | null): TeamsEngine => state?.engine ?? 'openrig';
export const useEngine = (client: DaemonClient): TeamsEngine => engineOf(useTeamsEngine(client));
/** « Lancer une équipe » of the « Équipes » tab and of the sidebar (lot F, Review Focus 3): Ledge's team form, with its objective, or
 *  OpenRig's launch by plan. */
export const launchTeam = (engine: TeamsEngine): NavAction => ({ type: 'modal', modal: engine === 'ledge' ? { kind: 'launch', team: true } : { kind: 'rig-launch' } });
/** The project a team form opens on (lot F): the one asked for (a room, the catalog), or, when none is asked for, the first one with a
 *  local folder (« Lancer une équipe » of the « Équipes » tab and of the sidebar). A stale id finds nothing: the form never opens on
 *  another project than the one asked for. */
export const teamRoom = (projects: Projects | null, wanted: string | undefined): Project | undefined =>
  wanted !== undefined ? projects?.projects.find(x => x.id === wanted) : projects?.projects.find(x => x.repos.some(r => r.machine === 'local'));
