import { LEDGE_GIVER, type PhoneTask } from '@ledge/protocol';

/** A task Ledge gave that came to an end: done, refused or dropped. */
export const taskClosed = (t: PhoneTask): boolean => t.state === 'done' || t.state === 'refused' || t.state === 'dropped';

/** A decision a session put to the user (`ledge task give ledge …`): its owner is Ledge, never one of Ledge's own tasks. */
export const isDecision = (t: PhoneTask): boolean => t.owner === LEDGE_GIVER;

/** A task Ledge gave: a PC that predates `giver` sent only those. */
const givenByLedge = (t: PhoneTask): boolean => (t.giver ?? LEDGE_GIVER) === LEDGE_GIVER && !isDecision(t);

/** The decisions not answered yet, the oldest first: items of « À toi », answered through the chat's card. */
export function openDecisions(tasks: Iterable<PhoneTask>): PhoneTask[] {
  return [...tasks].filter(t => isDecision(t) && !taskClosed(t)).sort((a, b) => a.at.localeCompare(b.at));
}

/** The closed tasks of Ledge not put away yet, the oldest first: items of « À toi » and « À traiter ». */
export function closedTasks(tasks: Iterable<PhoneTask>): PhoneTask[] {
  return [...tasks].filter(t => givenByLedge(t) && taskClosed(t) && !t.seen).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

/** The open tasks of Ledge, the latest first: « Confiées par Ledge ». */
export function openTasks(tasks: Iterable<PhoneTask>): PhoneTask[] {
  return [...tasks].filter(t => givenByLedge(t) && !taskClosed(t)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
