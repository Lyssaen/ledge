import { z } from 'zod';
import { ChatActionSchema } from './chat.js';
import { ToolSchema } from './session.js';

/** Mandate categories (spec §5.3): Ledge may settle the first four alone, never the last three. */
export const MandateCategorySchema = z.enum(['git', 'tests', 'context', 'code', 'design', 'architecture', 'critical']);
export type MandateCategory = z.infer<typeof MandateCategorySchema>;
export const ALWAYS_USER: readonly MandateCategory[] = ['design', 'architecture', 'critical'];
/** Category labels as people read them (lot 4). */
export const MANDATE_CATEGORY_LABEL: Record<MandateCategory, { fr: string; en: string }> = {
  git: { fr: 'Git et branches', en: 'Git and branches' },
  tests: { fr: 'Tests et relectures', en: 'Tests and reviews' },
  context: { fr: 'Contexte et relèves', en: 'Context and handovers' },
  code: { fr: 'Petits choix de code', en: 'Small code choices' },
  design: { fr: 'Design', en: 'Design' },
  architecture: { fr: 'Architecture', en: 'Architecture' },
  critical: { fr: 'Critique', en: 'Critical' },
};

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
export const RIG_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** What a launch left on its rig: the plan it came from, the goal, the lead seat, and the goal's delivery state. */
export const RigLaunchInfoSchema = z.object({ planId: z.string(), goal: z.string(), lead: z.string(),
  startedAt: z.string().datetime(), goalSentAt: z.string().datetime().optional(), lateNotice: z.boolean().optional() });
export type RigLaunchInfo = z.infer<typeof RigLaunchInfoSchema>;
export const RigSchema = z.object({ id: z.string(), name: z.string(), machine: z.string(), spec: z.string().optional(),
  cwd: z.string(), projectId: z.string().nullable(), offProject: z.boolean(), branch: z.string().optional(),
  lifecycle: RigLifecycleSchema, kernel: z.boolean(), seats: z.array(RigSeatSchema), repos: z.array(RigRepoSchema), launch: RigLaunchInfoSchema.optional() });
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
  correcting: z.string().optional(), // id of the decision being corrected (Revenir dessus)
  category: MandateCategorySchema.optional(), advice: z.string().optional(),
  answer: z.object({ by: z.enum(['ledge', 'user']), answers: z.record(z.string()), at: z.string().datetime(), rule: z.string().optional(),
    delivery: z.enum(['queued', 'sent']).optional() }).optional() }); // delivery: answer waiting on an unreachable machine (lot 6)
export type Escalation = z.infer<typeof EscalationSchema>;

export const ExchangeSchema = z.object({ id: z.string(), machine: z.string(), rigId: z.string(), from: z.string(), to: z.string(),
  kind: z.enum(['message', 'task', 'handoff', 'ledge']), text: z.string(), at: z.string().datetime() });
export type Exchange = z.infer<typeof ExchangeSchema>;
/** The last exchanges kept per rig, in memory only. */
export const EXCHANGES_MAX = 200;
/** An exchange group in the thread closes after 10 minutes without an exchange. */
export const EXCHANGE_GROUP_MS = 600_000;
/** Thread items per page; the most recent first when a client connects. */
export const THREAD_PAGE = 50;

/** Named `Ledge*` because `Decision` / `Rule` already exist in decisions.ts and projects.ts. */
export const LedgeDecisionSchema = z.object({ id: z.string(), escalationId: z.string(), by: z.enum(['ledge', 'user']),
  category: MandateCategorySchema.optional(), // absent: a user answer on an uncategorised escalation (never guessed)
  summary: z.string(), answers: z.record(z.string()), rule: z.string().optional(),
  from: z.string().optional(), rigId: z.string().optional(), // the seat and rig the decision was for
  why: z.string().optional(), at: z.string().datetime(), revisitedBy: z.string().optional() });
export type LedgeDecision = z.infer<typeof LedgeDecisionSchema>;
export const LedgeRuleSchema = z.object({ id: z.string(), text: z.string(), category: MandateCategorySchema, since: z.string(),
  from: z.string(), appliedCount: z.number().int().min(0), status: z.enum(['active', 'proposed']) });
