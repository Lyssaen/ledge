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
  z.object({ k: z.literal('rekey') })
]);
export type SealedFrame = z.infer<typeof SealedFrameSchema>;

export function parseRelayClientMessage(raw: unknown): RelayClientMessage {
  return RelayClientMessageSchema.parse(raw);
}
export function parseRelayServerMessage(raw: unknown): RelayServerMessage {
  return RelayServerMessageSchema.parse(raw);
}
