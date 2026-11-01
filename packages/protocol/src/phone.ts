import { z } from 'zod';
import { RIG_RESULT_CODES } from './openrig.js';
import { PhoneRigActSchema, PhoneRigLaunchSchema, PhoneRigSchema, PhoneEscalationSchema, PhoneLedgeDecisionSchema, phoneOpenRigClientMessages, phoneOpenRigServerMessages } from './phoneOpenrig.js';
export * from './phoneOpenrig.js';
import { ATTACHMENTS_MAX, ATTACHMENT_MAX, AttachmentDataSchema, AttachmentErrorSchema, AttachmentGetSchema, AttachmentIdSchema, AttachmentPutSchema, AttachmentRefSchema, AttachmentStoredSchema, ImageUploadSchema, b64Max } from './attachments.js';
import { ContextPrefsSchema, HandoverStateSchema } from './handover.js';
import { PendingSchema, SessionSchema, ToolSchema, type Tool } from './session.js';
import { ActionVarsSchema, ChatActionStateSchema, ChatStepSchema, MAX_PROPOSALS, type CloseHow } from './chat.js';
import { ActionRiskSchema } from './actions.js';
import { DecisionSchema, NOTE_MAX } from './decisions.js';
import { ThreadItemSchema } from './thread.js';
import type { TodoStatus } from './todos.js';
import { MESSAGE_MAX, RefusalCodeSchema, SEMVER, UpdateFailureSchema } from './messages.js';
import { PushSubscriptionSchema } from './push.js';
import { EffortSchema, ModelChoiceSchema, ModelIdSchema, ModelRefusalSchema } from './models.js';

/** The phone/PC messages have their own schemas: a type or a field that is not here never crosses the relay. */
export const PHONE_PROTOCOL = 1;

/** Every message is padded, before sealing, up to the next of these sizes (UTF-8 bytes of its JSON); none is larger than `PLAIN_MAX`. */
export const PAD_TIERS = [1_024, 4_096, 16_384, 65_536, 262_144, 655_360];
export const PLAIN_MAX = 655_360;

const utf8 = new TextEncoder();

/**
 * Trailing spaces up to the smallest of `PAD_TIERS` >= the UTF-8 size of `json`, so the relay sees a tier and not an
 * exact length; null past `PLAIN_MAX`. `JSON.parse` ignores the spaces. Measured with `TextEncoder`: it runs in a browser.
 */
export function padPlain(json: string): string | null {
  const bytes = utf8.encode(json).length;
  if (bytes > PLAIN_MAX) return null;
  const tier = PAD_TIERS.find((t) => t >= bytes);
  if (tier === undefined) return null;
  return json + ' '.repeat(tier - bytes);
}
/** A thread sent to the phone: its item count, its whole size, and the longest text of an item and of a tool's input or output. */
export const THREAD_ITEMS_MAX = 200;
export const THREAD_BUDGET = 524_288;
export const THREAD_TEXT_MAX = 8_192;
export const TOOL_TEXT_MAX = 2_048;
/** The agent's checklist as the phone gets it: the most tasks, and the longest text of a task or of the current one. */
export const CHECKLIST_TASKS_MAX = 50;
export const CHECKLIST_TEXT_MAX = 200;
/** The three `TodoStatus` values (`satisfies` checks each one is a `TodoStatus`, not that none is missing). */
const ChecklistStatusSchema = z.enum(['pending', 'in_progress', 'completed'] as const satisfies readonly TodoStatus[]);
/** What the session screen shows: every task. `done` and `total` count the agent's whole list; `cut` is set when the gateway capped the list or clipped any text. */
export const PhoneChecklistSchema = z.object({
  tasks: z.array(z.object({ text: z.string().max(CHECKLIST_TEXT_MAX), status: ChecklistStatusSchema })).max(CHECKLIST_TASKS_MAX),
  done: z.number().int().nonnegative(), total: z.number().int().nonnegative(), cut: z.literal(true).optional()
});
export type PhoneChecklist = z.infer<typeof PhoneChecklistSchema>;
/** What « Agents » shows: the counts and the task in progress. `cut` is set when the gateway capped the list or clipped any text. */
export const PhoneChecklistSummarySchema = z.object({
  done: z.number().int().nonnegative(), total: z.number().int().nonnegative(), current: z.string().max(CHECKLIST_TEXT_MAX).optional(), cut: z.literal(true).optional()
});
export type PhoneChecklistSummary = z.infer<typeof PhoneChecklistSummarySchema>;
/** A request's full body (a plan) as the phone gets it. */
export const PENDING_BODY_MAX = 65_536;
/** A request's body inside a snapshot or an update; the whole body comes on demand with `session.pending`. */
export const SNAPSHOT_BODY_MAX = 2_048;

