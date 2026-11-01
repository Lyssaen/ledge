import { z } from 'zod';

/** A task's title and detail at most (the detail as a message's text, `MESSAGE_MAX`). */
export const TASK_TITLE_MAX = 200;
export const TASK_TEXT_MAX = 20000;

/** The giver of a task given by the user through Ledge (the chat's card, a front): never a session id. */
export const LEDGE_GIVER = 'ledge';

/** What a task's log entry records: a hand-over (`give`, `pass`, `done`, `refuse`, `cancel` by its giver) or a change on one side (`take`, `drop`). */
export const TASK_OPS = ['give', 'take', 'pass', 'done', 'refuse', 'cancel', 'drop'] as const;
export type TaskOp = typeof TASK_OPS[number];
/** The ops that hand a task from one side to the other: the fronts draw them as messages are (issue #92). */
export const TRANSMISSION_OPS = ['give', 'pass', 'done', 'refuse', 'cancel'] as const;
export type TransmissionOp = typeof TRANSMISSION_OPS[number];

/** One line of a task's journal. `op`, `from` and `to` (session ids, or `ledge`), with their names then, say what was
 *  handed to whom, so a front never reads the French `what`; `note` is a pass's. A journal written before them has none. */
export const TaskLogEntrySchema = z.object({
  at: z.string(), by: z.string(), what: z.string(),
  op: z.enum(TASK_OPS).optional(), from: z.string().optional(), to: z.string().optional(),
  fromName: z.string().optional(), toName: z.string().optional(), note: z.string().optional()
});
export type TaskLogEntry = z.infer<typeof TaskLogEntrySchema>;

/** A piece of work one session gives another (spec 2026-10-25 session tasks): `giver` and `owner` are session ids,
 *  their names as they were then, or `ledge` for a task the user gave through Ledge (roles spec §3.7); `open` until its owner takes it, closed by `done`, `refused` or `dropped` (the owner
 *  ended with it). `log` keeps the passes and the closes. */
export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string().optional(),
  giver: z.string(), giverName: z.string(),
  owner: z.string(), ownerName: z.string(),
  state: z.enum(['open', 'taken', 'done', 'refused', 'dropped']),
  result: z.string().optional(),
  /** The live team its owner sat in when it was given (or passed), so a team's tasks can be listed. */
  team: z.string().optional(),
  /** A task Ledge gave and the user put away from « À toi » once closed. */
  seen: z.boolean().optional(),
  at: z.string(), updatedAt: z.string(),
  log: z.array(TaskLogEntrySchema)
});
export type Task = z.infer<typeof TaskSchema>;

/** A hand-over of a task, from its log: `index` is the entry's place in `log`. */
export interface TaskTransmission { index: number; at: string; op: TransmissionOp; from: string; to: string; fromName: string; toName: string; note?: string }
const handOver = (op: TaskOp | undefined): op is TransmissionOp => (TRANSMISSION_OPS as readonly string[]).includes(op ?? '');
/** The task's hand-overs, in log order: the entries with a transmission op and both sides. */
export function transmissions(t: Task): TaskTransmission[] {
  return t.log.flatMap((e, index) => handOver(e.op) && e.from !== undefined && e.to !== undefined
    ? [{ index, at: e.at, op: e.op, from: e.from, to: e.to, fromName: e.fromName ?? '', toName: e.toName ?? '', ...(e.note !== undefined ? { note: e.note } : {}) }] : []);
}
export type TaskState = Task['state'];
export const givenByLedge = (t: Pick<Task, 'giver'>): boolean => t.giver === LEDGE_GIVER;
export const taskClosed = (t: Pick<Task, 'state'>): boolean => t.state === 'done' || t.state === 'refused' || t.state === 'dropped';
/** A decision a session put to the user (`ledge task give ledge …`), not answered yet: an item of « À toi » on every front. */
export const openDecision = (t: Pick<Task, 'owner' | 'state'>): boolean => t.owner === LEDGE_GIVER && !taskClosed(t);

/** `ledge task …`, as its session `by`; a front (Desktop, the TUI, the phone, the chat's card) gives as `ledge`.
 *  `cancel`: by its giver, or by Ledge for any task. `seen` (Ledge only) puts a closed task of Ledge's away from « À toi ». `team` filters a `list`; `qid` and `row` name
 *  the chat's task card a `give` comes from, which then follows its task. */
export const TaskCmdSchema = z.object({
  type: z.literal('task.cmd'), rid: z.string().min(1), by: z.string().min(1),
  op: z.enum(['give', 'take', 'done', 'refuse', 'pass', 'show', 'list', 'seen', 'cancel']),
  task: z.string().min(1).max(40).optional(), to: z.string().min(1).optional(),
  title: z.string().min(1).max(TASK_TITLE_MAX).optional(), text: z.string().max(TASK_TEXT_MAX).optional(), all: z.boolean().optional(),
  team: z.string().min(1).max(40).optional(), qid: z.string().min(1).optional(), row: z.number().int().min(0).max(7).optional()
});
/** Every change of every task, to every local front (issue #92); a task Ledge gave never has its outcome typed into a terminal (roles spec §3.7). */
export const TaskUpdatedSchema = z.object({ type: z.literal('task.updated'), task: TaskSchema });
/** The answer to a `task.cmd`: the task it changed or showed, the list, or why it was refused. */
export const TaskResultSchema = z.object({
  type: z.literal('task.result'), rid: z.string(), task: TaskSchema.optional(), tasks: z.array(TaskSchema).optional(), reason: z.string().optional()
});
