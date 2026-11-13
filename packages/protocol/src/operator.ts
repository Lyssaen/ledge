import { z } from 'zod';
import { ChatActionSchema } from './chat.js';

/** Every kind of event the operator journal records; a point is built from the unread ones. */
export const OPERATOR_EVENT_KINDS = ['session.request', 'session.question', 'session.finished', 'session.error', 'session.exited',
  'session.context_full', 'request.settled', 'task.opened', 'task.closed', 'task.stale', 'decision.asked', 'brain.proposed',
  'rig.ask', 'rig.seat_unreachable', 'rig.state', 'rig.goal_update', 'forge.pipeline_failed', 'forge.merged'] as const;
export type OperatorEventKind = typeof OPERATOR_EVENT_KINDS[number];

export const PointGroupSchema = z.enum(['atoi', 'done', 'ongoing', 'rigs']);
export type PointGroup = z.infer<typeof PointGroupSchema>;

/** What a point row answers to: decisions and brain proposals are tasks. `key` of a session request is `pendingKey(pending)`. */
export const PointRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session.request'), session: z.string(), key: z.string() }),
  z.object({ kind: z.literal('rig.ask'), qitem: z.string() }),
  z.object({ kind: z.literal('task'), task: z.string() })
]);
export type PointRef = z.infer<typeof PointRefSchema>;

/** One row of a point. `id` is always `${subjectKind}:${subjectId}` (for instance `session.request:7f3a`), so a row is matched
 *  across successive points by it; `event` is the journal event it was built from. The suggestion is lazy because `chat.ts`
 *  and this file import each other. */
export const PointItemSchema = z.object({
  id: z.string(), event: z.number().int(), group: PointGroupSchema,
  tone: z.enum(['perm', 'ask', 'work', 'idle', 'off']), who: z.string().max(100), rig: z.string().max(100).optional(),
  text: z.string().max(400), sub: z.string().max(200).optional(), at: z.string().datetime(),
  ref: PointRefSchema.optional(),
  answers: z.array(z.object({ id: z.string(), label: z.string().max(60), style: z.enum(['primary', 'danger', 'plain']) })).max(4).optional(),
  freeText: z.boolean().optional(),
  nav: z.array(z.object({ kind: z.enum(['session', 'pr', 'rig', 'task']), id: z.string() })).max(2).optional(),
  suggestion: z.lazy(() => ChatActionSchema).optional(),
  settled: z.object({ at: z.string().datetime(), where: z.enum(['terminal', 'phone', 'desktop', 'chat', 'elsewhere']), answer: z.string().max(60).optional() }).optional(),
  error: z.string().max(200).optional()
});
export type PointItem = z.infer<typeof PointItemSchema>;

/** The point Ledge writes as a chat turn: a lead sentence and its rows. */
export const ChatPointSchema = z.object({
  since: z.string().datetime(), lead: z.string().max(300), leadBy: z.enum(['agent', 'daemon']),
  items: z.array(PointItemSchema).max(40), foldedAt: z.string().datetime().optional(), laterAt: z.string().datetime().optional()
});
export type ChatPoint = z.infer<typeof ChatPointSchema>;

/** A short notice the notch and the phone show about a point or a rig question. */
export const OperatorNoticeSchema = z.object({
  /** `decision`: a decision a session put to the user (a task given to Ledge), said at once; its `id` is `decision:<task id>`. */
  id: z.string(), kind: z.enum(['point', 'rig.ask', 'decision']), qid: z.string().optional(),
  text: z.string().max(300), who: z.string().max(100).optional(), rig: z.string().optional(), qitem: z.string().optional(),
  options: z.array(z.object({ id: z.string(), label: z.string().max(60) })).max(3).optional(),
  priority: z.enum(['routine', 'urgent', 'critical']), at: z.string().datetime()
});
export type OperatorNotice = z.infer<typeof OperatorNoticeSchema>;

/** The answer of `point.act`: a listed option, or free text. */
export const PointAnswerSchema = z.union([z.object({ id: z.string().min(1) }).strict(), z.object({ text: z.string().min(1).max(4000) }).strict()]);
export type PointAnswer = z.infer<typeof PointAnswerSchema>;
