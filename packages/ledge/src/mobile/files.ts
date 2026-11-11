import { readFileSync, writeFileSync, renameSync, chmodSync, unlinkSync } from 'node:fs';
import { z } from 'zod';
import { DEFAULT_RELAY_URL, DeviceKindSchema, DeviceNameSchema, DevicePrefsSchema, MobileConfigSchema, RecoveredSchema, type MobileConfig } from '@ledge/protocol';
import { exportIdentity, generateIdentity, importIdentity, type Identity } from '@ledge/seal';
import { paths } from '../paths.js';
import { log } from '../log.js';

const RelaySessionSchema = z.object({ token: z.string().min(1), accountId: z.string().min(1), login: z.string(), relayUrl: z.string() });
export type RelaySession = z.infer<typeof RelaySessionSchema>;

/** Same fields as `DeviceCredential` (webauthn.ts, which imports nothing but node:crypto). */
const DeviceCredentialSchema = z.object({
  id: z.string().min(1), publicKey: z.string().min(1), alg: z.union([z.literal(-7), z.literal(-257)]), counter: z.number().int().nonnegative(),
  rpId: z.string().min(1), transports: z.array(z.string()).optional(),
  /** Registered with the PC key's digest in its `user.id`: it can bring the device back after a reinstall. */
  recover: z.literal(true).optional()
});

/** How many relay peers are kept per device: enough for a few sign-ins again, never a growing list. */
export const MAX_DEVICE_PEERS = 8;

const ApprovedDeviceSchema = z.object({
  id: z.string().min(1), publicKey: z.string().min(1), label: z.string(), approvedAt: z.string(),
  lastPeer: z.string().optional(), lastSeenAt: z.string().optional(), credential: DeviceCredentialSchema.optional(),
  /** The phone's push subscription and the relay's VAPID key it was made with; `resolved`: its service worker shows a `resolved` push. */
  push: z.object({ endpoint: z.string().min(1), p256dh: z.string().min(1), auth: z.string().min(1), key: z.string().min(1), resolved: z.literal(true).optional() }).optional(),
  /** Phone or tablet, from the pairing label; absent on a device approved before it was kept. */
  kind: DeviceKindSchema.optional(),
  /** The name the user gave it; absent means the default name the fronts derive. */
  name: DeviceNameSchema.optional(),
  /** Every relay peer that confirmed a channel for it, newest last (at most MAX_DEVICE_PEERS): all are revoked with it. */
  peers: z.array(z.string().min(1)).max(MAX_DEVICE_PEERS).optional(),
  /** The settings the device chose from its Réglages (`device.prefs`); absent: the defaults. A value this daemon cannot read is
   *  dropped alone (`catch`), never the whole list of devices. */
  prefs: DevicePrefsSchema.optional().catch(undefined),
  /** It came back with its passkey after a reinstall (`pending` until « C'était bien moi »). */
  recovered: RecoveredSchema.optional().catch(undefined),
  /** Put back with its passkey, but its new key has not said hello yet: the phone may not have kept the PC's key (P19). Desktop
   *  is told nothing until that hello turns it into `recovered`; never shown to the fronts. */
  recovering: z.object({ at: z.string(), model: z.string().optional() }).optional().catch(undefined),
  /** Another device tried to take its place with its passkey while it was connected (until « Compris »). */
  refused: z.object({ at: z.string(), model: z.string().optional() }).optional().catch(undefined)
});
export type ApprovedDevice = z.infer<typeof ApprovedDeviceSchema>;

/** Written whole through a private temp file then renamed: a crash leaves no half file, and the secret is never world-readable. */
function writePrivate(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

/** Only a missing file is "absent": any other read error (EACCES, EIO...) must not read as "no file", or the next write would replace it. */
function readText(file: string, name: string): string | null {
  try { return readFileSync(file, 'utf8'); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`${name} cannot be read (${(e as NodeJS.ErrnoException).code ?? 'error'})`);
  }
}

