import { readFileSync, writeFileSync, renameSync, chmodSync, unlinkSync } from 'node:fs';
import { z } from 'zod';
import { DEFAULT_RELAY_URL, MobileConfigSchema, type MobileConfig } from '@ledge/protocol';
import { exportIdentity, generateIdentity, importIdentity, type Identity } from '@ledge/seal';
import { paths } from '../paths.js';
import { log } from '../log.js';

const RelaySessionSchema = z.object({ token: z.string().min(1), accountId: z.string().min(1), login: z.string(), relayUrl: z.string() });
export type RelaySession = z.infer<typeof RelaySessionSchema>;

const ApprovedDeviceSchema = z.object({
  id: z.string().min(1), publicKey: z.string().min(1), label: z.string(), approvedAt: z.string(),
  lastPeer: z.string().optional(), lastSeenAt: z.string().optional()
});
export type ApprovedDevice = z.infer<typeof ApprovedDeviceSchema>;

/** Written whole through a private temp file then renamed: a crash leaves no half file, and the secret is never world-readable. */
function writePrivate(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

/** Absent file: null silently. Invalid file: null, with the name of the file in the log and never its content. */
function readJson<T>(file: string, name: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T | null {
  let raw: string;
  try { raw = readFileSync(file, 'utf8'); } catch { return null; }
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
  let stored: string | null = null;
  try { stored = readFileSync(file, 'utf8').trim(); } catch { /* none yet */ }
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
