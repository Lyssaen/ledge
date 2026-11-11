// Frames between clients (PC, phones) and the relay server. Unrelated to RelayBlock in proposal.ts (agent-to-agent).
import { z } from 'zod';

/** Maximum length, in characters, of a sealed body. */
export const SEALED_MAX = 1_048_576;

/** `'pc'` or a device identifier. */
export const RelayPeerSchema = z.union([z.literal('pc'), z.string().regex(/^d_[A-Za-z0-9_-]{16,40}$/)]);
export type RelayPeer = z.infer<typeof RelayPeerSchema>;

export const RelayClientMessageSchema = z.object({
  type: z.literal('send'),
  to: RelayPeerSchema,
  body: z.string().max(SEALED_MAX)
});
export type RelayClientMessage = z.infer<typeof RelayClientMessageSchema>;

export const RelayServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('welcome'), accountId: z.string(), self: RelayPeerSchema, online: z.array(RelayPeerSchema) }),
  z.object({ type: z.literal('deliver'), from: RelayPeerSchema, body: z.string() }),
  z.object({ type: z.literal('presence'), peer: RelayPeerSchema, online: z.boolean() }),
  /**
   * A frame was refused; `to` names the target when it is known.
   * Contract: an error concerning a sealed body (`offline`, `too_large`, or a socket closed with 4008
   * `rate_limited`) means that body was not delivered, so the sequence on that channel is lost: the
   * sender must re-handshake with that peer before sending to it again.
   */
  z.object({
    type: z.literal('error'),
    code: z.enum(['bad_frame', 'too_large', 'bad_target', 'offline', 'rate_limited']),
    to: RelayPeerSchema.optional()
  })
]);
export type RelayServerMessage = z.infer<typeof RelayServerMessageSchema>;

/** Maximum length of a device label in a `pair_commit` frame, after trim. */
export const PAIR_LABEL_MAX = 40;

const KeyB64 = z.string().regex(/^[A-Za-z0-9_-]{87}$/);
const Nonce = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const Fingerprint = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const B64U = z.string().regex(/^[A-Za-z0-9_-]*$/);

/**
 * Why the PC refused a passkey recovery (`recover_no`), or why the phone stopped before sending (docs/mobile-passkey-recover-contract.md):
 * - from the phone, before anything is sent: `none` no passkey was used (none, or Face ID cancelled: iOS says the same),
 *   `old` the passkey predates recovery (no « L1 » in its userHandle), `offline` the PC is not on the relay,
 *   `otherPc` the passkey was made for another PC key, `timeout` no answer in time;
 * - from the PC: `revoked` the device was revoked (or is unknown), `connected` the device it names is connected right now,
 *   `rate` 5 recoveries in the last hour, `blocked` 3 failed verifications (until « Débloquer » on the PC),
 *   `failed` anything else (a stale or reused nonce, a proof that does not verify): the phone shows it as `timeout`.
 */
export const RecoverWhySchema = z.enum(['none', 'old', 'offline', 'otherPc', 'timeout', 'revoked', 'connected', 'rate', 'blocked', 'failed']);
export type RecoverWhy = z.infer<typeof RecoverWhySchema>;
/** The reasons the PC itself sends in `recover_no`. */
export const RecoverRefusalSchema = RecoverWhySchema.extract(['revoked', 'connected', 'rate', 'blocked', 'failed']);
export type RecoverRefusal = z.infer<typeof RecoverRefusalSchema>;
/** How long the PC's recovery nonce lives, and so how long the phone waits for an answer before `timeout`. */
export const RECOVER_TTL_MS = 60_000;
/** A device model in `recover_start` (`iPhone`, `iPad`…), as short as a pairing label. */
const ModelLabel = z.string().trim().min(1).max(PAIR_LABEL_MAX);
/** A WebAuthn assertion as the phone encodes it (the same bounds as the phone protocol's `AssertionSchema`). */
const RecoverAssertion = z.object({
  id: B64U.max(1_366), clientDataJSON: B64U.max(4_096), authenticatorData: B64U.max(4_096), signature: B64U.max(1_024)
}).strict();

/** The content of `body` between the PC and a device; the relay never reads it. */
export const SealedFrameSchema = z.discriminatedUnion('k', [
  /** `e` is the ephemeral key, `f` the fingerprint of the sender's static key. */
  z.object({ k: z.literal('hello'), e: KeyB64, f: Fingerprint }),
  z.object({ k: z.literal('msg'), s: z.string() }),
  z.object({ k: z.literal('pair_commit'), c: Nonce, label: z.string().trim().min(1).max(PAIR_LABEL_MAX) }),
  z.object({ k: z.literal('pair_offer'), pc: KeyB64, n: Nonce }),
  z.object({ k: z.literal('pair_reveal'), d: KeyB64, n: Nonce }),
  z.object({ k: z.literal('pair_ok') }),
  z.object({ k: z.literal('pair_no') }),
  z.object({ k: z.literal('denied') }),
  z.object({ k: z.literal('rekey') }),
  // ── Passkey recovery after a reinstall (unsealed, like pairing: nothing in them lets the relay act) ──
  /** Phone → PC: the app's new device key `d`, its nonce `n`, and what it runs on (`iPhone`, `iPad`), told to the PC as it is. */
  z.object({ k: z.literal('recover_start'), d: KeyB64, n: Nonce, model: ModelLabel.optional() }),
  /** PC → phone: its key `pc`, a one-use nonce `n` (60 s), and its name (`WSL`), for the phone's screens. */
  z.object({ k: z.literal('recover_offer'), pc: KeyB64, n: Nonce, name: z.string().max(PAIR_LABEL_MAX).optional() }),
  /** Phone → PC: the discoverable assertion over `recoverChallenge(pc, d, pcNonce, n)`, and its `userHandle` (« L1 » ‖ digest ‖ random). */
  z.object({ k: z.literal('recover_proof'), assertion: RecoverAssertion, userHandle: B64U.max(128) }),
  /** PC → phone: the device is back under its new key; `name` the one it keeps. The phone pins the PC key, then says `hello`. */
  z.object({ k: z.literal('recover_ok'), name: z.string().max(PAIR_LABEL_MAX).optional() }),
  /** PC → phone: refused. `device` the device the passkey names (`revoked`, `connected`); `revokedAt` when it was revoked (ISO,
   *  `revoked` within 90 days); `retryInMs` until a recovery is taken again (`rate`). */
  z.object({ k: z.literal('recover_no'), why: RecoverRefusalSchema, device: z.string().max(PAIR_LABEL_MAX).optional(),
    revokedAt: z.string().datetime().optional(), retryInMs: z.number().int().min(0).optional() })
]);
export type SealedFrame = z.infer<typeof SealedFrameSchema>;

export function parseRelayClientMessage(raw: unknown): RelayClientMessage {
  return RelayClientMessageSchema.parse(raw);
}
export function parseRelayServerMessage(raw: unknown): RelayServerMessage {
  return RelayServerMessageSchema.parse(raw);
}
