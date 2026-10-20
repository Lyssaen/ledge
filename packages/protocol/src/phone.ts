import { z } from 'zod';
import { PendingSchema, SessionSchema, type Tool } from './session.js';
import { DecisionSchema, NOTE_MAX } from './decisions.js';
import { ThreadItemSchema } from './thread.js';
import { MESSAGE_MAX, RefusalCodeSchema } from './messages.js';

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
export const OperationReasonSchema = z.enum([...RefusalCodeSchema.options, 'untypable', 'confirm_required', 'conflict']);
export type OperationReason = z.infer<typeof OperationReasonSchema>;

/** What an adapter knows how to type for a phone, beyond accept, deny and an option number. A phone hides an answer its session's tool cannot give. */
export const CapabilitiesSchema = z.object({
  /** A question can be answered in free text. */
  freeTextAnswer: z.boolean()
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

/**
 * What a free answer may not carry, so that it is one line typed as shown: line breaks, control characters that could
 * drive the terminal (C0 such as ESC, CR, LF, tab; DEL; C1 such as CSI), line/paragraph separators, bidi overrides and
 * isolates, and zero-width spaces and the BOM (the zero-width joiners stay: emoji sequences and some scripts need them).
 */
export const UNTYPABLE = /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff]/;

/** Every tool's capabilities, in the phone's snapshot. */
export const CapabilitiesByToolSchema = z.object({ claude: CapabilitiesSchema, codex: CapabilitiesSchema, cursor: CapabilitiesSchema });
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
  state: true, helpers: true, lastReply: true, startedAt: true, lastActivityAt: true
}).extend({ pending: PhonePendingSchema.optional(), unread: z.boolean() });
export type PhoneSession = z.infer<typeof PhoneSessionSchema>;

const sessionId = z.string().min(1).max(100);
/** The request the phone showed, named by its key. */
const PhoneExpectSchema = PendingSchema.pick({ kind: true, text: true }).extend({ key: z.string().min(1).max(64) });

/** What the daemon accepts from a phone: this union is the whitelist. */
export const PhoneClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot.request') }),
  z.object({ type: z.literal('session.thread'), id: sessionId }),
  /** The session's request with its whole body (up to `PENDING_BODY_MAX`). */
  z.object({ type: z.literal('session.pending'), id: sessionId }),
  /** The session whose terminal the phone shows; null when it shows none. */
  z.object({ type: z.literal('session.watch'), id: sessionId.nullable() }),
  z.object({ type: z.literal('session.read'), id: sessionId, at: z.string().datetime() }),
  z.object({
    type: z.literal('session.decide'), op: OperationIdSchema, id: sessionId, decision: DecisionSchema, note: z.string().trim().min(1).max(NOTE_MAX).optional(),
    /** The request the phone showed: refused unless it is still the pending one. */
    expect: PhoneExpectSchema
  }),
  z.object({
    type: z.literal('session.reply'), op: OperationIdSchema, id: sessionId, text: z.string().min(1).max(MESSAGE_MAX),
    /** The request the reply answers, or null when the phone showed none: refused if the session's request is no longer that one. */
    expect: PhoneExpectSchema.nullable()
  }),
  z.object({ type: z.literal('session.interrupt'), op: OperationIdSchema, id: sessionId })
]);
export type PhoneClientMessage = z.infer<typeof PhoneClientMessageSchema>;

/** What the daemon sends a phone. */
export const PhoneServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), protocol: z.literal(PHONE_PROTOCOL), sessions: z.array(PhoneSessionSchema), capabilities: CapabilitiesByToolSchema, daemon: z.object({ version: z.string(), name: z.string().max(40) }) }),
  z.object({ type: z.literal('session.updated'), session: PhoneSessionSchema }),
  z.object({ type: z.literal('session.removed'), id: z.string() }),
  /** `pending.cut` is set when even this body was shortened. */
  z.object({ type: z.literal('session.pending'), id: z.string(), pending: PhonePendingSchema }),
  z.object({ type: z.literal('session.preview'), id: z.string(), lines: z.array(z.string()) }),
  /** `cut`: the ids of the items shortened; `more`: older items were left out. */
  z.object({ type: z.literal('session.thread'), id: z.string(), items: z.array(ThreadItemSchema), cut: z.array(z.string()), more: z.boolean() }),
  z.object({ type: z.literal('session.thread.item'), id: z.string(), item: ThreadItemSchema, cut: z.literal(true).optional() }),
  z.object({ type: z.literal('operation.result'), op: OperationIdSchema, status: OperationStatusSchema, reason: OperationReasonSchema.optional() }),
  /** Never carries free text. */
  z.object({ type: z.literal('error'), code: z.enum(['invalid', 'unknown_session', 'too_large']), request: z.string().max(40).optional() })
]);
export type PhoneServerMessage = z.infer<typeof PhoneServerMessageSchema>;
