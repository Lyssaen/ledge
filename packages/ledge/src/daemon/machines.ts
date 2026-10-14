import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { MachinesSchema, type Machines } from '@ledge/protocol';
import { paths } from '../paths.js';

/** What a fresh install lists: the daemon itself. */
export const DEFAULT_MACHINES: Machines = [{ id: 'local', label: 'Local' }];

/** The machines the fronts share; anything unreadable or invalid falls back to the default and is left untouched (spec §5.2). */
export function readMachines(file = paths().machines): Machines {
  try { return MachinesSchema.parse(JSON.parse(readFileSync(file, 'utf8'))); } catch { return DEFAULT_MACHINES; }
}

/** Written whole on each accepted `machines.set`; rename keeps a crash from leaving a half file. */
export function writeMachines(list: Machines, file = paths().machines): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n');
  renameSync(tmp, file);
}
