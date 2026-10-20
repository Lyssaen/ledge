import { readFileSync, writeFileSync, renameSync, chmodSync, unlinkSync } from 'node:fs';
import { z } from 'zod';
import { DEFAULT_RELAY_URL, MobileConfigSchema, type MobileConfig } from '@ledge/protocol';
import { exportIdentity, generateIdentity, importIdentity, type Identity } from '@ledge/seal';
import { paths } from '../paths.js';
import { log } from '../log.js';

const RelaySessionSchema = z.object({ token: z.string().min(1), accountId: z.string().min(1), login: z.string(), relayUrl: z.string() });
export type RelaySession = z.infer<typeof RelaySessionSchema>;

/** Same fields as `DeviceCredential` (webauthn.ts, which imports nothing but node:crypto). */
const DeviceCredentialSchema = z.object({
  id: z.string().min(1), publicKey: z.string().min(1), alg: z.union([z.literal(-7), z.literal(-257)]), counter: z.number().int().nonnegative(),
  rpId: z.string().min(1), transports: z.array(z.string()).optional()
});

const ApprovedDeviceSchema = z.object({
  id: z.string().min(1), publicKey: z.string().min(1), label: z.string(), approvedAt: z.string(),
  lastPeer: z.string().optional(), lastSeenAt: z.string().optional(), credential: DeviceCredentialSchema.optional(),
  /** The phone's push subscription and the relay's VAPID key it was made with. */
  push: z.object({ endpoint: z.string().min(1), p256dh: z.string().min(1), auth: z.string().min(1), key: z.string().min(1) }).optional()
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

export function readMobileConfig(): MobileConfig {
  return readJson(paths().mobile, 'mobile.json', MobileConfigSchema) ?? DEFAULT_CONFIG();
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
    catch { log('mobile-key is invalid, creating a new key'); }
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
