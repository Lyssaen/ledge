// The PC's daemon updating or restarting itself, as the phone follows it (spec 2026-10-28 mobile daemon update): what was
// asked, the steps the daemon reports, and the end, which is the PC coming back with what was asked.
import { SEMVER, type PhoneServerMessage, type UpdateFailure } from '@ledge/protocol';
import { compareVersions } from '@ledge/ui/semver';

/** How long the phone waits for the PC to come back with what was asked: Desktop's own wait (`DAEMON_STALL_MS`). */
export const PC_STALL_MS = 4 * 60_000;

export interface PcRun {
  action: 'update' | 'restart';
  /** The version asked for; for a restart, the one running when it was asked. */
  version: string;
  /** The daemon's boot when it was asked: a restart is done once another boot answers. */
  boot: string | null;
  step: 'asked' | 'installing' | 'restarting' | 'done' | 'failed';
  /** `timeout`: the PC did not come back within `PC_STALL_MS`. */
  reason?: UpdateFailure | 'timeout';
}

/** A run neither done nor failed. */
export const pcRunning = (r: PcRun | null): r is PcRun & { step: 'asked' | 'installing' | 'restarting' } => r !== null && r.step !== 'done' && r.step !== 'failed';

/** Whether `version` is older than `than`; false when either is not a plain version (a dev build). */
export const olderThan = (version: string, than: string): boolean => SEMVER.test(version) && SEMVER.test(than) && compareVersions(version, than) < 0;

/** A step the daemon reports. One the phone did not ask for (another phone) is followed too: the PC is about to drop the link. */
export function pcProgress(r: PcRun | null, m: Extract<PhoneServerMessage, { type: 'daemon.progress' }>, boot: string | null): PcRun {
  if (pcRunning(r)) return { ...r, step: m.step };
  return { action: m.step === 'installing' ? 'update' : 'restart', version: m.version, boot, step: m.step };
}

/** The daemon refused: nothing changed. A refusal of a run this phone is not following is not its own. */
export const pcFailed = (r: PcRun | null, m: Extract<PhoneServerMessage, { type: 'daemon.failed' }>): PcRun | null =>
  pcRunning(r) ? { ...r, step: 'failed', reason: m.reason } : r;

/** A snapshot: an update is done once the PC runs the version asked for, a restart once another boot answers. */
export function pcSnapshot(r: PcRun | null, daemon: { version: string; boot?: string | undefined }): PcRun | null {
  if (!pcRunning(r)) return r;
  const done = r.action === 'update'
    ? SEMVER.test(daemon.version) && SEMVER.test(r.version) && compareVersions(daemon.version, r.version) >= 0
    : daemon.boot !== undefined && r.boot !== null && daemon.boot !== r.boot;
  return done ? { ...r, version: daemon.version, step: 'done' } : r;
}