/** Absent file: null silently. Invalid file: null, with the name of the file in the log and never its content. Unreadable file: throws. */
function readJson<T>(file: string, name: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T | null {
  const raw = readText(file, name);
  if (raw === null) return null;
  try { return schema.parse(JSON.parse(raw)); }
  catch { log(`${name} is invalid, ignoring it`); return null; }
}

const DEFAULT_CONFIG = (): MobileConfig => ({ enabled: false, relayUrl: DEFAULT_RELAY_URL });

/** The relay of the first lots: a config that still names it reads as the default relay. The file is not rewritten. */
const LEGACY_RELAY_URL = 'https://server.ledge.paradow.dev';

export function readMobileConfig(): MobileConfig {
  const c = readJson(paths().mobile, 'mobile.json', MobileConfigSchema);
  if (!c) return DEFAULT_CONFIG();
  return c.relayUrl === LEGACY_RELAY_URL ? { ...c, relayUrl: DEFAULT_RELAY_URL } : c;
}

export function writeMobileConfig(c: MobileConfig): void {
  writePrivate(paths().mobile, JSON.stringify(MobileConfigSchema.parse(c), null, 2) + '\n');
}

/** The session belongs to the relay it was opened on: another relay in the config means no session. */
export function readRelaySession(): RelaySession | null {
  const s = readJson(paths().mobileSession, 'mobile-session.json', RelaySessionSchema);
  return s && s.relayUrl === readMobileConfig().relayUrl ? s : null;
}

export function writeRelaySession(s: RelaySession): void {
  writePrivate(paths().mobileSession, JSON.stringify(RelaySessionSchema.parse(s), null, 2) + '\n');
}

export function clearRelaySession(): void {
  try { unlinkSync(paths().mobileSession); } catch { /* already absent */ }
}

/** The PC's key: PKCS8 base64url only; the public key is always derived from it, never read from a copy. */
export async function loadPcIdentity(): Promise<Identity> {
  const file = paths().mobileKey;
  const stored = readText(file, 'mobile-key')?.trim();
  if (stored) {
    try { return await importIdentity(stored); }
    catch {
      // Kept aside, not overwritten: the paired phones know the old key.
      const backup = `${file}.bad-${new Date().toISOString().replace(/:/g, '-')}`;
      renameSync(file, backup);
      chmodSync(backup, 0o600);
      log(`mobile-key is invalid, moved to ${backup}, creating a new key`);
    }
  }
  const id = await generateIdentity({ extractable: true });
  writePrivate(file, await exportIdentity(id));
  return importIdentity(await exportIdentity(id));
}

export function readDevices(): ApprovedDevice[] {
  return readJson(paths().devices, 'devices.json', z.array(ApprovedDeviceSchema)) ?? [];
}

export function writeDevices(list: ApprovedDevice[]): void {
  writePrivate(paths().devices, JSON.stringify(z.array(ApprovedDeviceSchema).parse(list), null, 2) + '\n');
}

/** A relay peer whose revocation the relay has not confirmed yet. */
const RevocationSchema = z.object({ peer: z.string().min(1), at: z.string() });
export type Revocation = z.infer<typeof RevocationSchema>;

export function readRevocations(): Revocation[] {
  return readJson(paths().revocations, 'revocations.json', z.array(RevocationSchema)) ?? [];
}

export function writeRevocations(list: Revocation[]): void {
  writePrivate(paths().revocations, JSON.stringify(z.array(RevocationSchema).parse(list), null, 2) + '\n');
}

/**
 * Passkey recovery's memory (recovery.json): the passkeys of revoked devices for 90 days (`tombstones`, for « révoqué le … »), the
 * times of the last recoveries asked (5 an hour) and of the failed verifications (3 block), and the block until « Débloquer ».
 */
const RecoveryFileSchema = z.object({
  tombstones: z.array(z.object({ credentialId: z.string().min(1), device: z.string(), revokedAt: z.string() })).default([]),
  attempts: z.array(z.string()).default([]),
  failures: z.array(z.string()).default([]),
  blocked: z.object({ since: z.string(), failures: z.number().int().min(0) }).optional()
});
export type RecoveryFile = z.infer<typeof RecoveryFileSchema>;

export function readRecovery(): RecoveryFile {
  return readJson(paths().recovery, 'recovery.json', RecoveryFileSchema) ?? { tombstones: [], attempts: [], failures: [] };
}

export function writeRecovery(r: RecoveryFile): void {
  writePrivate(paths().recovery, JSON.stringify(RecoveryFileSchema.parse(r), null, 2) + '\n');
}
