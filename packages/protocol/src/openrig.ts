import { z } from 'zod';
import { ChatActionSchema } from './chat.js';

/** Mandate categories (spec §5.3): Ledge may settle the first four alone, never the last three. */
export const MandateCategorySchema = z.enum(['git', 'tests', 'context', 'code', 'design', 'architecture', 'critical']);
export type MandateCategory = z.infer<typeof MandateCategorySchema>;
export const ALWAYS_USER: readonly MandateCategory[] = ['design', 'architecture', 'critical'];

export const OpenRigStateSchema = z.enum(['absent', 'stopped', 'starting', 'running', 'unsupported', 'error', 'unreachable']); // unreachable: remote machine (lot 6)
export type OpenRigState = z.infer<typeof OpenRigStateSchema>;
export const OpenRigStatusSchema = z.object({ machine: z.string(), state: OpenRigStateSchema, version: z.string().optional(),
  human: z.enum(['registered', 'missing', 'failed']).optional(), detail: z.string().optional(),
  install: z.string().optional() }); // install command when OpenRig is absent (lot 6)
export type OpenRigStatus = z.infer<typeof OpenRigStatusSchema>;

export const SeatStateSchema = z.enum(['starting', 'trust', 'ready', 'working', 'idle', 'stopped', 'crashed', 'unreachable']);
export type SeatState = z.infer<typeof SeatStateSchema>;
export const RigSeatSchema = z.object({ ref: z.string(), // OpenRig session name: "dev-build@starter"
  address: z.string(), // "@build"
  name: z.string(), runtime: z.string(), model: z.string().optional(), state: SeatStateSchema,
  contextPct: z.number().min(0).max(100).optional(), sessionId: z.string().optional() }); // id of the paired Ledge session
export type RigSeat = z.infer<typeof RigSeatSchema>;

export const RigRepoSchema = z.object({ path: z.string(), name: z.string(), branch: z.string().optional(), remote: z.string().optional(),
  modified: z.number().int().min(0), by: z.string().optional(), how: z.enum(['cloned', 'opened', 'created']).optional() });
export type RigRepo = z.infer<typeof RigRepoSchema>;

export const RigLifecycleSchema = z.enum(['launching', 'running', 'partial', 'stopped', 'unreachable']);
export type RigLifecycle = z.infer<typeof RigLifecycleSchema>;
export const RigSchema = z.object({ id: z.string(), name: z.string(), machine: z.string(), spec: z.string().optional(),
  cwd: z.string(), projectId: z.string().nullable(), offProject: z.boolean(), branch: z.string().optional(),
  lifecycle: RigLifecycleSchema, kernel: z.boolean(), seats: z.array(RigSeatSchema), repos: z.array(RigRepoSchema) });
export type Rig = z.infer<typeof RigSchema>;

export const EscalationQuestionSchema = z.object({ id: z.string(), question: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string(), recommended: z.boolean().optional() })).min(2).max(4) });
export type EscalationQuestion = z.infer<typeof EscalationQuestionSchema>;
export const EscalationStateSchema = z.enum(['pending', 'grace', 'answered', 'closed']);
export type EscalationState = z.infer<typeof EscalationStateSchema>;
export const EscalationSchema = z.object({ id: z.string(), // OpenRig qitemId, or "ask-<id>" for `ledge ask`
  source: z.enum(['rig', 'operator', 'ask']), machine: z.string(), rigId: z.string().optional(),
  from: z.string(), // seat ref, or the Ledge session name for `ask`
  intent: z.enum(['decision', 'update']), summary: z.string(), detail: z.string().optional(), evidenceRef: z.string().optional(),
  questions: z.array(EscalationQuestionSchema).max(4), replyTo: z.string().optional(), createdAt: z.string().datetime(),
  state: EscalationStateSchema, graceUntil: z.string().datetime().optional(),
  category: MandateCategorySchema.optional(), advice: z.string().optional(),
  answer: z.object({ by: z.enum(['ledge', 'user']), answers: z.record(z.string()), at: z.string().datetime(), rule: z.string().optional(),
    delivery: z.enum(['queued', 'sent']).optional() }).optional() }); // delivery: answer waiting on an unreachable machine (lot 6)
