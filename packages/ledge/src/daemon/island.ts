import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { CONTEXT_NEAR, ContextPrefsSchema, IslandPrefsSchema, type ContextPrefs, type IslandPrefs } from '@ledge/protocol';
import { paths } from '../paths.js';
import { log } from '../log.js';

/** The island's settings the fronts share; null while none was set (the island then sends its own) or the file is unreadable. */
export function readIsland(file = paths().island): IslandPrefs | null {
  let raw: string;
  try { raw = readFileSync(file, 'utf8'); } catch { return null; } // absent: never set, nothing to say
  try { return IslandPrefsSchema.parse(JSON.parse(raw)); }
  catch (e) { log(`island.json is invalid, waiting for a front to set it: ${(e as Error).message.split('\n')[0]}`); return null; }
}

/** Written whole on each accepted `island.set`; rename keeps a crash from leaving a half file. */
export function writeIsland(prefs: IslandPrefs, file = paths().island): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(prefs, null, 2) + '\n');
  renameSync(tmp, file);
}

/** The context threshold (context handover spec §3.2, « Contexte max »): the default when never set or unreadable. */
export function readContextPrefs(file: string): ContextPrefs {
  let raw: string;
  try { raw = readFileSync(file, 'utf8'); } catch { return { near: CONTEXT_NEAR }; }
  try { return ContextPrefsSchema.parse(JSON.parse(raw)); }
  catch (e) { log(`context.json is invalid, the default threshold applies: ${(e as Error).message.split('\n')[0]}`); return { near: CONTEXT_NEAR }; }
}

/** Written whole on each accepted `context.set`, as the island's. */
export function writeContextPrefs(prefs: ContextPrefs, file: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(prefs, null, 2) + '\n');
  renameSync(tmp, file);
}
