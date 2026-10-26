import { z } from 'zod';
import { AutonomySchema, PendingSchema, SessionSchema, ToolSchema, type Tool } from './session.js';
import { ChatStepSchema, MAX_PROPOSALS } from './chat.js';
import { DecisionSchema, NOTE_MAX } from './decisions.js';
import { ThreadItemSchema } from './thread.js';
import { MESSAGE_MAX, RefusalCodeSchema } from './messages.js';
import { PushSubscriptionSchema } from './push.js';

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

/** Why an operation was refused: a refusal code of the local fronts, or one only a phone can meet. */
export const OperationReasonSchema = z.enum([...RefusalCodeSchema.options, 'untypable', 'confirm_required', 'conflict', 'assertion_invalid', 'assertion_expired']);
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

/** A session as the phone sees it: no folder, no tmux name, no machine, no message to another agent. */
export const PhoneSessionSchema = SessionSchema.pick({
  id: true, name: true, tool: true, project: true, title: true, topic: true, repo: true, branch: true, worktree: true,
  state: true, helpers: true, lastReply: true, startedAt: true, lastActivityAt: true,
  /** Its role and its live team (ledge home spec §2.4): the agents screen groups a project's sessions by table. */
  role: true, roleLabel: true, team: true
}).extend({ pending: PhonePendingSchema.optional(), unread: z.boolean() });
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

/** What a challenge is for. */
export const ConfirmPurposeSchema = z.enum(['register', 'decide', 'launch', 'close']);
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

/** A session the card closes: no error text, `failed` says the last attempt did not work. */
export const PhoneChatCloseSchema = z.object({
  id: z.string().min(1), name: z.string(), tool: ToolSchema,
  how: z.enum(['exit', 'killed']).optional(), closedAt: z.string().datetime().optional(), failed: z.literal(true).optional()
}).strict();
export type PhoneChatClose = z.infer<typeof PhoneChatCloseSchema>;

/** A team the chat proposes, as the phone sees it (roles spec §3.8): no folder; its project's name, its seats with what they
 *  run and their autonomy; `teamId` and `launchedAt` once launched, `failed` when the last launch did not work. */
export const PhoneChatTeamSchema = z.object({
  project: z.string().max(80), name: z.string().max(60), template: z.string().max(64).optional(),
  seats: z.array(z.object({ role: z.string().max(40), label: z.string().max(40), tool: ToolSchema, model: z.string().max(200).optional(), effort: z.string().max(20).optional(), autonomy: AutonomySchema.optional() }).strict()).min(1).max(8),
  teamId: z.string().max(40).optional(), launchedAt: z.string().datetime().optional(), failed: z.literal(true).optional()
}).strict();
export type PhoneChatTeam = z.infer<typeof PhoneChatTeamSchema>;
/** A task the chat proposes to give, as the phone sees it; once given it follows its task. */
export const PhoneChatTaskSchema = z.object({
  to: z.string().max(80), toName: z.string().max(80).optional(), title: z.string().max(200), text: z.string().max(TOOL_TEXT_MAX).optional(),
  taskId: z.string().max(40).optional(), ownerName: z.string().max(80).optional(), state: z.enum(['open', 'taken', 'done', 'refused', 'dropped']).optional(), failed: z.literal(true).optional()
}).strict();
export type PhoneChatTask = z.infer<typeof PhoneChatTaskSchema>;

/** A live team as the phone sees it (ledge home spec §2.4): its project's name, its seats, the progress of Ledge's tasks. */
export const PhoneTeamSchema = z.object({
  id: z.string().max(40), name: z.string().max(60), project: z.string().max(80).nullable(), state: z.enum(['active', 'resting']),
  seats: z.array(z.object({ role: z.string().max(40), sessionId: z.string().max(100).nullable() }).strict()).max(16),
  done: z.number().int().min(0), given: z.number().int().min(0)
}).strict();
export type PhoneTeam = z.infer<typeof PhoneTeamSchema>;
/** A task Ledge gave, as the phone sees it: its owner, its team, its state and the start of its result. */
export const PhoneTaskSchema = z.object({
  id: z.string().max(40), title: z.string().max(200), owner: z.string().max(100), ownerName: z.string().max(80), ownerRole: z.string().max(40).optional(),
  team: z.string().max(40).optional(), teamName: z.string().max(60).optional(),
  state: z.enum(['open', 'taken', 'done', 'refused', 'dropped']), result: z.string().max(TOOL_TEXT_MAX).optional(), cut: z.literal(true).optional(),
  at: z.string(), updatedAt: z.string(), seen: z.literal(true).optional()
}).strict();
export type PhoneTask = z.infer<typeof PhoneTaskSchema>;