export type LedgeRule = z.infer<typeof LedgeRuleSchema>;

/**
 * Upsert rule: a `ledge.thread.item` whose `id` already exists REPLACES that item on the client
 * (an exchange group that grows, a bubble that finishes).
 * `qid` = the one-shot runner's chat turn whose action cards follow the bubble;
 * `pending` = the « Ledge reads… » bubble until the turn is over.
 */
export const LedgeThreadItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), id: z.string(), at: z.string().datetime(), text: z.string(), to: z.string().optional(), // to = "@build"
    qid: z.string().optional() }),
  z.object({ kind: z.literal('ledge'), id: z.string(), at: z.string().datetime(), text: z.string(), qid: z.string().optional(),
    pending: z.literal(true).optional() }),
  z.object({ kind: z.literal('escalation'), id: z.string(), at: z.string().datetime(), escalationId: z.string() }),
  z.object({ kind: z.literal('decided'), id: z.string(), at: z.string().datetime(), decisionId: z.string() }),
  z.object({ kind: z.literal('exchanges'), id: z.string(), at: z.string().datetime(), machine: z.string(), rigId: z.string(),
    from: z.string().datetime(), to: z.string().datetime(), exchangeIds: z.array(z.string()) }),
  z.object({ kind: z.literal('card'), id: z.string(), at: z.string().datetime(), action: ChatActionSchema }), // existing action card
]);
export type LedgeThreadItem = z.infer<typeof LedgeThreadItemSchema>;

export const BrainStatusSchema = z.object({ state: z.enum(['off', 'starting', 'on', 'down']), tool: ToolSchema,
  contextPct: z.number().optional(), sessionId: z.string().optional(),
  enabled: z.boolean().nullable().optional(), // null: the user was never asked
  restarts: z.number().int().min(0).optional(), reason: z.string().optional() }); // reason: why it is down
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
export const RIG_RESULT_CODES = ['rig_managed', 'already_answered', 'openrig_down', 'unsupported', 'mandate', 'unreachable', 'failed', 'invalid'] as const; // invalid: empty answer, or a question left unanswered
export const RigResultCodeSchema = z.enum(RIG_RESULT_CODES);
export type RigResultCode = z.infer<typeof RigResultCodeSchema>;

/** The commands the brain session may run through `ledge brain <op>` (`handover`: its relief brief, F-I2). */
export const BRAIN_OPS = ['say', 'decide', 'ask', 'rig', 'send', 'propose', 'remember', 'who', 'rigs', 'escalations', 'rules', 'handover'] as const;
export type BrainOp = typeof BRAIN_OPS[number];
/** Codes of a refused or failed `brain.cmd`. */
export const BRAIN_RESULT_CODES = ['not_brain', 'identity', 'mandate', 'grace', 'invalid', 'refused', 'already_answered', 'failed', 'unreachable', 'openrig_down'] as const;
export const BrainResultCodeSchema = z.enum(BRAIN_RESULT_CODES);
export type BrainResultCode = z.infer<typeof BrainResultCodeSchema>;
/** The thread bubble that tells the brain is stopped (posted by the daemon); the UI renders « Démarrer » on exactly this text. */
export const BRAIN_STOPPED_TEXT = 'Ledge est arrêté · Démarrer';
/** The labels shown under each category of the Mandat tab. */
export const MANDATE_CATEGORY_TAGS: Record<MandateCategory, string[]> = {
  git: ['merge', 'branches'], tests: ['ciblés', 'relance'], context: ['operator'], code: ['nommage', 'style'],
  design: ['UI', 'copie'], architecture: ['stockage', 'API'], critical: ['données', 'sécurité', 'suppression', 'coûts'] };

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
export const LedgeThreadHistorySchema = z.object({ type: z.literal('ledge.thread.history'), items: z.array(LedgeThreadItemSchema), before: z.string().optional() });
export const DecisionsMessageSchema = z.object({ type: z.literal('decisions'), items: z.array(LedgeDecisionSchema) });
export const RulesMessageSchema = z.object({ type: z.literal('rules'), items: z.array(LedgeRuleSchema) });
export const MandateMessageSchema = z.object({ type: z.literal('mandate'), text: z.string(), path: z.string() });
export const BrainStatusMessageSchema = z.object({ type: z.literal('brain.status'), status: BrainStatusSchema });
export const RigPlanMessageSchema = z.object({ type: z.literal('rig.plan'), rid: z.string(), plan: RigPlanSchema });
export const BrainResultSchema = z.object({ type: z.literal('brain.result'), rid: z.string(), ok: z.boolean(), line: z.string(), code: BrainResultCodeSchema.optional() });
export const RigResultSchema = z.object({ type: z.literal('rig.result'), rid: z.string(), ok: z.boolean(), code: RigResultCodeSchema.optional(), reason: z.string().optional() });

