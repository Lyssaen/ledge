import { useCallback, useEffect, useRef, useState } from 'react';
import { LEDGE_GIVER, type ChatTurn, type ClientMessage, type ServerMessage } from '@ledge/protocol';

export interface TeamCards {
  /** The turn whose team card is being launched, the task row being given. */
  teamBusy: string | null; taskBusy: { qid: string; row: number } | null;
  launchTeam(qid: string): void; saveTeam(qid: string): void; giveTask(qid: string, row: number): void;
}

/** A card waits this long for the daemon's answer, then is freed (the card's own state, from the history, says the rest). */
const ANSWER_MS = 60_000;
let seq = 0;

/** The chat's team and task cards (roles spec §3.8), one action at a time: « Lancer l'équipe » sends `team.launch { qid }`,
 *  « Enregistrer » `team.save`, « Confier » `task.cmd { by: ledge, op: give, qid, row }`. A card is freed by its answer
 *  (`team.launched`, `team.failed`, `team.saved`, `task.result`); its outcome comes back on the turn, through the history. */
export function useTeamCards(o: { send(m: ClientMessage): void; onMessage(fn: (m: ServerMessage) => void): () => void; chat: readonly ChatTurn[] }): TeamCards {
  const [teamBusy, setTeamBusy] = useState<string | null>(null);
  const [taskBusy, setTaskBusy] = useState<{ qid: string; row: number } | null>(null);
  const waiting = useRef<{ rid: string; free(): void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const chat = useRef(o.chat);
  chat.current = o.chat;
  const { send, onMessage } = o;
  useEffect(() => onMessage(m => {
    const w = waiting.current;
    if (!w || !('rid' in m) || m.rid !== w.rid) return;
    if (m.type === 'team.launched' || m.type === 'team.failed' || m.type === 'team.saved' || m.type === 'task.result') { clearTimeout(w.timer); waiting.current = null; w.free(); }
  }), [onMessage]);
  useEffect(() => () => { if (waiting.current) clearTimeout(waiting.current.timer); }, []);
  const start = (free: () => void): string | null => {
    if (waiting.current) return null;
    const rid = `card-${Date.now()}-${++seq}`;
    waiting.current = { rid, free, timer: setTimeout(() => { waiting.current = null; free(); }, ANSWER_MS) };
    return rid;
  };
  const launchTeam = useCallback((qid: string) => {
    const rid = start(() => setTeamBusy(null)); if (!rid) return;
    setTeamBusy(qid);
    send({ type: 'team.launch', rid, qid });
  }, [send]);
  const saveTeam = useCallback((qid: string) => {
    const team = chat.current.find(t => t.qid === qid)?.team;
    if (!team) return;
    const rid = start(() => {}); if (!rid) return;
    send({ type: 'team.save', rid, qid, name: team.name, seats: team.seats.map(s => ({ role: s.role, ...(s.tool ? { tool: s.tool } : {}), ...(s.model ? { model: s.model } : {}), ...(s.effort ? { effort: s.effort } : {}), ...(s.name ? { name: s.name } : {}) })) });
  }, [send]);
  const giveTask = useCallback((qid: string, row: number) => {
    const rid = start(() => setTaskBusy(null)); if (!rid) return;
    setTaskBusy({ qid, row });
    send({ type: 'task.cmd', rid, by: LEDGE_GIVER, op: 'give', qid, row });
  }, [send]);
  return { teamBusy, taskBusy, launchTeam, saveTeam, giveTask };
}
