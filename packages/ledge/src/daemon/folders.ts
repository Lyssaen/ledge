import { mkdir, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { ServerMessage } from '@ledge/protocol';

type Listing = Extract<ServerMessage, { type: 'folder.listing' }>;

/** `raw` taken as given (a folder name may start or end with spaces): `~` expanded, absolute, an existing directory. */
async function resolveExact(raw: string, home: string): Promise<string> {
  const expanded = raw === '~' ? home : raw.startsWith('~/') ? resolve(home, raw.slice(2)) : raw;
  if (!isAbsolute(expanded)) throw new Error(`not an absolute path: ${raw}`);
  const path = resolve(expanded);
  let s;
  try { s = await stat(path); } catch { throw new Error(`no such folder: ${path}`); }
  if (!s.isDirectory()) throw new Error(`not a folder: ${path}`);
  return path;
}

/** A folder the user typed (a launch `cwd`): trimmed, `~` expanded, absolute, and an existing directory. Throws the reason otherwise. */
export async function resolveFolder(input: string, home = homedir()): Promise<string> {
  return resolveExact(input.trim(), home);
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The subfolders of `path`, hidden ones left out; a link counts when it leads to a folder. */
async function subfolders(path: string): Promise<string[]> {
  const found = await Promise.all((await readdir(path, { withFileTypes: true })).map(async d => {
    if (d.name.startsWith('.')) return null;
    if (d.isDirectory()) return d.name;
    if (!d.isSymbolicLink()) return null;
    try { return (await stat(join(path, d.name))).isDirectory() ? d.name : null; } catch { return null; }
  }));
  return found.filter((n): n is string => n !== null).sort(byName.compare);
}

/**
 * The browser's answer for `input` (home when absent or empty): its subfolders, or the reason it cannot be listed.
 * The path is never trimmed: the browser asks for paths it took from a listing, and a name may end with a space;
 * a refusal echoes the asked path byte for byte. Trimming typed input is the client's job.
 */
export async function listFolder(input: string | undefined, home = homedir()): Promise<Listing> {
  const asked = input || '~';
  try {
    const path = await resolveExact(asked, home);
    const parent = dirname(path);
    return { type: 'folder.listing', path, parent: parent === path ? null : parent, entries: await subfolders(path) };
  } catch (e) {
    return { type: 'folder.listing', path: asked, parent: null, entries: [], error: (e as Error).message };
  }
}

/** Makes `name` inside `parent` and lists it; a refusal lists `parent` with the reason, so the browser stays put. */
export async function createFolder(parent: string, name: string, home = homedir()): Promise<Listing> {
  const at = await listFolder(parent, home);
  if (at.error) return at;
  const clean = name.trim();
  if (!clean || clean === '.' || clean === '..' || /[/\0]/.test(clean)) return { ...at, error: `invalid folder name: ${name}` };
  try { await mkdir(join(at.path, clean)); } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { ...at, error: code === 'EEXIST' ? `already exists: ${clean}` : `cannot create ${clean}: ${(e as Error).message}` };
  }
  return listFolder(join(at.path, clean), home);
}