/** Why a question ended without an answer. */
export const ChatErrorCodeSchema = z.enum(['busy', 'timeout', 'cancelled', 'failed']);
export type ChatErrorCode = z.infer<typeof ChatErrorCodeSchema>;

export const PhoneChatTurnSchema = z.object({
  qid: OperationIdSchema, question: z.string().max(MESSAGE_MAX), askedAt: z.string().datetime(),
  steps: z.array(PhoneChatStepSchema).max(50), answer: z.string().max(THREAD_TEXT_MAX).optional(), answeredAt: z.string().datetime().optional(),
  error: ChatErrorCodeSchema.optional(), proposals: z.array(PhoneChatProposalSchema).max(MAX_PROPOSALS).optional(),
  relay: PhoneChatRelaySchema.optional(), closes: z.array(PhoneChatCloseSchema).min(1).max(MAX_PROPOSALS).optional(), cut: z.literal(true).optional(),
  team: PhoneChatTeamSchema.optional(), tasks: z.array(PhoneChatTaskSchema).min(1).max(MAX_PROPOSALS).optional()
}).strict();
export type PhoneChatTurn = z.infer<typeof PhoneChatTurnSchema>;

/** The `chat.history` sent to a phone keeps the most recent turns whose JSON fits: 60 % of `PLAIN_MAX`. */
export const CHAT_HISTORY_BUDGET = 393_216;

const sessionId = z.string().min(1).max(100);
/** The request the phone showed, named by its key. */
const PhoneExpectSchema = PendingSchema.pick({ kind: true, text: true }).extend({ key: z.string().min(1).max(64) });

/** The rows of a card the phone acts on: indexes into the card, none twice. */
const CardRowsSchema = z.array(z.number().int().min(0).max(MAX_PROPOSALS - 1)).min(1).max(MAX_PROPOSALS).refine(r => new Set(r).size === r.length, 'a row twice');

/** What the daemon accepts from a phone: this union is the whitelist. */
export const PhoneClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot.request') }),
  z.object({ type: z.literal('session.thread'), id: sessionId }),
  /** The session's request with its whole body (up to `PENDING_BODY_MAX`). */
  z.object({ type: z.literal('session.pending'), id: sessionId }),
  /** The session whose terminal the phone shows; null when it shows none. */
  z.object({ type: z.literal('session.watch'), id: sessionId.nullable() }),
  z.object({ type: z.literal('session.read'), id: sessionId, at: z.string().datetime() }),
  /** Asks for a challenge. One object for both purposes: the gateway refuses a `decide` without `id` and `expect`. */
  z.object({ type: z.literal('confirm.prepare'), purpose: ConfirmPurposeSchema, id: sessionId.optional(), expect: PhoneExpectSchema.optional(), qid: OperationIdSchema.optional() }),
  z.object({ type: z.literal('credential.register'), op: OperationIdSchema, credential: CredentialSchema }),
  z.object({
    type: z.literal('session.decide'), op: OperationIdSchema, id: sessionId, decision: DecisionSchema, note: z.string().trim().min(1).max(NOTE_MAX).optional(),
    /** The request the phone showed: refused unless it is still the pending one. */
    expect: PhoneExpectSchema,
    /** The device check over the challenge of `confirm.prepare`; required by the daemon for a high-risk accept. */
    assertion: AssertionSchema.optional()
  }),
  z.object({
    type: z.literal('session.reply'), op: OperationIdSchema, id: sessionId, text: z.string().min(1).max(MESSAGE_MAX),
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
  /** The phone drops its passkey from the daemon. */
  z.object({ type: z.literal('device.forget'), op: OperationIdSchema }),
  /** The phone's push subscription, with the VAPID key it was made with (so a key change is seen). */
  z.object({ type: z.literal('push.subscribe'), op: OperationIdSchema, subscription: PushSubscriptionSchema, key: B64U.length(87) }),
  z.object({ type: z.literal('push.unsubscribe'), op: OperationIdSchema }),
  /** The phone's own chat with Ledge. */
  z.object({ type: z.literal('chat.ask'), qid: OperationIdSchema, text: z.string().trim().min(1).max(MESSAGE_MAX) }),
  z.object({ type: z.literal('chat.cancel'), qid: OperationIdSchema }),
  z.object({ type: z.literal('chat.reset') }),
  z.object({ type: z.literal('chat.history') }),
  z.object({ type: z.literal('chat.relay'), op: OperationIdSchema, qid: OperationIdSchema }),
  z.object({ type: z.literal('chat.launch'), op: OperationIdSchema, qid: OperationIdSchema, rows: CardRowsSchema.optional(), assertion: AssertionSchema.optional() }),
  z.object({ type: z.literal('chat.close'), op: OperationIdSchema, qid: OperationIdSchema, rows: CardRowsSchema.optional(), assertion: AssertionSchema.optional() }),
  /** The turn's team card (roles spec §3.8): launched like a session card, with the device check (purpose `launch`, the turn). */
  z.object({ type: z.literal('chat.team'), op: OperationIdSchema, qid: OperationIdSchema, assertion: AssertionSchema.optional() }),
  /** A row of the turn's task card: given by Ledge. */
  z.object({ type: z.literal('chat.task'), op: OperationIdSchema, qid: OperationIdSchema, row: z.number().int().min(0).max(MAX_PROPOSALS - 1) }),
  /** « Reprendre » a resting team. */
  z.object({ type: z.literal('team.resume'), op: OperationIdSchema, team: z.string().min(1).max(40) }),
  /** Puts a closed task Ledge gave away from « À traiter ». */
  z.object({ type: z.literal('task.seen'), op: OperationIdSchema, task: z.string().min(1).max(40) }),
  /** Whether the phone's app is in front: a device that is visible gets no push. */
  z.object({ type: z.literal('presence'), visible: z.boolean() })
]);
export type PhoneClientMessage = z.infer<typeof PhoneClientMessageSchema>;

