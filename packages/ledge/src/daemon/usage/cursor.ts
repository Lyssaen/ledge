// Cursor Agent's usage (docs/mockups/ledge-harness-usage.html), from the dashboard RPC Cursor's own app reads. The token is the
// one Cursor Agent keeps in auth.json: read, never refreshed, never written, never logged. Expired, Ledge says so and waits for
// Cursor Agent to renew it. The percentages are Cursor's own, rounded: never recomputed from the amounts.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsageWindow } from '@ledge/protocol';

export const CURSOR_USAGE_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined);

/** The JWT's payload, unverified (the API judges the token): undefined when it is not a JWT. */
function jwtPayload(token: string): Json | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return undefined;
  try { return obj(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))); } catch { return undefined; }
}

/** auth.json under $CURSOR_CONFIG_DIR, else ~/.config/cursor. null: absent or no accessToken; 'expired': the JWT's exp has passed.
 *  Read only. The account is an opaque id from the JWT's `sub`, null when unreadable. */
export async function readCursorToken(home: string, env: NodeJS.ProcessEnv, now: number, read: (p: string) => Promise<string> = p => readFile(p, 'utf8')): Promise<{ token: string; account: string | null } | 'expired' | null> {
  const dir = env.CURSOR_CONFIG_DIR?.trim() || join(home, '.config', 'cursor');
  let o: Json | undefined;
  try { o = obj(JSON.parse(await read(join(dir, 'auth.json')))); } catch { return null; }
  const token = typeof o?.accessToken === 'string' ? o.accessToken.trim() : '';
  if (!token) return null;
  const payload = jwtPayload(token);
  if (typeof payload?.exp === 'number' && payload.exp * 1000 <= now) return 'expired';
  const sub = typeof payload?.sub === 'string' && payload.sub ? payload.sub : null;
  return { token, account: sub ? createHash('sha256').update(`ledge-usage:cursor:${sub}`).digest('hex').slice(0, 12) : null };
}

const pctOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1000, Math.max(0, Math.round(v))) : undefined);
const msOf = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) && !Number.isNaN(new Date(n).getTime()) ? n : undefined;
};

/** The answer as windows: the total (the month, or the week when the cycle is under 10 days), then Cursor's own models and the
 *  others when they are numbers. [] when `planUsage.totalPercentUsed` is missing (« not read »); null when the body is not an object. */
export function parseCursorUsage(body: unknown): UsageWindow[] | null {
  const o = obj(body);
  if (!o) return null;
  const plan = obj(o.planUsage);
  const total = pctOf(plan?.totalPercentUsed);
  if (!plan || total === undefined) return [];
  const start = msOf(o.billingCycleStart), end = msOf(o.billingCycleEnd);
  const resetsAt = end === undefined ? null : new Date(end).toISOString();
  const week = start !== undefined && end !== undefined && end - start < 10 * 86_400_000;
  const windows: UsageWindow[] = [{ kind: week ? 'seven_day' : 'month', pct: total, resetsAt }];
  const auto = pctOf(plan.autoPercentUsed), api = pctOf(plan.apiPercentUsed);
  if (auto !== undefined) windows.push({ kind: 'pool', pool: 'cursor', pct: auto, resetsAt });
  if (api !== undefined) windows.push({ kind: 'pool', pool: 'other', pct: api, resetsAt });
  return windows;
}
