// Claude Code's account limits (docs/mockups/ledge-harness-usage.html), from Anthropic's usage API, as Claude Code's own
// /usage reads them. The token is the one Claude Code keeps: read, never refreshed, never written. Expired, Ledge says so and
// waits for Claude Code to sign in again.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsageWindow } from '@ledge/protocol';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined);

/** The token Claude Code signed in with: `CLAUDE_CODE_OAUTH_TOKEN`, else `~/.claude/.credentials.json` (`claudeAiOauth`).
 *  `expired`: its `expiresAt` has passed. null: not signed in (or unreadable). The file is only read. */
export async function readClaudeToken(home: string, env: NodeJS.ProcessEnv, now: number, read: (p: string) => Promise<string> = p => readFile(p, 'utf8')): Promise<{ token: string } | 'expired' | null> {
  const fromEnv = env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv };
  let raw: string;
  try { raw = await read(join(home, '.claude', '.credentials.json')); } catch { return null; }
  let o: Json | undefined;
  try { o = obj(obj(JSON.parse(raw))?.claudeAiOauth); } catch { return null; }
  const token = typeof o?.accessToken === 'string' ? o.accessToken.trim() : '';
  if (!token) return null;
  const expiresAt = typeof o?.expiresAt === 'number' ? o.expiresAt : undefined;
  if (expiresAt !== undefined && expiresAt <= now) return 'expired';
  return { token };
}

/** An opaque id of the account Claude Code is signed in to (`~/.claude.json` `oauthAccount`): 12 hex of a hash, the same on
 *  every machine signed in to it. Never the uuid itself, never the email. null when it cannot be read. */
export async function readClaudeAccount(home: string, read: (p: string) => Promise<string> = p => readFile(p, 'utf8')): Promise<string | null> {
  let raw: string;
  try { raw = await read(join(home, '.claude.json')); } catch { return null; }
  try {
    const a = obj(obj(JSON.parse(raw))?.oauthAccount);
    const id = typeof a?.accountUuid === 'string' ? a.accountUuid : '';
    if (!id) return null;
    const org = typeof a?.organizationUuid === 'string' ? a.organizationUuid : '';
    return createHash('sha256').update(`ledge-usage:claude:${id}:${org}`).digest('hex').slice(0, 12);
  } catch { return null; }
}

/** Claude Code's version (`claude --version`, `2.1.318 (Claude Code)`): the API answers a request without a real version in
 *  its User-Agent about once an hour. Never invented: undefined when it cannot be read. */
export function claudeVersion(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile('claude', ['--version'], { env, timeout: 10_000 }, (err, stdout) => {
      const m = /^(\d+\.\d+\.\d+[A-Za-z0-9.+-]*)\b/.exec(String(stdout ?? '').trim());
      resolve(!err && m ? m[1] : undefined);
    });
  });
}

const pctOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1000, Math.round(v))) : undefined);
const isoOf = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
/** `seven_day_opus` → `Opus`. */
const modelName = (key: string): string => key.charAt(0).toUpperCase() + key.slice(1);

/**
 * The API's answer as windows: `five_hour` and `seven_day` (`utilization`, a percent, and `resets_at`), then one week per model:
 * the flat `seven_day_<model>` fields, and the `limits[]` entries of kind `weekly_scoped` named by `scope.model.display_name`
 * (newer accounts), one per model, the flat field first. Anything else in it (extra usage, the plan) is not read.
 */
export function parseClaudeUsage(body: unknown): UsageWindow[] {
  const r = obj(body);
  if (!r) return [];
  const out: UsageWindow[] = [];
  for (const kind of ['five_hour', 'seven_day'] as const) {
    const w = obj(r[kind]);
    const pct = pctOf(w?.utilization);
    if (pct !== undefined) out.push({ kind, pct, resetsAt: isoOf(w?.resets_at) });
  }
  const seen = new Set<string>();
  for (const [key, v] of Object.entries(r)) {
    const m = /^seven_day_([a-z][a-z0-9_]*)$/.exec(key);
    if (!m || m[1] === 'oauth_apps' || m[1] === 'cowork') continue;
    const w = obj(v);
    const pct = pctOf(w?.utilization);
    if (pct === undefined) continue;
    const model = modelName(m[1]!);
    seen.add(model.toLowerCase());
    out.push({ kind: 'model', model, pct, resetsAt: isoOf(w?.resets_at) });
  }
  const limits = Array.isArray(r.limits) ? r.limits : [];
  const scoped = new Map<string, Json>();
  for (const raw of limits) {
    const l = obj(raw);
    if (l?.kind !== 'weekly_scoped') continue;
    const name = obj(obj(l.scope)?.model)?.display_name;
    if (typeof name !== 'string' || !name.trim() || name.length > 80 || pctOf(l.percent) === undefined) continue;
    const key = name.trim().toLowerCase();
    if (seen.has(key)) continue;
    const prev = scoped.get(key);
    if (!prev || (l.is_active === true && prev.is_active !== true)) scoped.set(key, { ...l, name: name.trim() });
  }
  for (const l of scoped.values()) out.push({ kind: 'model', model: l.name as string, pct: pctOf(l.percent)!, resetsAt: isoOf(l.resets_at) });
  return out.slice(0, 20);
}