/** What the daemon sends a phone. */
export const PhoneServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), protocol: z.literal(PHONE_PROTOCOL), sessions: z.array(PhoneSessionSchema), capabilities: CapabilitiesByToolSchema, daemon: z.object({ version: z.string(), name: z.string().max(40), boot: z.string().uuid().optional() }), device: z.object({ confirm: z.boolean(), push: z.enum(['on', 'off', 'stale', 'unavailable']).optional(), chat: z.literal(true).optional() }).optional() }),
  z.object({ type: z.literal('confirm.challenge'), purpose: ConfirmPurposeSchema, challenge: B64U.max(64), rpId: z.string().max(253), credentialId: B64U.max(1_366).optional(), expiresInMs: z.number().int().positive() }),
  z.object({ type: z.literal('session.updated'), session: PhoneSessionSchema }),
  z.object({ type: z.literal('session.removed'), id: z.string() }),
  /** `pending.cut` is set when even this body was shortened. */
  z.object({ type: z.literal('session.pending'), id: z.string(), pending: PhonePendingSchema }),
  z.object({ type: z.literal('session.preview'), id: z.string(), lines: z.array(z.string()) }),
  /** `cut`: the ids of the items shortened; `more`: older items were left out. */
  z.object({ type: z.literal('session.thread'), id: z.string(), items: z.array(ThreadItemSchema), cut: z.array(z.string()), more: z.boolean() }),
  z.object({ type: z.literal('session.thread.item'), id: z.string(), item: ThreadItemSchema, cut: z.literal(true).optional() }),
  z.object({ type: z.literal('operation.result'), op: OperationIdSchema, status: OperationStatusSchema, reason: OperationReasonSchema.optional() }),
  z.object({ type: z.literal('chat.history'), turns: z.array(PhoneChatTurnSchema).max(50) }),
  z.object({ type: z.literal('chat.step'), qid: OperationIdSchema, step: PhoneChatStepSchema }),
  /** The whole text so far, not an increment. */
  z.object({ type: z.literal('chat.delta'), qid: OperationIdSchema, text: z.string().max(THREAD_TEXT_MAX) }),
  z.object({ type: z.literal('chat.done'), qid: OperationIdSchema, turn: PhoneChatTurnSchema }),
  z.object({ type: z.literal('chat.error'), qid: OperationIdSchema, code: ChatErrorCodeSchema }),
  /** The live teams, after each snapshot and on every change. */
  z.object({ type: z.literal('teams'), teams: z.array(PhoneTeamSchema).max(50) }),
  /** The tasks Ledge gave, open or closed lately, after each snapshot; then each change. */
  z.object({ type: z.literal('tasks'), tasks: z.array(PhoneTaskSchema).max(200) }),
  z.object({ type: z.literal('task.updated'), task: PhoneTaskSchema }),
  /** Never carries free text. */
  z.object({ type: z.literal('error'), code: z.enum(['invalid', 'unknown_session', 'too_large']), request: z.string().max(40).optional() })
]);
export type PhoneServerMessage = z.infer<typeof PhoneServerMessageSchema>;
