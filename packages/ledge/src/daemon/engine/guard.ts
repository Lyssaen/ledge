import { isDecisionEscalationId, LEDGE_GIVER, type ClientMessage, type TeamsEngine } from '@ledge/protocol';

/** Said in Ledge mode to an OpenRig rig command. */
export const ENGINE_LEDGE = "le moteur d'équipes est Ledge : les rigs OpenRig sont coupés (Réglages › Équipes)";
/** Said in OpenRig mode to `ledge team` and `ledge task`. */
export const ENGINE_OPENRIG = "le moteur d'équipes est OpenRig : ledge team et ledge task sont coupés (Réglages › Équipes)";

/** OpenRig's commands, off in Ledge mode. `rig.exchanges.request` only reads: the daemon answers it empty there. */
const RIG_COMMANDS: ReadonlySet<string> = new Set<ClientMessage['type']>(['rig.act', 'rig.prepare', 'rig.launch', 'rig.adopt', 'rig.send', 'escalation.answer']);
/** Ledge's team and task commands, off in OpenRig mode; `team.dissolve` and `team.leave` always end a team or a seat. */
const TEAM_COMMANDS: ReadonlySet<string> = new Set<ClientMessage['type']>(['team.launch', 'team.join', 'team.resume', 'team.compose', 'team.seat', 'team.save', 'task.cmd']);
const ALWAYS: ReadonlySet<string> = new Set(['team.dissolve', 'team.leave']);

/** A registry action (or a rig one) this engine runs: the chat proposes only these, `action.run` refuses the others. */
export function actionAllowed(engine: TeamsEngine, id: string): boolean {
  if (engine === 'ledge') return !id.startsWith('rig.');
  return ALWAYS.has(id) || !(id.startsWith('team.') || id.startsWith('task.'));
}

/** Ledge's own escalations (its asks, `ask-…`, and its leads' decisions, `task-…`) are answered without OpenRig, in either mode. */
const ledgeEscalation = (id: string) => id.startsWith('ask-') || isDecisionEscalationId(id);
/** A Ledge team as the Rigs tab shows it (task 4): its id is the team's. */
const ledgeTeamRig = (rigId: string | undefined) => rigId?.startsWith('team-') === true;

/** What Ledge itself does on its tasks that only reads or tidies (the fleet's list, a card's show, « À toi »'s dismissal). */
export const LEDGE_TASK_READS: ReadonlySet<Extract<ClientMessage, { type: 'task.cmd' }>['op']> = new Set(['list', 'show', 'seen']);

/** Why the engine in force refuses this message (the text is shown as is), or null. */
export function engineRefusal(engine: TeamsEngine, msg: ClientMessage, mirrored?: (taskId: string) => boolean): string | null {
  if (engine === 'ledge') {
    if (msg.type === 'escalation.answer' && ledgeEscalation(msg.id)) return null;
    if (msg.type === 'rig.act' && ledgeTeamRig(msg.rigId)) return null;
    return RIG_COMMANDS.has(msg.type) ? ENGINE_LEDGE : null;
  }
  // A decision a session put to Ledge is Ledge's own, like an ask: answered through its mirrored escalation in either mode.
  if (msg.type === 'action.run' && msg.action === 'task.answer' && typeof msg.args?.task === 'string' && mirrored?.(msg.args.task) === true) return null;
  if (msg.type === 'action.run') return actionAllowed(engine, msg.action) ? null : ENGINE_OPENRIG;
  // Ledge's own reads and housekeeping on its tasks (branch review M3): a result closed under Ledge can still be put away.
  if (msg.type === 'task.cmd' && msg.by === LEDGE_GIVER && LEDGE_TASK_READS.has(msg.op)) return null;
  return TEAM_COMMANDS.has(msg.type) ? ENGINE_OPENRIG : null;
}
