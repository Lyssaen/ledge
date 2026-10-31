import type { DaemonClient } from '@ledge/fleet';
import type { Rig, RigSeat, Session } from '@ledge/protocol';
import { openSessionTerminal } from '../session/terminal';
import { openTerminal } from '../tauri/bridge';

/** « … › Terminaux › {siège} »: a seat paired with a Ledge session opens that session's terminal; any other seat attaches to its OpenRig
 *  tmux session (`ref`) on the rig's machine, in a tab titled « {rig} · {siège} ». False when nothing could be opened. */
export async function openSeatTerminal(client: DaemonClient, rig: Rig, seat: RigSeat, byId: ReadonlyMap<string, Session>): Promise<boolean> {
  const paired = seat.sessionId ? byId.get(seat.sessionId) : undefined;
  if (paired) return openSessionTerminal(client, paired);
  const command = client.fleet?.seatTerminal(rig.machine, seat.ref) ?? null;
  return command ? openTerminal(`${rig.name} · ${seat.name}`, command) : false;
}
