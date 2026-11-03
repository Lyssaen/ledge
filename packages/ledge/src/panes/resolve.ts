import { existsSync, statSync } from 'node:fs';
import { join, isAbsolute, win32 } from 'node:path';

/**
 * The program a pane runs, as Windows needs it: node-pty only finds a relative name if it exists as typed, so `claude`
 * becomes the `claude.exe` (or `.com`) first found along the child's Path. A `.cmd` / `.bat` shim is never taken: Node
 * refuses to start one without a shell, and the agent must be the real binary. Elsewhere the name goes as is.
 */
export function resolveCommand(file: string, env: Record<string, string | undefined>, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32' || isAbsolute(file) || win32.isAbsolute(file) || /[\\/]/.test(file)) return file;
  const key = Object.keys(env).find(k => k.toUpperCase() === 'PATH');
  const dirs = (key ? env[key] ?? '' : '').split(';').filter(Boolean);
  const names = /\.(exe|com)$/i.test(file) ? [file] : [`${file}.exe`, `${file}.com`];
  for (const dir of dirs) for (const name of names) {
    const p = join(dir, name);
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  throw new Error(`${file}: no .exe found on the PATH`);
}