export type Escalation = z.infer<typeof EscalationSchema>;

export const ExchangeSchema = z.object({ id: z.string(), machine: z.string(), rigId: z.string(), from: z.string(), to: z.string(),
  kind: z.enum(['message', 'task', 'handoff', 'ledge']), text: z.string(), at: z.string().datetime() });
export type Exchange = z.infer<typeof ExchangeSchema>;
/** The last exchanges kept per rig, in memory only. */
export const EXCHANGES_MAX = 200;

/** Named `Ledge*` because `Decision` / `Rule` already exist in decisions.ts and projects.ts. */
export const LedgeDecisionSchema = z.object({ id: z.string(), escalationId: z.string(), by: z.enum(['ledge', 'user']),
  category: MandateCategorySchema, summary: z.string(), answers: z.record(z.string()), rule: z.string().optional(),
  why: z.string().optional(), at: z.string().datetime(), revisitedBy: z.string().optional() });
export type LedgeDecision = z.infer<typeof LedgeDecisionSchema>;
export const LedgeRuleSchema = z.object({ id: z.string(), text: z.string(), category: MandateCategorySchema, since: z.string(),
  from: z.string(), appliedCount: z.number().int().min(0), status: z.enum(['active', 'proposed']) });
export type LedgeRule = z.infer<typeof LedgeRuleSchema>;

export const LedgeThreadItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), id: z.string(), at: z.string().datetime(), text: z.string(), to: z.string().optional() }), // to = "@build"
  z.object({ kind: z.literal('ledge'), id: z.string(), at: z.string().datetime(), text: z.string() }),
  z.object({ kind: z.literal('escalation'), id: z.string(), at: z.string().datetime(), escalationId: z.string() }),
  z.object({ kind: z.literal('decided'), id: z.string(), at: z.string().datetime(), decisionId: z.string() }),
  z.object({ kind: z.literal('exchanges'), id: z.string(), at: z.string().datetime(), machine: z.string(), rigId: z.string(),
    from: z.string().datetime(), to: z.string().datetime(), exchangeIds: z.array(z.string()) }),
  z.object({ kind: z.literal('card'), id: z.string(), at: z.string().datetime(), action: ChatActionSchema }), // existing action card
]);
export type LedgeThreadItem = z.infer<typeof LedgeThreadItemSchema>;

export const BrainStatusSchema = z.object({ state: z.enum(['off', 'starting', 'on', 'down']), tool: z.string(),
  contextPct: z.number().optional(), sessionId: z.string().optional() });
export type BrainStatus = z.infer<typeof BrainStatusSchema>;

export const RigLaunchWhereSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project'), projectId: z.string(), repo: z.string(), branch: z.string(), copy: z.boolean() }),
  z.object({ kind: z.literal('off-project'), name: z.string() }) ]);
export type RigLaunchWhere = z.infer<typeof RigLaunchWhereSchema>;
export const RigPlanSchema = z.object({ id: z.string(), machine: z.string(), spec: z.string(), goal: z.string(), where: RigLaunchWhereSchema,
  cwd: z.string(), seats: z.array(z.object({ address: z.string(), runtime: z.string(), model: z.string().optional(), autonomy: z.string() })),
  writes: z.array(z.string()), command: z.string(), required: z.boolean() }); // required = imposed plan (real repo, spec §4.6)
export type RigPlan = z.infer<typeof RigPlanSchema>;
export const RigVerbSchema = z.enum(['up', 'down', 'restore', 'restart', 'stop', 'handover']);
export type RigVerb = z.infer<typeof RigVerbSchema>;

/** Codes of a `rig.result` failure. */
export const RIG_RESULT_CODES = ['rig_managed', 'already_answered', 'openrig_down', 'unsupported', 'mandate', 'unreachable', 'failed'] as const;
export const RigResultCodeSchema = z.enum(RIG_RESULT_CODES);
export type RigResultCode = z.infer<typeof RigResultCodeSchema>;

