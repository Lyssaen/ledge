import type { Escalation, Task } from '@ledge/protocol';

/** The id prefix of a decision task mirrored as an escalation (lot E): `task-<taskId>`, with `source: 'ask'` (no new wire literal). */
export const TASK_ESCALATION = 'task-';
export const taskEscalation = (id: string): boolean => id.startsWith(TASK_ESCALATION);

/** An open decision task (`ledge task give ledge "<question>" "<options>"`, owner `ledge`) as an escalation of Ledge's own:
 *  `rigId` = the asker's team (a lone session has none), `from` = its name, the options in `detail`. */
export function decisionToEscalation(t: Task, ctx: { machine: string }): Escalation {
  return { id: `${TASK_ESCALATION}${t.id}`, source: 'ask', machine: ctx.machine, ...(t.team ? { rigId: t.team } : {}), from: t.giverName, intent: 'decision',
    summary: t.title, ...(t.text ? { detail: t.text } : {}), questions: [], createdAt: t.at, state: 'pending' };
}
