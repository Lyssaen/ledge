import { spawn } from 'node:child_process';

type Spawn = typeof spawn;

/** `wslpath -w`: the Windows form of a WSL path. */
function windowsPath(file: string, spawnImpl: Spawn): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl('wslpath', ['-w', file], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout!.on('data', (d: Buffer) => { out += d; });
    child.on('error', reject);
    child.on('close', code => (code === 0 && out.trim() ? resolve(out.trim()) : reject(new Error(`wslpath exited with ${code}`))));
  });
}

/** Starts `file` detached and resolves once it started; what it does after is no concern of ours. */
function launch(spawnImpl: Spawn, file: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(file, args, { detached: true, stdio: 'ignore', ...(cwd ? { cwd } : {}) });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

/** Opens an image file in the system viewer. On WSL that is Windows' explorer.exe, which exits with 1 even when it opened the file:
 *  its exit code is not looked at. */
export async function openImage(file: string, env: NodeJS.ProcessEnv = process.env, spawnImpl: Spawn = spawn, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform === 'darwin') return launch(spawnImpl, 'open', [file]);
  if (env.WSL_DISTRO_NAME) return launch(spawnImpl, '/mnt/c/Windows/explorer.exe', [await windowsPath(file, spawnImpl)], '/mnt/c');
  return launch(spawnImpl, 'xdg-open', [file]);
}
