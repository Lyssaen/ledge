import { appendFileSync } from 'node:fs';
import { paths } from './paths.js';

export function log(line: string): void {
  try { appendFileSync(paths().log, `${new Date().toISOString()} | ${line}\n`); } catch { /* never throw from logging */ }
}
