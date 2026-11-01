import { z } from 'zod';
import { EXCHANGES_MAX, THREAD_PAGE, MandateCategorySchema, RigLifecycleSchema, SeatStateSchema } from './openrig.js';
import { AssertionSchema, PhoneChatActionSchema } from './phone.js';
const id = z.string().min(1).max(120);
const key = z.string().min(1).max(64);
const at = z.string().datetime();
const op = z.string().uuid();
const messageMax = 20_000;
const toolTextMax = 2_048;
export const PhoneRigSeatSchema = z.object({ ref: id, address: id, name: z.string().max(80), runtime: z.string().max(80), model: z.string().max(120).optional(), state: SeatStateSchema, contextPct: z.number().min(0).max(100).optional(), sessionId: id.optional() }).strict();
export const PhoneRigSchema = z.object({ key, name: z.string().max(80), spec: z.string().max(80).optional(), project: z.string().max(80).nullable(), offProject: z.boolean(), branch: z.string().max(200).optional(), lifecycle: RigLifecycleSchema, kernel: z.boolean(), seats: z.array(PhoneRigSeatSchema).max(16), repos: z.number().int().nonnegative(), launch: z.object({ planId: id, goal: z.string().max(600), lead: id, startedAt: at, goalSentAt: at.optional(), lateNotice: z.literal(true).optional() }).strict().optional() }).strict();
export type PhoneRig = z.infer<typeof PhoneRigSchema>;
export const PhoneExchangeSchema = z.object({ id, rigKey: key, from: id, to: id, kind: z.enum(['message', 'task', 'handoff', 'ledge']), text: z.string().max(toolTextMax), at, cut: z.literal(true).optional() }).strict();
export type PhoneExchange = z.infer<typeof PhoneExchangeSchema>;
const PhoneQuestionSchema = z.object({ id, question: z.string().max(toolTextMax), options: z.array(z.object({ id, label: z.string().max(200), recommended: z.boolean().optional() }).strict()).min(2).max(4) }).strict();
export const PhoneEscalationSchema = z.object({ id, source: z.enum(['rig', 'operator', 'ask']), rigKey: key.optional(), rigName: z.string().max(60).optional(), from: id, intent: z.enum(['decision', 'update']), summary: z.string().max(toolTextMax), detail: z.string().max(toolTextMax).optional(), questions: z.array(PhoneQuestionSchema).max(4), createdAt: at, state: z.enum(['pending', 'grace', 'answered', 'closed']), graceUntil: at.optional(), correcting: id.optional(), category: MandateCategorySchema.optional(), advice: z.string().max(toolTextMax).optional(), rules: z.array(z.object({ text: z.string().max(200), since: z.string().max(10) }).strict()).max(5).optional(), answer: z.object({ by: z.enum(['ledge', 'user']), answers: z.record(z.string().max(120), z.string().max(messageMax)), at, rule: id.optional(), delivery: z.enum(['queued', 'sent']).optional() }).strict().optional() }).strict();
export type PhoneEscalation = z.infer<typeof PhoneEscalationSchema>;
export const PhoneLedgeDecisionSchema = z.object({ id, escalationId: id, by: z.enum(['ledge', 'user']), category: MandateCategorySchema.optional(), summary: z.string().max(toolTextMax), answers: z.record(z.string().max(120), z.string().max(messageMax)), rule: id.optional(), from: id.optional(), rigName: z.string().max(60).optional(), why: z.string().max(toolTextMax).optional(), at, revisitedBy: id.optional() }).strict();
export type PhoneLedgeDecision = z.infer<typeof PhoneLedgeDecisionSchema>;
export const PhoneRigPlanSchema = z.object({ id, spec: z.string().max(80), goal: z.string().max(600), where: z.discriminatedUnion('kind', [z.object({ kind: z.literal('project'), project: z.string().max(80), branch: z.string().max(200), copy: z.boolean() }).strict(), z.object({ kind: z.literal('off-project'), name: z.string().max(80) }).strict()]), seats: z.array(z.object({ address: id, runtime: z.string().max(80), model: z.string().max(120).optional(), autonomy: z.string().max(80) }).strict()).max(16), writes: z.array(z.string().max(200)).max(40), required: z.boolean(), launchedRigKey: key.optional(), launchedAt: at.optional() }).strict();
export type PhoneRigPlan = z.infer<typeof PhoneRigPlanSchema>;
export const PhoneThreadItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), id, at, text: z.string().max(toolTextMax), to: id.optional(), qid: id.optional() }).strict(),
  z.object({ kind: z.literal('ledge'), id, at, text: z.string().max(toolTextMax), qid: id.optional(), pending: z.literal(true).optional() }).strict(),
  z.object({ kind: z.literal('escalation'), id, at, escalation: PhoneEscalationSchema }).strict(),
  z.object({ kind: z.literal('decided'), id, at, decision: PhoneLedgeDecisionSchema }).strict(),
  z.object({ kind: z.literal('exchanges'), id, at, rigKey: key, rigName: z.string().max(60), from: at, to: at, count: z.number().int().min(1), items: z.array(PhoneExchangeSchema).max(20) }).strict(),
  z.object({ kind: z.literal('card'), id, at, action: z.lazy(() => PhoneChatActionSchema) }).strict(),
  z.object({ kind: z.literal('plan'), id, at, plan: PhoneRigPlanSchema }).strict()
]);
export type PhoneThreadItem = z.infer<typeof PhoneThreadItemSchema>;
export const PhoneRigActSchema = z.object({ type: z.literal('rig.act'), op, key, verb: z.enum(['down', 'restart']), seatRef: id.optional(), assertion: z.lazy(() => AssertionSchema).optional() }).strict();
export const PhoneRigLaunchSchema = z.object({ type: z.literal('rig.launch'), op, planId: id, assertion: z.lazy(() => AssertionSchema).optional() }).strict();
export const PhoneEscalationAnswerSchema = z.object({ type: z.literal('escalation.answer'), op, id, answers: z.record(z.string().max(64), z.string().max(messageMax)).refine(value => Object.keys(value).length <= 4) }).strict();
export type PhoneRigAction = z.infer<typeof PhoneRigActSchema> | z.infer<typeof PhoneRigLaunchSchema>;
export const rigSubject = (m: PhoneRigAction): string => m.type === 'rig.launch' ? `launch@${m.planId}` : `${m.verb}@${m.key}${m.seatRef ? `/${m.seatRef}` : ''}`;
export const phoneOpenRigClientMessages = [
  z.object({ type: z.literal('ledge.say'), op, text: z.string().trim().min(1).max(messageMax), about: id.optional() }).strict(),
  z.object({ type: z.literal('ledge.thread.request'), before: id.optional() }).strict(),
  PhoneEscalationAnswerSchema,
  z.object({ type: z.literal('answer.receipt.request'), answer: PhoneEscalationAnswerSchema }).strict(),
  z.object({ type: z.literal('decision.revisit'), op, id, text: z.string().max(messageMax).optional() }).strict(),
  z.object({ type: z.literal('rig.exchanges.request'), key }).strict(),
  z.object({ type: z.literal('rig.prepare'), op, goal: z.string().trim().min(1).max(600), spec: z.string().max(64).optional(), project: z.string().max(80).nullable() }).strict(),
  PhoneRigLaunchSchema, PhoneRigActSchema
] as const;
export const phoneOpenRigServerMessages = [
  z.object({ type: z.literal('answer.receipt'), op, status: z.enum(['received', 'applied', 'unknown']) }).strict(),
  z.object({ type: z.literal('rig.updated'), rig: PhoneRigSchema }).strict(),
  z.object({ type: z.literal('rig.removed'), key }).strict(),
  z.object({ type: z.literal('rig.exchanges'), key, items: z.array(PhoneExchangeSchema).max(EXCHANGES_MAX), cut: z.literal(true).optional() }).strict(),
  z.object({ type: z.literal('escalation.updated'), escalation: PhoneEscalationSchema }).strict(),
  z.object({ type: z.literal('escalation.removed'), id }).strict(),
  z.object({ type: z.literal('ledge.thread.item'), item: PhoneThreadItemSchema }).strict(),
  z.object({ type: z.literal('ledge.thread.history'), items: z.array(PhoneThreadItemSchema).max(THREAD_PAGE), before: id.optional() }).strict(),
  z.object({ type: z.literal('decisions'), items: z.array(PhoneLedgeDecisionSchema).max(50) }).strict(),
  z.object({ type: z.literal('rig.plan'), plan: PhoneRigPlanSchema }).strict()
] as const;
