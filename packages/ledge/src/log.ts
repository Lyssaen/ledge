import { appendFileSync } from 'node:fs';
import { paths } from './paths.js';

/**
 * Text from outside (a header, a library's error message) made safe for one log line: quoted, control characters
 * escaped, so it can neither break the line nor forge another one; capped at `max` characters.
 */
export function quote(text: unknown, max = 200): string {
  const s = String(text);
  return JSON.stringify(s.length > max ? `${s.slice(0, max)}…` : s);
}

export function log(line: string): void {
  try { appendFileSync(paths().log, `${new Date().toISOString()} | ${line}\n`); } catch { /* never throw from logging */ }
}