// Client messages.
export const RigActSchema = z.object({ type: z.literal('rig.act'), rid: z.string(), machine: z.string(), rigId: z.string().optional(), seatRef: z.string().optional(), verb: RigVerbSchema });
export const RigPrepareSchema = z.object({ type: z.literal('rig.prepare'), rid: z.string(), machine: z.string(), spec: z.string(), goal: z.string().max(8000), where: RigLaunchWhereSchema });
export const RigLaunchSchema = z.object({ type: z.literal('rig.launch'), rid: z.string(), planId: z.string() });
export const RigAdoptSchema = z.object({ type: z.literal('rig.adopt'), rid: z.string(), machine: z.string(), rigId: z.string(), projectId: z.string() });
export const RigSendSchema = z.object({ type: z.literal('rig.send'), rid: z.string(), machine: z.string(), seatRef: z.string(), text: z.string() });
export const RigSpecSeatSchema = z.object({ address: z.string(), member: z.string(), pod: z.string(), runtime: z.string(),
  model: z.string().optional(), effort: z.string().optional(), profile: z.string().optional() });
export type RigSpecSeat = z.infer<typeof RigSpecSeatSchema>;
export const RigSpecInfoSchema = z.object({ id: z.string(), name: z.string(), summary: z.string().optional(),
  source: z.enum(['builtin', 'library', 'registry']), path: z.string().optional(), seats: z.array(RigSpecSeatSchema) });
export type RigSpecInfo = z.infer<typeof RigSpecInfoSchema>;
export const RigSpecsRequestSchema = z.object({ type: z.literal('rig.specs.request'), requestId: z.string(), machineId: z.string().optional() });
export const RigSpecsSchema = z.object({ type: z.literal('rig.specs'), requestId: z.string(), machine: z.string(), specs: z.array(RigSpecInfoSchema),
  error: z.enum(['openrig_down', 'unsupported', 'failed']).optional() });
export const RigExchangesRequestSchema = z.object({ type: z.literal('rig.exchanges.request'), machine: z.string(), rigId: z.string() });
export const EscalationAnswerSchema = z.object({ type: z.literal('escalation.answer'), rid: z.string(), id: z.string(), answers: z.record(z.string()), by: z.literal('user') });
export const LedgeSaySchema = z.object({ type: z.literal('ledge.say'), rid: z.string(), text: z.string(), about: z.string().optional() }); // about = escalation id (« En parler »)
export const LedgeThreadRequestSchema = z.object({ type: z.literal('ledge.thread.request'), before: z.string().optional() });
export const MandateUpdateSchema = z.object({ type: z.literal('mandate.update'), rid: z.string(), text: z.string() });
export const RuleSetSchema = z.object({ type: z.literal('rule.set'), rid: z.string(), id: z.string(), status: z.enum(['active', 'rejected']) });
export const DecisionRevisitSchema = z.object({ type: z.literal('decision.revisit'), rid: z.string(), id: z.string(), text: z.string().optional() });
export const CategoryEscalateSchema = z.object({ type: z.literal('category.escalate'), rid: z.string(), category: MandateCategorySchema });
export const BrainSetSchema = z.object({ type: z.literal('brain.set'), rid: z.string(), enabled: z.boolean(), tool: ToolSchema.optional(),
  first: z.literal(true).optional() }); // first: the user accepted the activation offer
export const BrainCmdSchema = z.object({ type: z.literal('brain.cmd'), rid: z.string(), by: z.string(), key: z.string(),
  op: z.enum(BRAIN_OPS), args: z.array(z.string()).max(40) });