/** How much a request can do if accepted blindly: `high` needs a fresh device check on the phone. */
export const RiskSchema = z.enum(['low', 'high']);
export type Risk = z.infer<typeof RiskSchema>;

export const RiskReasonSchema = z.enum(['question', 'read_only_command', 'edit_inside_folder', 'pushes', 'destroys', 'deploys', 'publishes', 'pipes_to_shell', 'network', 'writes_outside_folder', 'sensitive_path', 'unsafe_flag', 'shell_syntax', 'script', 'plan', 'unknown']);
export type RiskReason = z.infer<typeof RiskReasonSchema>;

/** A phone-made operation is named by a uuid it generates, so a retry after a lost connection is recognised. */
export const OperationIdSchema = z.string().uuid();
export type OperationId = z.infer<typeof OperationIdSchema>;

export const OperationStatusSchema = z.enum(['received', 'applied', 'rejected', 'failed']);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;

/** Why an operation was refused: a refusal code of the local fronts, or one only a phone can meet.  */
export const OperationReasonSchema = z.enum([...RefusalCodeSchema.options, 'untypable', 'confirm_required', 'conflict', 'assertion_invalid', 'assertion_expired', 'scheduled', ...ModelRefusalSchema.options, ...RIG_RESULT_CODES]);
export type OperationReason = z.infer<typeof OperationReasonSchema>;

