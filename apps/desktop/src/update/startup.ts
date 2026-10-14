import { appVersion, checkForUpdate, relaunchApp } from './bridge';

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* in-memory only */ } };

export interface StartupUpdateDeps { check?: typeof checkForUpdate; relaunch?: typeof relaunchApp; version?: typeof appVersion; now?: () => number }
export type StartupUpdate = 'skipped' | 'none' | 'installed' | 'failed';

/** The island's start-up check (spec §1, §11), with the same `desktop.update.*` keys (§7): when automatic checks are on,
 *  look for a newer Desktop once and install it, then relaunch. Desktop has no update card before lot 7, so the install
 *  is not offered first. The daemon's own update stays the island's (§11). Never throws. */
export async function updateAtStartup(deps: StartupUpdateDeps = {}): Promise<StartupUpdate> {
  if (get('desktop.update.auto') === '0') return 'skipped';
  try {
    const u = await (deps.check ?? checkForUpdate)();
    set('desktop.update.checkedAt', String((deps.now ?? Date.now)()));
    if (!u) return 'none';
    const from = await (deps.version ?? appVersion)();
    if (from) set('desktop.update.from', from);
    // A manifest ahead of the installed binary would otherwise reinstall on every start: one attempt per version.
    if (get('desktop.update.attempted') === u.version && from !== u.version) return 'skipped';
    set('desktop.update.attempted', u.version);
    await u.downloadAndInstall(() => {});
    await (deps.relaunch ?? relaunchApp)();
    return 'installed';
  } catch {
    return 'failed';  // offline, unreachable or a broken download: the next start tries again
  }
}
