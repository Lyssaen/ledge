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
  z.object({
    type: z.literal('error'),
    code: z.enum(['bad_frame', 'too_large', 'bad_target', 'offline', 'rate_limited']),
    to: RelayPeerSchema.optional()
  })
]);
export type RelayServerMessage = z.infer<typeof RelayServerMessageSchema>;

/** The content of `body` between the PC and a device; the relay never reads it. */
export const SealedFrameSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('hello'), e: z.string() }),
  z.object({ k: z.literal('msg'), s: z.string() })
]);
export type SealedFrame = z.infer<typeof SealedFrameSchema>;

export function parseRelayClientMessage(raw: unknown): RelayClientMessage {
  return RelayClientMessageSchema.parse(raw);
}
export function parseRelayServerMessage(raw: unknown): RelayServerMessage {
  return RelayServerMessageSchema.parse(raw);
}
