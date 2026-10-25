import { z } from 'zod';

/** A task's title and detail at most (the detail as a message's text, `MESSAGE_MAX`). */
export const TASK_TITLE_MAX = 200;
export const TASK_TEXT_MAX = 20000;

/** A piece of work one session gives another (spec 2026-10-25 session tasks): `giver` and `owner` are session ids,
 *  their names as they were then; `open` until its owner takes it, closed by `done`, `refused` or `dropped` (the owner
 *  ended with it). `log` keeps the passes and the closes. */
export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string().optional(),
  giver: z.string(), giverName: z.string(),
  owner: z.string(), ownerName: z.string(),
  state: z.enum(['open', 'taken', 'done', 'refused', 'dropped']),
  result: z.string().optional(),
  at: z.string(), updatedAt: z.string(),
  log: z.array(z.object({ at: z.string(), by: z.string(), what: z.string() }))
});
export type Task = z.infer<typeof TaskSchema>;
export type TaskState = Task['state'];
export const taskClosed = (t: Pick<Task, 'state'>): boolean => t.state === 'done' || t.state === 'refused' || t.state === 'dropped';

/** `ledge task …`, as its session `by`. */
export const TaskCmdSchema = z.object({
  type: z.literal('task.cmd'), rid: z.string().min(1), by: z.string().min(1),
  op: z.enum(['give', 'take', 'done', 'refuse', 'pass', 'show', 'list']),
  task: z.string().min(1).max(40).optional(), to: z.string().min(1).optional(),
  title: z.string().min(1).max(TASK_TITLE_MAX).optional(), text: z.string().max(TASK_TEXT_MAX).optional(), all: z.boolean().optional()
});
/** The answer to a `task.cmd`: the task it changed or showed, the list, or why it was refused. */
export const TaskResultSchema = z.object({
  type: z.literal('task.result'), rid: z.string(), task: TaskSchema.optional(), tasks: z.array(TaskSchema).optional(), reason: z.string().optional()
});
