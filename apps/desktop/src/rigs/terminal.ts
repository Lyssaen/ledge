import type { DaemonClient } from '@ledge/fleet';
import type { Rig, RigSeat, Session } from '@ledge/protocol';
import { openSessionTerminal } from '../session/terminal';
import { openTerminal } from '../tauri/bridge';

/** « … › Terminaux › {siège} »: a seat paired with a Ledge session that has a terminal opens it; any other seat (or one whose session terminal fails) attaches to its OpenRig
 *  tmux session (`ref`) on the rig's machine, in a tab titled « {rig} · {siège} ». False when nothing could be opened. */
export async function openSeatTerminal(client: DaemonClient, rig: Rig, seat: RigSeat, byId: ReadonlyMap<string, Session>): Promise<boolean> {
  const paired = seat.sessionId ? byId.get(seat.sessionId) : undefined;
  // A hook_only session (what an OpenRig seat pairs with) has no tmux session of Ledge's: only the seat's own command can open it.
  if (paired && (paired.tmuxSession || paired.source !== 'hook_only') && await openSessionTerminal(client, paired)) return true;
  const command = client.fleet?.seatTerminal(rig.machine, seat.ref) ?? null;
  return command ? openTerminal(`${rig.name} · ${seat.name}`, command) : false;
}
