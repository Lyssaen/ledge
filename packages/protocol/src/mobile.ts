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
/** `terminalInput`: a phone may type into an agent's terminal after its passkey (spec 2026-11-02 mobile terminal); absent = off. */
export const MobileConfigSchema = z.object({ enabled: z.boolean(), relayUrl: RelayUrlSchema, terminalInput: z.boolean().optional() });
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

/** A linked device's form: a tablet gets the wide layout's glyph on the PC. */
export const DeviceKindSchema = z.enum(['phone', 'tablet']);
export type DeviceKind = z.infer<typeof DeviceKindSchema>;

/** A device's name as the user gives it: trimmed, 1 to 40 characters, no control character. */
export const DEVICE_NAME_MAX = 40;
export const DeviceNameSchema = z.string().trim().min(1).max(DEVICE_NAME_MAX).regex(/^[^\u0000-\u001f\u007f]+$/);

/** The kind a pairing label names: `iPad`, or a label with « tablet »/« tablette », is a tablet; any other a phone. */
export function deviceKindOfLabel(label: string): DeviceKind {
  return /\b(iPad|tablet|tablette)\b/i.test(label) ? 'tablet' : 'phone';
}

/** A device pairing waiting for, or just past, the user's decision on the PC. */
export const MobilePairingSchema = z.object({
  id: z.string(),
  label: z.string(),
  code: z.string().nullable(),
  expiresAt: z.string().datetime(),
  state: z.enum(['waiting', 'confirm', 'approved', 'linked', 'expired', 'refused'])
});
export type MobilePairing = z.infer<typeof MobilePairingSchema>;

/** A device's return with its passkey after a reinstall. */
export const RecoveredSchema = z.object({ at: z.string().datetime(), model: z.string().max(40).optional(), pending: z.literal(true).optional() });

/** What the daemon tells its local fronts about mobile access. Never a token, a device code, a key or a message. */
export const MobileStateSchema = z.object({
  enabled: z.boolean(),
  relayUrl: z.string(),
  account: z.object({ login: z.string(), accountId: z.string() }).nullable(),
  signin: z.object({ userCode: z.string(), verificationUri: z.string(), expiresAt: z.string().datetime() }).nullable(),
  /** The last sign-in that did not end with a session; cleared by the next one. */
  signinError: z.enum(['expired', 'denied', 'not_allowed', 'failed']).nullable(),
  link: MobileLinkStateSchema,
  devices: z.array(z.object({
    id: z.string(), label: z.string(), approvedAt: z.string(), online: z.boolean(), lastSeenAt: z.string().optional(),
    /** Absent from an older daemon; `name` absent: the user gave none, the front derives one from the label. */
    kind: DeviceKindSchema.optional(), name: z.string().optional(),
    /** Its passkey can bring it back after a reinstall (registered with the PC key's digest, docs/mobile-passkey-recover-contract.md). */
    recover: z.literal(true).optional(),
    /** It came back with its passkey: when, on what it says it runs (`iPhone`, `iPad`), and `pending` until « C'était bien moi »
     *  (`mobile.device.ack` `recovered`). Kept after that, for the « reconnecté avec sa passkey le … » line. */
    recovered: RecoveredSchema.optional(),
    /** Another device tried to take its place with its passkey while it was connected; until « Compris » (`mobile.device.ack` `refused`). */
    refused: z.object({ at: z.string().datetime(), model: z.string().optional() }).optional()
  })),
  pairings: z.array(MobilePairingSchema),
  /** « Taper dans les terminaux depuis le téléphone »: absent from an older daemon, which has no phone terminal. */
  terminalInput: z.boolean().optional(),
  /** Passkey recovery on the account: `blocked` after 3 failed verifications, until « Débloquer » (`mobile.recovery.unblock`). */
  recovery: z.object({ blocked: z.object({ since: z.string().datetime(), failures: z.number().int().min(0) }).optional() }).optional()
});
export type MobileState = z.infer<typeof MobileStateSchema>;

/** What a front hears the moment a recovery happens, for its toast: a device `recovered`, an attempt `refused` (it was connected),
 *  recovery `blocked`. `id` the device concerned (absent for `blocked`). */
export const MobileRecoveryEventSchema = z.object({
  event: z.enum(['recovered', 'refused', 'blocked']), id: z.string().optional(), at: z.string().datetime()
});
export type MobileRecoveryEvent = z.infer<typeof MobileRecoveryEventSchema>;
