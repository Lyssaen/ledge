import { z } from 'zod';

/** The relay the daemon and the overlay use until the user picks another one. */
export const DEFAULT_RELAY_URL = 'https://app.kl-ledge.dev';

/** A relay URL reduced to its origin: https, or http for localhost and 127.0.0.1 only; no path, query or fragment. */
export const RelayUrlSchema = z.string().transform((v, ctx) => {
  const bad = (): never => { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid relay URL' }); return z.NEVER; };
  let u: URL;
  try { u = new URL(v.replace(/\/$/, '')); } catch { return bad(); }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return bad();
  if (u.username || u.password || u.pathname !== '/' || u.search || u.hash) return bad();
  return u.origin;
});

/** Mobile access settings kept in mobile.json. */
export const MobileConfigSchema = z.object({ enabled: z.boolean(), relayUrl: RelayUrlSchema });
export type MobileConfig = z.infer<typeof MobileConfigSchema>;

/** The daemon's relay link, as the fronts see it. */
export const MobileLinkStateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('off') }),
  z.object({ state: z.literal('connecting') }),
  z.object({ state: z.literal('online') }),
  z.object({ state: z.literal('offline'), retryAt: z.string().datetime(), error: z.string() }),
  z.object({ state: z.literal('signed_out'), reason: z.enum(['other_pc', 'session_invalid']) }),
  /** The mobile service did not start (a broken mobile.json, a missing key store): nothing is linked until the daemon restarts. */
  z.object({ state: z.literal('unavailable'), error: z.string().max(200) })
]);
export type MobileLinkState = z.infer<typeof MobileLinkStateSchema>;

/** A device pairing waiting for, or just past, the user's decision on the PC. */
export const MobilePairingSchema = z.object({
  id: z.string(),
  label: z.string(),
  code: z.string().nullable(),
  expiresAt: z.string().datetime(),
  state: z.enum(['waiting', 'confirm', 'approved', 'linked', 'expired', 'refused'])
});
export type MobilePairing = z.infer<typeof MobilePairingSchema>;

/** What the daemon tells its local fronts about mobile access. Never a token, a device code, a key or a message. */
export const MobileStateSchema = z.object({
  enabled: z.boolean(),
  relayUrl: z.string(),
  account: z.object({ login: z.string(), accountId: z.string() }).nullable(),
  signin: z.object({ userCode: z.string(), verificationUri: z.string(), expiresAt: z.string().datetime() }).nullable(),
  /** The last sign-in that did not end with a session; cleared by the next one. */
  signinError: z.enum(['expired', 'denied', 'not_allowed', 'failed']).nullable(),
  link: MobileLinkStateSchema,
  devices: z.array(z.object({ id: z.string(), label: z.string(), approvedAt: z.string(), online: z.boolean(), lastSeenAt: z.string().optional() })),
  pairings: z.array(MobilePairingSchema)
});
export type MobileState = z.infer<typeof MobileStateSchema>;
