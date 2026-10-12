import { isTauri } from '../tauri/bridge';

export interface AvailableUpdate { version: string; notes: string; downloadAndInstall(onProgress: (done: number, total: number | null) => void): Promise<void> }

/** The newer release from latest.json, or null (none, or not in the app: browser, tests). Throws on network errors. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const u = await check();
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
  if (!isTauri()) return null;
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}