/** What an adapter knows how to type for a phone, beyond accept, deny and an option number. A phone hides an answer its session's tool cannot give. */
export const CapabilitiesSchema = z.object({
  /** A question can be answered in free text. */
  freeTextAnswer: z.boolean(),
  /** The session's accept/deny can be typed; absent = true. */
  decide: z.boolean().optional(),
  /** OMP's dialog questions can be answered from the phone; absent = false. */
  questions: z.boolean().optional()
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

/**
 * What a free answer may not carry, so that it is one line typed as shown: line breaks, control characters that could
 * drive the terminal (C0 such as ESC, CR, LF, tab; DEL; C1 such as CSI), line/paragraph separators, bidi overrides and
 * isolates, and zero-width spaces and the BOM (the zero-width joiners stay: emoji sequences and some scripts need them).
 */
export const UNTYPABLE = /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff]/;

/** Every tool's capabilities, in the phone's snapshot. */
export const CapabilitiesByToolSchema = z.object({ claude: CapabilitiesSchema, codex: CapabilitiesSchema, cursor: CapabilitiesSchema, omp: CapabilitiesSchema });
export type CapabilitiesByTool = z.infer<typeof CapabilitiesByToolSchema>;
// A tool added to ToolSchema without its entry here (or the reverse) fails to compile.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const sameTools: Same<keyof CapabilitiesByTool, Tool> = true;
void sameTools;

/** A request as the phone sees it: `key` covers its whole content (the phone sends it back as `expect`); `cut` says `body` was shortened. */
export const PhonePendingSchema = PendingSchema.extend({ key: z.string().max(64), risk: RiskSchema, riskReason: RiskReasonSchema, cut: z.literal(true).optional() });
export type PhonePending = z.infer<typeof PhonePendingSchema>;

/** What the phone's session carries of a model change (#58) that no session has: the daemon can switch it from a phone. */
const SwitchableSessionSchema = SessionSchema.extend({ canSwitch: z.literal(true).optional() });

/** A session as the phone sees it: no folder, no tmux name, no machine, no message to another agent. */
export const PhoneSessionSchema = SwitchableSessionSchema.pick({
  id: true, name: true, tool: true, project: true, title: true, topic: true, repo: true, branch: true, worktree: true,
  state: true, helpers: true, lastReply: true, startedAt: true, lastActivityAt: true,
  /** Its model, effort and the change waiting for its next free moment: the phone shows them and offers to change them. */
  model: true, effort: true, modelNext: true, canSwitch: true,
  /** Its context and its relief (context handover spec §3.2): the phone shows the gauge; the relief is started from the PC. */
  context: true, relieves: true,
  /** When it ended: « Terminée · à 18:42 » in the list. */
  exitedAt: true
}).extend({ pending: PhonePendingSchema.optional(), unread: z.boolean(), handover: z.object({ state: HandoverStateSchema, toName: z.string().max(80).optional() }).strict().optional(),
  /** Absent: the agent has no checklist. */ checklist: PhoneChecklistSummarySchema.optional(),
  /** Started without Ledge (`hook_only`): the phone can neither close nor resume it. */ readOnly: z.literal(true).optional(), rig: z.object({ rigName: z.string().max(80), seat: z.string().max(120) }).strict().optional(), brain: z.literal(true).optional() });
export type PhoneSession = z.infer<typeof PhoneSessionSchema>;

/** Base64url without padding: what WebAuthn fields look like once the phone encodes them. */
const B64U = z.string().regex(/^[A-Za-z0-9_-]*$/);

/** A device passkey as the phone registers it: its public key (SPKI) and the first attestation's client data. */
export const CredentialSchema = z.object({
  id: B64U.max(1_366),
  publicKey: B64U.max(2_048),
  alg: z.union([z.literal(-7), z.literal(-257)]),
  clientDataJSON: B64U.max(4_096),
  authenticatorData: B64U.max(4_096),
  transports: z.array(z.string().max(20)).max(8).optional()
});
export type Credential = z.infer<typeof CredentialSchema>;

/** A WebAuthn assertion over a challenge the daemon issued. */
export const AssertionSchema = z.object({
  id: B64U.max(1_366),
  clientDataJSON: B64U.max(4_096),
  authenticatorData: B64U.max(4_096),
  signature: B64U.max(1_024)
});
export type Assertion = z.infer<typeof AssertionSchema>;

/** `pc`: updating or restarting the PC's daemon (spec 2026-10-28 mobile daemon update). */
export const ConfirmPurposeSchema = z.enum(['register', 'decide', 'launch', 'close', 'act', 'pc', 'rig']);
export type ConfirmPurpose = z.infer<typeof ConfirmPurposeSchema>;

/** The phone's chat: no folder, no path, no machine, no free error text; every object is strict, `pick` included. */
export const PhoneChatStepSchema = ChatStepSchema.pick({ kind: true, id: true, name: true }).strict();
export type PhoneChatStep = z.infer<typeof PhoneChatStepSchema>;

export const PhoneChatProposalSchema = z.object({
  project: z.string().max(80), tool: ToolSchema, prompt: z.string().max(TOOL_TEXT_MAX).optional(),
  launchedId: z.string().optional(), failed: z.literal(true).optional()
}).strict();
export type PhoneChatProposal = z.infer<typeof PhoneChatProposalSchema>;

export const PhoneChatRelaySchema = z.object({
  id: z.string().min(1), name: z.string(), tool: ToolSchema, text: z.string().max(TOOL_TEXT_MAX),
  status: z.enum(['queued', 'sent']).optional(), sentAt: z.string().datetime().optional(), failed: z.literal(true).optional()
}).strict();
export type PhoneChatRelay = z.infer<typeof PhoneChatRelaySchema>;

/** How a close ended the agent: its exit command, or its terminal killed as a last resort. */
export const CloseHowSchema = z.enum(['exit', 'killed'] as const satisfies readonly CloseHow[]);

/** A session the card closes: no error text, `failed` says the last attempt did not work. */
export const PhoneChatCloseSchema = z.object({
  id: z.string().min(1), name: z.string(), tool: ToolSchema,
  how: CloseHowSchema.optional(), closedAt: z.string().datetime().optional(), failed: z.literal(true).optional()
}).strict();
export type PhoneChatClose = z.infer<typeof PhoneChatCloseSchema>;

/** A row of the chat's generic card as the phone sees it: no args (the phone applies rows, never args), no error text but its
 *  `code`. A detail too long for the phone comes cut (`detailCut`): such a row can only be refused there, or opened on the PC. */
export const PhoneChatActionSchema = z.object({
  action: z.string().min(1).max(40), summary: z.string().max(300), vars: ActionVarsSchema.optional(),
  detail: z.string().max(TOOL_TEXT_MAX).optional(), detailCut: z.literal(true).optional(), risk: ActionRiskSchema,
  session: z.string().max(100).optional(),
  state: ChatActionStateSchema.optional(), doneAt: z.string().datetime().optional(), code: z.string().max(40).optional()
}).strict();
export type PhoneChatAction = z.infer<typeof PhoneChatActionSchema>;

/** Why a question ended without an answer. */
export const ChatErrorCodeSchema = z.enum(['busy', 'timeout', 'cancelled', 'failed']);
export type ChatErrorCode = z.infer<typeof ChatErrorCodeSchema>;

export const PhoneChatTurnSchema = z.object({
  qid: OperationIdSchema, question: z.string().max(MESSAGE_MAX), askedAt: z.string().datetime(),
  steps: z.array(PhoneChatStepSchema).max(50), answer: z.string().max(THREAD_TEXT_MAX).optional(), answeredAt: z.string().datetime().optional(),
  error: ChatErrorCodeSchema.optional(), proposals: z.array(PhoneChatProposalSchema).max(MAX_PROPOSALS).optional(),
  relay: PhoneChatRelaySchema.optional(), closes: z.array(PhoneChatCloseSchema).min(1).max(MAX_PROPOSALS).optional(), cut: z.literal(true).optional(),
  actions: z.array(PhoneChatActionSchema).min(1).max(MAX_PROPOSALS).optional(), ignoredAt: z.string().datetime().optional(),
  attachments: z.array(AttachmentRefSchema).max(ATTACHMENTS_MAX).optional()
}).strict();
export type PhoneChatTurn = z.infer<typeof PhoneChatTurnSchema>;

/** The `chat.history` sent to a phone keeps the most recent turns whose JSON fits: 60 % of `PLAIN_MAX`. */
export const CHAT_HISTORY_BUDGET = 393_216;

const sessionId = z.string().min(1).max(100);
/** The request the phone showed, named by its key. */
const PhoneExpectSchema = PendingSchema.pick({ kind: true, text: true }).extend({ key: z.string().min(1).max(64) });

/** The rows of a card the phone acts on: indexes into the card, none twice. */
const CardRowsSchema = z.array(z.number().int().min(0).max(MAX_PROPOSALS - 1)).min(1).max(MAX_PROPOSALS).refine(r => new Set(r).size === r.length, 'a row twice');

/** A signed phone operation (`daemon.update`, `daemon.restart`): strict, and a passkey assertion backs it. */
const signedOp = { op: OperationIdSchema, assertion: AssertionSchema.optional() };
/** What a `pc` challenge covers: installing a version then restarting, or restarting alone. */
export const PcActionSchema = z.enum(['update', 'restart']);
export type PcAction = z.infer<typeof PcActionSchema>;
/** The subject a `pc` challenge is bound to: a challenge for one version covers neither another nor a restart. */
export const pcSubject = (action: PcAction, version?: string): string => (action === 'update' ? `update@${version ?? ''}` : 'restart');

/** What the daemon accepts from a phone: this union is the whitelist. */
export const PhoneClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot.request') }),
  ...phoneOpenRigClientMessages,
  z.object({ type: z.literal('session.thread'), id: sessionId }),
  /** The session's request with its whole body (up to `PENDING_BODY_MAX`). */
  z.object({ type: z.literal('session.pending'), id: sessionId }),
  /** The session whose terminal the phone shows; null when it shows none. */
  z.object({ type: z.literal('session.watch'), id: sessionId.nullable() }),
  z.object({ type: z.literal('session.read'), id: sessionId, at: z.string().datetime() }),
  /**
   * Asks for a challenge. One object for every purpose: the gateway refuses a `decide` without `id` and `expect`. A `close`
   * or `act` names a turn of the chat (`qid`) or a session (`id`, for `session.close` and `session.resume`).
   */
  z.object({ type: z.literal('confirm.prepare'), purpose: ConfirmPurposeSchema, id: sessionId.optional(), expect: PhoneExpectSchema.optional(), qid: OperationIdSchema.optional(),
    /** A `pc` challenge: what it is for, and for an update the version it covers. */ action: PcActionSchema.optional(), version: z.string().regex(SEMVER).optional(), rig: z.discriminatedUnion('type', [PhoneRigLaunchSchema, PhoneRigActSchema]).optional() }),
  z.object({ type: z.literal('credential.register'), op: OperationIdSchema, credential: CredentialSchema }),
  z.object({
    type: z.literal('session.decide'), op: OperationIdSchema, id: sessionId, decision: DecisionSchema, note: z.string().trim().min(1).max(NOTE_MAX).optional(),
    /** The request the phone showed: refused unless it is still the pending one. */
    expect: PhoneExpectSchema,
    /** The device check over the challenge of `confirm.prepare`; required by the daemon for a high-risk accept. */
    assertion: AssertionSchema.optional()
  }),
  z.object({
    type: z.literal('session.reply'), op: OperationIdSchema, id: sessionId, text: z.string().max(MESSAGE_MAX), attachments: z.array(AttachmentIdSchema).max(ATTACHMENTS_MAX).optional(),
    /** The request the reply answers, or null when the phone showed none: refused if the session's request is no longer that one. */
    expect: PhoneExpectSchema.nullable(),
    assertion: AssertionSchema.optional()
  }),
  /** OMP's `ask`: the answers to every question of the dialog `requestId`, in order; `cancel` declines it. Bounds as the local `session.answer`. */
  z.object({
    type: z.literal('session.answer'), op: OperationIdSchema, id: sessionId, requestId: z.string().min(1).max(200),
    answers: z.array(z.object({ id: z.string().max(200), selected: z.array(z.string().max(2_000)).max(100), text: z.string().max(20_000).optional() })).max(50),
    cancel: z.literal(true).optional(), expect: PhoneExpectSchema
  }),
  z.object({ type: z.literal('session.interrupt'), op: OperationIdSchema, id: sessionId }),
  /** Ends a live session as `/exit` would, killed as a last resort; answered with its `how`. Passkey, purpose `close`, over the session. */
  z.object({ type: z.literal('session.close'), op: OperationIdSchema, id: sessionId, assertion: AssertionSchema.optional() }),
  /** Starts an ended session again on its conversation. Passkey, purpose `act`, over the session. */
  z.object({ type: z.literal('session.resume'), op: OperationIdSchema, id: sessionId, assertion: AssertionSchema.optional() }),
  /** Changes a live session's model and effort, `null` for the agent's own default; answered by `operation.result` and, when refused, `session.model.failed`. */
  z.object({ type: z.literal('session.model'), op: OperationIdSchema, id: sessionId, model: ModelIdSchema.nullable(), effort: EffortSchema.nullable() }),
  /** The models an agent offers on the PC. */
  z.object({ type: z.literal('models.list'), tool: ToolSchema }),
  /** The phone drops its passkey from the daemon. */
  z.object({ type: z.literal('device.forget'), op: OperationIdSchema }),
  /** The phone's push subscription, with the VAPID key it was made with (so a key change is seen). */
  z.object({ type: z.literal('push.subscribe'), op: OperationIdSchema, subscription: PushSubscriptionSchema, key: B64U.length(87) }),
  z.object({ type: z.literal('push.unsubscribe'), op: OperationIdSchema }),
  /** The phone's own chat with Ledge. */
  z.object({ type: z.literal('chat.ask'), qid: OperationIdSchema, text: z.string().trim().max(MESSAGE_MAX), attachments: z.array(AttachmentIdSchema).max(ATTACHMENTS_MAX).optional() }),
  z.object({ type: z.literal('chat.cancel'), qid: OperationIdSchema }),
  z.object({ type: z.literal('chat.reset') }),
  z.object({ type: z.literal('chat.history') }),
  /** An image to store, sent alone before the message that names it; no `id`, and at most `ATTACHMENT_MAX` bytes. */
  AttachmentPutSchema.pick({ type: true, requestId: true }).extend({ image: ImageUploadSchema.extend({ data: z.string().min(1).max(b64Max(ATTACHMENT_MAX)) }) }),
  AttachmentGetSchema.pick({ type: true, requestId: true, attachment: true, preview: true }),
  z.object({ type: z.literal('chat.relay'), op: OperationIdSchema, qid: OperationIdSchema }),
  z.object({ type: z.literal('chat.launch'), op: OperationIdSchema, qid: OperationIdSchema, rows: CardRowsSchema.optional(), assertion: AssertionSchema.optional() }),
  z.object({ type: z.literal('chat.close'), op: OperationIdSchema, qid: OperationIdSchema, rows: CardRowsSchema.optional(), assertion: AssertionSchema.optional() }),
  /** Rows of the turn's generic card (action registry spec §5): `confirmed` as the local `chat.act`; a row whose action asks
   *  for a device check (`phone`) needs one assertion, purpose `act`, over the turn. */
  z.object({ type: z.literal('chat.act'), op: OperationIdSchema, qid: OperationIdSchema, rows: CardRowsSchema.optional(), confirmed: z.literal(true).optional(), assertion: AssertionSchema.optional(),
    /** « Refuser », as the local `chat.act`: no passkey, no confirmation. */
    deny: z.literal(true).optional() }),
  /** « Ignorer » the turn's cards, or `undo` (« Revoir »), as the local `chat.ignore`. */
  z.object({ type: z.literal('chat.ignore'), op: OperationIdSchema, qid: OperationIdSchema, undo: z.literal(true).optional() }),
  /** Whether the phone's app is in front: a device that is visible gets no push. */
  z.object({ type: z.literal('presence'), visible: z.boolean() }),
  /** Installs `version` on the PC, then restarts its daemon; the phone asks for its own build's version. Passkey, purpose `pc`. */
  z.object({ type: z.literal('daemon.update'), ...signedOp, version: z.string().regex(SEMVER) }).strict(),
  /** Restarts the PC's daemon without installing anything. Passkey, purpose `pc`. */
  z.object({ type: z.literal('daemon.restart'), ...signedOp }).strict()
]);
export type PhoneClientMessage = z.infer<typeof PhoneClientMessageSchema>;

