import { decisionEscalationId, type Escalation, type Task } from '@ledge/protocol';

// The `task-<taskId>` id of a decision task mirrored as an escalation (lot E, `source: 'ask'`) is defined once, in @ledge/protocol.

/** An open decision task (`ledge task give ledge "<question>" "<options>"`, owner `ledge`) as an escalation of Ledge's own:
 *  `rigId` = the asker's team (a lone session has none), `from` = its name, the options in `detail`. */
export function decisionToEscalation(t: Task, ctx: { machine: string }): Escalation {
  return { id: decisionEscalationId(t.id), source: 'ask', machine: ctx.machine, ...(t.team ? { rigId: t.team } : {}), from: t.giverName, intent: 'decision',
    summary: t.title, ...(t.text ? { detail: t.text } : {}), questions: [], createdAt: t.at, state: 'pending' };
}
