import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { IslandPrefsSchema, type IslandPrefs } from '@ledge/protocol';
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
