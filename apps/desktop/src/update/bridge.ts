import { isTauri } from '../tauri/bridge';

/** The island's updater bridge (apps/overlay/src/update/bridge.ts), same plugin calls. */
export interface AvailableUpdate { version: string; notes: string; downloadAndInstall(onProgress: (done: number, total: number | null) => void): Promise<void> }

/** The newer release from latest-desktop.json, or null (none, or not in the app: browser, tests). Throws on network errors. */
export async function checkForUpdate(channel: 'stable' | 'snapshot' = 'stable'): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;
  const { check, Update } = await import('@tauri-apps/plugin-updater');
  const metadata = channel === 'snapshot' ? await (await import('@tauri-apps/api/core')).invoke<ConstructorParameters<typeof Update>[0] | null>('check_snapshot_update') : null;
  const u = channel === 'snapshot' ? (metadata ? new Update(metadata) : null) : await check();
  if (!u) return null;
  return {
    version: u.version, notes: u.body ?? '',
    async downloadAndInstall(onProgress) {
      let done = 0; let total: number | null = null;
      await u.downloadAndInstall(e => {
        if (e.event === 'Started') total = e.data.contentLength ?? null;
        else if (e.event === 'Progress') { done += e.data.chunkLength; onProgress(done, total); }
      });
    }
  };
}

export async function relaunchApp(): Promise<void> {
  if (!isTauri()) return;
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

export async function appVersion(): Promise<string | null> {
  // The e2e build only (VITE_LEDGE_E2E): Playwright stands in for the app's version, so the daemons' update (#48) runs in the browser.
  if (import.meta.env.VITE_LEDGE_E2E) { const v = (window as unknown as { __ledgeAppVersion?: string }).__ledgeAppVersion; if (v) return v; }
  if (!isTauri()) return null;
  if (import.meta.env.VITE_LEDGE_SNAPSHOT_VERSION) return import.meta.env.VITE_LEDGE_SNAPSHOT_VERSION;
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}