/** A model as the phone lists it: strings clipped by the gateway, no key it does not know. */
export const PhoneModelChoiceSchema = z.object({
  id: ModelChoiceSchema.shape.id.max(120), label: z.string().max(80), description: z.string().max(200).optional(),
  efforts: z.array(EffortSchema).max(8).optional(), defaultEffort: EffortSchema.optional(), isDefault: z.boolean().optional()
}).strict();
export type PhoneModelChoice = z.infer<typeof PhoneModelChoiceSchema>;

/** What the daemon sends a phone. */
export const PhoneServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), protocol: z.literal(PHONE_PROTOCOL), sessions: z.array(PhoneSessionSchema), capabilities: CapabilitiesByToolSchema, daemon: z.object({ version: z.string(), name: z.string().max(40), boot: z.string().uuid().optional(),
    /** The daemon takes `session.model`. */ models: z.literal(true).optional(),
    /** The daemon sends `session.checklist` and a session's `checklist` summary. */ checklist: z.literal(true).optional(),
    /** `update`: the daemon can install a version and restart (npm, systemd); `restart`: it can restart (systemd). */ update: z.literal(true).optional(), restart: z.literal(true).optional(),
    /** The daemon takes `session.close` and `session.resume`. */ sessionClose: z.literal(true).optional(), openrig: z.literal(true).optional() }), rigs: z.array(PhoneRigSchema).max(40).optional(), escalations: z.array(PhoneEscalationSchema).max(40).optional(), decisionsToday: z.array(PhoneLedgeDecisionSchema).max(50).optional(), device: z.object({ confirm: z.boolean(), push: z.enum(['on', 'off', 'stale', 'unavailable']).optional(), chat: z.literal(true).optional(), contextNear: ContextPrefsSchema.shape.near.optional() }).optional() }),
  ...phoneOpenRigServerMessages,
  z.object({ type: z.literal('confirm.challenge'), purpose: ConfirmPurposeSchema, challenge: B64U.max(64), rpId: z.string().max(253), credentialId: B64U.max(1_366).optional(), expiresInMs: z.number().int().positive(),
  }),
  z.object({ type: z.literal('session.updated'), session: PhoneSessionSchema }),
  z.object({ type: z.literal('session.removed'), id: z.string() }),
  /** A session's checklist, sent to the phone that watches it; `null`: it has none (any more). */
  z.object({ type: z.literal('session.checklist'), id: z.string(), checklist: PhoneChecklistSchema.nullable() }),
  /** `pending.cut` is set when even this body was shortened. */
  z.object({ type: z.literal('session.pending'), id: z.string(), pending: PhonePendingSchema }),
  z.object({ type: z.literal('session.preview'), id: z.string(), lines: z.array(z.string()) }),
  /** `cut`: the ids of the items shortened; `more`: older items were left out. */
  z.object({ type: z.literal('session.thread'), id: z.string(), items: z.array(ThreadItemSchema), cut: z.array(z.string()), more: z.boolean() }),
  z.object({ type: z.literal('session.thread.item'), id: z.string(), item: ThreadItemSchema, cut: z.literal(true).optional() }),
  z.object({ type: z.literal('operation.result'), op: OperationIdSchema, status: OperationStatusSchema, reason: OperationReasonSchema.optional(),
    /** How an applied `session.close` ended the agent: `killed` when it had to be forced. */ how: CloseHowSchema.optional() }),
  /** The models an agent offers; `error`: it could not be asked, `models` is then what Ledge knows without it. */
  z.object({ type: z.literal('models.listing'), tool: ToolSchema, models: z.array(PhoneModelChoiceSchema).max(40), error: z.literal(true).optional() }),
  /** A model change that was accepted and then failed (the agent could not restart). */
  z.object({ type: z.literal('session.model.failed'), id: z.string(), reason: ModelRefusalSchema }),
  z.object({ type: z.literal('chat.history'), turns: z.array(PhoneChatTurnSchema).max(50) }),
  z.object({ type: z.literal('chat.step'), qid: OperationIdSchema, step: PhoneChatStepSchema }),
  /** The whole text so far, not an increment. */
  z.object({ type: z.literal('chat.delta'), qid: OperationIdSchema, text: z.string().max(THREAD_TEXT_MAX) }),
  z.object({ type: z.literal('chat.done'), qid: OperationIdSchema, turn: PhoneChatTurnSchema }),
  z.object({ type: z.literal('chat.error'), qid: OperationIdSchema, code: ChatErrorCodeSchema }),
  /** The daemon updating or restarting itself, whoever asked: npm runs, then the service restarts (the link drops right after). */
  z.object({ type: z.literal('daemon.progress'), version: z.string().max(40), step: z.enum(['installing', 'restarting']) }),
  /** Nothing was changed. Never npm's output nor a command: both hold the PC's paths. */
  z.object({ type: z.literal('daemon.failed'), version: z.string().max(40), reason: UpdateFailureSchema }),
  AttachmentStoredSchema,
  AttachmentDataSchema,
  AttachmentErrorSchema,
  /** Never carries free text. */
  z.object({ type: z.literal('error'), code: z.enum(['invalid', 'unknown_session', 'too_large']), request: z.string().max(40).optional() })
]);
export type PhoneServerMessage = z.infer<typeof PhoneServerMessageSchema>;

/** JSON with the keys of every object sorted, and `undefined` fields dropped: the same content always gives the same text. */
export function canonicalJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x !== null && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => [k, sort(o[k])]));
    }
    return x;
  };
  return JSON.stringify(sort(v));
}
