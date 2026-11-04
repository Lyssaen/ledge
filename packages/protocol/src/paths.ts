/**
 * Folder paths of every machine Ledge reaches, read in the browser and in Node alike (no `node:path`). Two shapes, told
 * apart by the string itself: POSIX (`/home/po/work`) and Windows (`C:\Users\po\work`, `\\nas\share`), for the daemon that
 * runs natively on Windows (spec 2026-11-03 §1). A Windows path has one written form (backslashes, upper-case drive, no
 * trailing separator but at a root) and compares without case; a POSIX path behaves exactly as it always did.
 */

const DRIVE = /^[A-Za-z]:(?:[\\/]|$)/;
const UNC = /^[\\/]{2}[^\\/]/;

/** A drive path (`C:\…`, `c:/…`, `C:`) or a UNC share (`\\server\share`). */
export function isWindowsPath(p: string): boolean { const t = p.trim(); return DRIVE.test(t) || UNC.test(t); }

/** An absolute path of either shape (`C:x`, relative to a drive's current folder, is not). */
export function isAbsolutePath(p: string): boolean { return p.startsWith('/') || isWindowsPath(p); }

/** The written form a path is stored and compared in. POSIX: trimmed, no repeated slash, no trailing slash but for `/`.
 *  Windows: `\` only, the drive upper-case, no repeated or trailing `\` but at the root (`C:\`), the UNC `\\` kept. */
export function normalizePath(raw: string): string {
  const t = raw.trim();
  if (!isWindowsPath(t)) {
    const p = t.replace(/\/+/g, '/');
    return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
  }
  if (UNC.test(t)) {
    const rest = t.replace(/^[\\/]+/, '').replace(/[\\/]+/g, '\\').replace(/\\$/, '');
    return `\\\\${rest}`;
  }
  const drive = t[0]!.toUpperCase();
  const rest = t.slice(2).replace(/[\\/]+/g, '\\').replace(/\\$/, '');
  return `${drive}:${rest.startsWith('\\') ? rest : `\\${rest}`}`;
}

/** What two paths are compared by: the written form, without case for Windows. */
export function pathKey(p: string): string { const n = normalizePath(p); return isWindowsPath(n) ? n.toLowerCase() : n; }

export function samePath(a: string, b: string): boolean { return pathKey(a) === pathKey(b); }

const sepOf = (p: string) => (isWindowsPath(p) ? '\\' : '/');

/** The root a Windows path stands on: `C:\` or `\\server\share`. */
function windowsRoot(n: string): string {
  if (!n.startsWith('\\\\')) return n.slice(0, 3);
  const parts = n.slice(2).split('\\');
  return `\\\\${parts.slice(0, 2).join('\\')}`;
}

/** Whether `path` is `folder` or lies below it, on whole segments (`/w` does not hold `/wx`); `/`, a drive root and a UNC
 *  share hold everything on them. */
export function pathUnder(path: string, folder: string): boolean {
  const p = pathKey(path), f = pathKey(folder);
  if (isWindowsPath(p) !== isWindowsPath(f)) return false;
  if (p === f) return true;
  if (!isWindowsPath(f)) return f === '/' || p.startsWith(`${f}/`);
  return f === windowsRoot(f) && f.endsWith('\\') ? p.startsWith(f) : p.startsWith(`${f}\\`);
}

/** The last segment; a root is its own name (`/`, `C:\`, `\\nas\share`). */
export function baseName(p: string): string {
  const n = normalizePath(p);
  if (parentPath(n) === null) return n;
  return n.slice(n.lastIndexOf(sepOf(n)) + 1);
}

/** The folder holding `p`, or null at a root. */
export function parentPath(p: string): string | null {
  const n = normalizePath(p);
  if (!isWindowsPath(n)) {
    if (n === '/' || !n.startsWith('/')) return null;
    const i = n.lastIndexOf('/');
    return i === 0 ? '/' : n.slice(0, i);
  }
  const root = windowsRoot(n);
  if (n === root) return null;
  const i = n.lastIndexOf('\\');
  const up = n.slice(0, i);
  return up.length < root.length || (root.endsWith('\\') && up === root.slice(0, -1)) ? root : up;
}

/** `name` inside `dir`, with `dir`'s separator. */
export function joinPath(dir: string, name: string): string {
  const d = normalizePath(dir), s = sepOf(d);
  return d.endsWith(s) ? `${d}${name}` : `${d}${s}${name}`;
}

/** The folders from the root down to `p`, each with the label a breadcrumb shows (the drive as `C:`). */
export function pathCrumbs(p: string): { label: string; path: string }[] {
  const out: { label: string; path: string }[] = [];
  for (let at: string | null = normalizePath(p); at !== null; at = parentPath(at)) {
    const up = parentPath(at);
    out.unshift({ label: up === null ? (isWindowsPath(at) ? at.replace(/\\$/, '') : at) : baseName(at), path: at });
  }
  return out;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** A new folder's name its machine would refuse or misread: empty, `.`/`..`, a separator or NUL anywhere; under a Windows
 *  folder also `\ : * ? " < > |`, a trailing dot or space, and the device names (`CON`, `NUL.txt`…). */
export function badFolderName(name: string, parent: string): boolean {
  if (!name || name === '.' || name === '..' || /[/\0]/.test(name)) return true;
  if (!isWindowsPath(parent)) return false;
  return /[\\:*?"<>|]/.test(name) || /[. ]$/.test(name) || WINDOWS_RESERVED.test(name);
}

/** `path` as it reads under `home`: the home is `~`, what lies inside it `~` then the rest (`~/w`, `~\w`). Without a home,
 *  with `/` as one, or outside it: the path as is. For display only. */
export function homeShort(path: string, home: string | undefined): string {
  if (!home) return path;
  const h = normalizePath(home);
  if (h === '/' || parentPath(h) === null) return path;
  if (samePath(path, h)) return '~';
  return pathUnder(path, h) ? `~${normalizePath(path).slice(h.length)}` : path;
}
