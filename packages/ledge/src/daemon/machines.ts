import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { MachinesSchema, type Machines } from '@ledge/protocol';
import { paths } from '../paths.js';
import { log } from '../log.js';

/** What a fresh install lists: the daemon itself. */
export const DEFAULT_MACHINES: Machines = [{ id: 'local', label: 'Local' }];

/** The machines the fronts share; anything unreadable or invalid falls back to the default and is left untouched (spec §5.2). */
export function readMachines(file = paths().machines): Machines {
  let raw: string;
  try { raw = readFileSync(file, 'utf8'); } catch { return DEFAULT_MACHINES; } // absent: a fresh install, nothing to say
  try { return MachinesSchema.parse(JSON.parse(raw)); }
  catch (e) { log(`machines.json is invalid, using the default list: ${(e as Error).message.split('\n')[0]}`); return DEFAULT_MACHINES; }
}

/** Written whole on each accepted `machines.set`; rename keeps a crash from leaving a half file. */
export function writeMachines(list: Machines, file = paths().machines): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n');
  renameSync(tmp, file);
}
