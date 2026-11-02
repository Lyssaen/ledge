import { useTeamsEngine, type DaemonClient, type MachineState, type TeamsEngineState } from '@ledge/fleet';
import type { OpenRigStatus, Project, Projects, Rig, Session, Team, TeamsEngine } from '@ledge/protocol';
import { isStandalone, rigFilter } from '@ledge/ui/rigs/model';
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

/** The engine's name on a plate (« Équipes · Ledge », « Équipes · OpenRig »). */
export const engineName = (engine: TeamsEngine): string => (engine === 'ledge' ? 'Ledge' : 'OpenRig');

/** A bay of the Bureaux' tech room (spec §6.6): a machine and its LED. */
export type Core = { machine: string; state: 'running' | 'starting' | 'unreachable' | 'stopped' };
/** OpenRig's state of a machine as a bay's LED: absent, refused or in error is off as when stopped; no word from it, unreachable. */
const coreOf = (s: OpenRigStatus | undefined): Core['state'] =>
  !s || s.state === 'unreachable' ? 'unreachable' : s.state === 'running' || s.state === 'starting' ? s.state : 'stopped';
/** The bays of the tech room, the active engine's (spec §6.6): in Ledge mode one per machine of the fleet, lit while its daemon is
 *  linked and ready; in OpenRig mode one per kernel, with OpenRig's state of its machine, as before lot F. */
export function techCores(engine: TeamsEngine, rigs: readonly Rig[], openrig: readonly OpenRigStatus[], machines: readonly MachineState[]): Core[] {
  if (engine === 'ledge') return machines.map(m => ({ machine: m.id, state: m.status === 'open' && m.ready ? 'running' : 'unreachable' }));
  return rigs.filter(r => r.kernel).map(r => ({ machine: r.machine, state: coreOf(openrig.find(s => s.machine === r.machine)) }));
}

/** The atelier's filter on a team's own room (lot F): its projected rig `team-…`, on the machine the fleet lists it, else the local one
 *  (a Ledge team lives on its machine). The chat's team card opens it. */
export const teamRoomFilter = (rigs: readonly Rig[], teamId: string): string =>
  rigFilter(rigs.find(r => r.id === teamId && r.engine === 'ledge') ?? { machine: 'local', id: teamId });

/** The live Ledge team a room or a card may add a session to (lot F final review I5): one of the local daemon's (`team.join` goes
 *  there), active (not at rest). */
export const joinableTeam = (rig: Rig, teams: readonly Team[] | null | undefined): Team | undefined =>
  rig.engine === 'ledge' && rig.machine === 'local' && rig.lifecycle !== 'stopped' && rig.lifecycle !== 'unreachable'
    ? teams?.find(x => x.id === rig.id && x.state === 'active') : undefined;

/** The sessions « Ajouter une session… » offers a Ledge team (lot F final review I5): its project's standalone sessions on its machine
 *  (off any project: those of its folder), live, launched by Ledge, in no team. */
export const joinCandidates = (rig: Rig, sessions: readonly Session[], rigs: readonly Rig[], projectIdOf: (s: Session) => string | null): Session[] =>
  sessions.filter(s => (s.machineId ?? 'local') === rig.machine && !s.team && !s.offline && s.state !== 'exited' && !s.archivedAt && s.source !== 'hook_only'
    && isStandalone(s, rigs) && (rig.projectId !== null ? projectIdOf(s) === rig.projectId : projectIdOf(s) === null && (s.cwd === rig.cwd || s.cwd.startsWith(`${rig.cwd}/`))));
