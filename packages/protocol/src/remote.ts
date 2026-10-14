import { z } from 'zod';

/** The remote entry (spec 2026-10-14 Ledge on the phone): the port the daemon listens on for the phone, and where the mobile app and its socket live. */
export const REMOTE_PORT = 47832;
export const MOBILE_BASE = '/m/';
export const MOBILE_WS_PATH = '/m/ws';
export const PAIR_CODE_TTL_MS = 120_000;
export const PAIR_MAX_ATTEMPTS = 5;
export const AUTH_TIMEOUT_MS = 5_000;
export const REMOTE_CLOSE = { unauthenticated: 4401, revoked: 4403, timeout: 4408 } as const;

/** A paired phone. `hasKey`: a WebAuthn credential is registered for it. */
export const DeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().optional(),
  hasKey: z.boolean()
});
export type Device = z.infer<typeof DeviceSchema>;

export const PairErrorSchema = z.enum(['not_configured', 'no_window', 'invalid_code', 'expired', 'locked', 'webauthn_failed']);
/** The inferred union; named apart so it never clashes with a `PairError` class. */
export type PairErrorReason = z.infer<typeof PairErrorSchema>;

export const RegistrationJsonSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  type: z.literal('public-key'),
  response: z.object({ clientDataJSON: z.string(), attestationObject: z.string() }).passthrough()
}).passthrough();
export type RegistrationJson = z.infer<typeof RegistrationJsonSchema>;