// Server messages.
export const OpenRigStatusMessageSchema = z.object({ type: z.literal('openrig.status'), status: OpenRigStatusSchema });
export const RigSnapshotSchema = z.object({ type: z.literal('rig.snapshot'), machine: z.string(), rigs: z.array(RigSchema) });
export const RigUpdatedSchema = z.object({ type: z.literal('rig.updated'), rig: RigSchema });
export const RigRemovedSchema = z.object({ type: z.literal('rig.removed'), machine: z.string(), rigId: z.string() });
export const RigExchangeSchema = z.object({ type: z.literal('rig.exchange'), exchange: ExchangeSchema });
export const RigExchangesSchema = z.object({ type: z.literal('rig.exchanges'), machine: z.string(), rigId: z.string(), items: z.array(ExchangeSchema) });
export const EscalationUpdatedSchema = z.object({ type: z.literal('escalation.updated'), escalation: EscalationSchema });
export const EscalationRemovedSchema = z.object({ type: z.literal('escalation.removed'), id: z.string() });
export const LedgeThreadItemMessageSchema = z.object({ type: z.literal('ledge.thread.item'), item: LedgeThreadItemSchema });
export const LedgeThreadHistorySchema = z.object({ type: z.literal('ledge.thread.history'), items: z.array(LedgeThreadItemSchema), before: z.string().datetime().optional() });
export const DecisionsMessageSchema = z.object({ type: z.literal('decisions'), items: z.array(LedgeDecisionSchema) });
export const RulesMessageSchema = z.object({ type: z.literal('rules'), items: z.array(LedgeRuleSchema) });
export const MandateMessageSchema = z.object({ type: z.literal('mandate'), text: z.string(), path: z.string() });
export const BrainStatusMessageSchema = z.object({ type: z.literal('brain.status'), status: BrainStatusSchema });
export const RigPlanMessageSchema = z.object({ type: z.literal('rig.plan'), rid: z.string(), plan: RigPlanSchema });
export const RigResultSchema = z.object({ type: z.literal('rig.result'), rid: z.string(), ok: z.boolean(), code: RigResultCodeSchema.optional(), reason: z.string().optional() });

// Client messages.
export const RigActSchema = z.object({ type: z.literal('rig.act'), rid: z.string(), machine: z.string(), rigId: z.string().optional(), seatRef: z.string().optional(), verb: RigVerbSchema });
export const RigPrepareSchema = z.object({ type: z.literal('rig.prepare'), rid: z.string(), machine: z.string(), spec: z.string(), goal: z.string(), where: RigLaunchWhereSchema });
export const RigLaunchSchema = z.object({ type: z.literal('rig.launch'), rid: z.string(), planId: z.string() });
export const RigAdoptSchema = z.object({ type: z.literal('rig.adopt'), rid: z.string(), machine: z.string(), rigId: z.string(), projectId: z.string() });
export const RigSendSchema = z.object({ type: z.literal('rig.send'), rid: z.string(), machine: z.string(), seatRef: z.string(), text: z.string() });
export const RigExchangesRequestSchema = z.object({ type: z.literal('rig.exchanges.request'), machine: z.string(), rigId: z.string() });
export const EscalationAnswerSchema = z.object({ type: z.literal('escalation.answer'), rid: z.string(), id: z.string(), answers: z.record(z.string()), by: z.literal('user') });
export const LedgeSaySchema = z.object({ type: z.literal('ledge.say'), rid: z.string(), text: z.string() });
export const LedgeThreadRequestSchema = z.object({ type: z.literal('ledge.thread.request'), before: z.string().datetime().optional() });
export const MandateUpdateSchema = z.object({ type: z.literal('mandate.update'), rid: z.string(), text: z.string() });
export const RuleSetSchema = z.object({ type: z.literal('rule.set'), rid: z.string(), id: z.string(), status: z.enum(['active', 'rejected']) });
export const DecisionRevisitSchema = z.object({ type: z.literal('decision.revisit'), rid: z.string(), id: z.string(), text: z.string().optional() });
export const CategoryEscalateSchema = z.object({ type: z.literal('category.escalate'), rid: z.string(), category: MandateCategorySchema });
export const BrainSetSchema = z.object({ type: z.literal('brain.set'), rid: z.string(), enabled: z.boolean(), tool: z.string().optional() });
