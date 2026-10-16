import type { Session } from '@ledge/protocol';
import type { DaemonClient } from '@ledge/fleet';
import { focusTerminal, openTerminal } from '../tauri/bridge';

/** « Ouvrir le terminal » (spec §9.1, island Surface `focusTab` / `openTab`): the session hears it is focused; a remote session
 *  opens a tab titled with its machine running the fleet's command; a local one is first looked for by title, then opened.
 *  False when nothing could be shown (and always for a frozen session, spec §14). */
export async function openSessionTerminal(client: DaemonClient, s: Session): Promise<boolean> {
  if (s.offline) return false;
  client.send({ type: 'session.focus', id: s.id });
  const command = client.fleet?.terminal(s.id) ?? null;
  const canOpen = !!command && !!s.tmuxSession;
  if (s.machineId && s.machineId !== 'local') return canOpen ? openTerminal(`${s.machineName ?? s.machineId} · ${s.title}`, command!) : false;
  if (await focusTerminal(s.title)) return true;
  return canOpen ? openTerminal(s.title, command!) : false;
}
