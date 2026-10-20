// HTTP answers of the relay's /auth routes, and the names a client must know to sign in and out.
import { z } from 'zod';
import { RelayPeerSchema } from './relay.js';

/** The phone's HttpOnly session cookie. */
export const RELAY_SESSION_COOKIE = 'ledge_session';
/** Close code of a socket whose session was revoked (sign-out, or a newer PC sign-in on the account). */
export const RELAY_CLOSE_SIGNED_OUT = 4001;
/** Close code of a socket replaced by a newer socket of the same peer: the client must not reconnect. */
export const RELAY_CLOSE_REPLACED = 4000;
/** Close code of a socket past the relay's rate limit: the client waits before reconnecting. */
export const RELAY_CLOSE_RATE_LIMITED = 4008;

export const DeviceStartResponseSchema = z.object({
  deviceCode: z.string().min(1),
  userCode: z.string().min(1),
  verificationUri: z.string().min(1),
  expiresIn: z.number().int().positive(),
  interval: z.number().int().positive()
});
export type DeviceStartResponse = z.infer<typeof DeviceStartResponseSchema>;

export const DevicePollResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('slow_down'), interval: z.number().int().positive() }),
  /** `token` is the relay session token, shown this once only. */
  z.object({ status: z.literal('ok'), token: z.string().min(1), accountId: z.string().min(1), login: z.string().min(1) }),
  z.object({ status: z.literal('expired') }),
  z.object({ status: z.literal('denied') }),
  z.object({ status: z.literal('not_allowed') })
]);
export type DevicePollResponse = z.infer<typeof DevicePollResponseSchema>;

export const DeviceRevokeResponseSchema = z.object({ revoked: z.number().int().min(0) });
export type DeviceRevokeResponse = z.infer<typeof DeviceRevokeResponseSchema>;

export const MeResponseSchema = z.object({
  accountId: z.string().min(1),
  login: z.string().min(1),
  peer: RelayPeerSchema,
  kind: z.enum(['pc', 'device'])
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
