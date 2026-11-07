// The daemon's usage service (docs/mockups/ledge-harness-usage.html): each harness's account limits, their state, the alerts
// past the threshold, and the threshold and the « Compris » it keeps (`~/.ledge/usage.json`).
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { USAGE_ALERT, UsagePrefsSchema, usageAlertId, type HarnessUsage, type UsageAlert, type UsagePrefs, type UsageStateMessage, type UsageWindow } from '@ledge/protocol';
import { log } from '../../log.js';
import { USAGE_URL, claudeVersion, parseClaudeUsage, readClaudeAccount, readClaudeToken } from './claude.js';
import { CURSOR_USAGE_URL, parseCursorUsage, readCursorToken } from './cursor.js';
import { httpsGet, httpsPost, type HttpsGet, type HttpsPost } from './net.js';

/** At most one read of Anthropic's API per this long (another reader, Claude Code's own, shares the account's quota). */
export const READ_EVERY_MS = 2 * 60_000;
/** Cursor's dashboard RPC is read at most this often. */
export const CURSOR_READ_EVERY_MS = 5 * 60_000;
/** Cursor's values are `stale` past this without a read that succeeded. */
export const CURSOR_STALE_MS = 15 * 60_000;
/** After a 429, the wait doubles up to this. */
export const BACKOFF_MAX_MS = 15 * 60_000;
/** The longest Retry-After waited: a longer one is waited this long, then the read is tried again. Kept on purpose (decided
 *  2026-11-05): a technical guard against a mistaken header leaving the limits unreadable for good; one try a day is negligible
 *  for the API. See docs/superpowers/specs/2026-11-05-harness-usage-design.md. */
export const RETRY_AFTER_MAX_MS = 24 * 60 * 60_000;
/** Past this without a read that succeeded, the values are `stale`; past an hour they are no longer sent. */
export const STALE_MS = 5 * 60_000;
export const HIDE_MS = 60 * 60_000;
const TICK_MS = 30_000;
const HTTP_MS = 15_000;
/** How long the account and Claude Code's version are kept before they are read again. */
const REREAD_MS = 10 * 60_000;

export type UsageState = Omit<UsageStateMessage, 'type' | 'machineId'>;
export interface UsageService {
  state(): UsageState;
  /** Reads what is due now (Anthropic's API at most every `READ_EVERY_MS`), then tells the listeners if anything changed. */
  tick(): Promise<void>;
  start(): void;
  stop(): void;
  onChange(fn: (s: UsageState) => void): () => void;
  /** Codex's limits from a transcript a turn just ended in (`codexLimits`), when they were reported: no window when its plan
   *  gives none. An older reading than the one kept is ignored, an empty one included. */
  observeCodex(limits: { windows: UsageWindow[]; at: string }): void;
  setPrefs(prefs: UsagePrefs): void;
  /** « Compris »: false when no such alert is open. */
  ack(id: string): boolean;
}

export interface UsageDeps {
  home: string;
  env: () => Promise<NodeJS.ProcessEnv>;
  file: string;
  now?: () => number;
  get?: HttpsGet;
  post?: HttpsPost;
  read?: (p: string) => Promise<string>;
  version?: (env: NodeJS.ProcessEnv) => Promise<string | undefined>;
}

/** The threshold, the alerts put away, and when each open alert was first seen. */
interface Kept { prefs: UsagePrefs; acks: string[]; seen: Record<string, string> }
function readKept(file: string): Kept {
  try {
    const o = JSON.parse(readFileSync(file, 'utf8')) as { alert?: unknown; acks?: unknown; seen?: unknown };
    const p = UsagePrefsSchema.safeParse({ alert: o.alert });
    const acks = Array.isArray(o.acks) ? o.acks.filter((a): a is string => typeof a === 'string' && a.length <= 200).slice(-200) : [];
    const seen: Record<string, string> = {};
    if (o.seen && typeof o.seen === 'object') for (const [k, v] of Object.entries(o.seen as Record<string, unknown>)) if (k.length <= 200 && typeof v === 'string' && !Number.isNaN(Date.parse(v))) seen[k] = new Date(v).toISOString();
    return { prefs: p.success ? p.data : { alert: USAGE_ALERT }, acks, seen };
  } catch { return { prefs: { alert: USAGE_ALERT }, acks: [], seen: {} }; }
}
function writeKept(file: string, k: Kept): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ alert: k.prefs.alert, acks: k.acks, seen: k.seen }, null, 2) + '\n');
  renameSync(tmp, file);
}

/** The reset an alert id names (its last part): an ack past it is dropped, the window having started again. */
const resetOfId = (id: string): number => { const t = Date.parse(id.slice(id.lastIndexOf('|') + 1)); return Number.isNaN(t) ? Infinity : t; };

export function createUsage(deps: UsageDeps): UsageService {
  const now = deps.now ?? Date.now;
  const get = deps.get ?? httpsGet;
  const post = deps.post ?? httpsPost;
  const version = deps.version ?? claudeVersion;
  const listeners = new Set<(s: UsageState) => void>();
  const kept = readKept(deps.file);

  // Claude Code.
  let signedIn = false, failed = false, attempted = false;
  let readAt: number | null = null, windows: UsageWindow[] = [], nextAt = 0, backoff = 0;
  /** Who is signed in, as last seen: the account (the token's fingerprint when the account is not known). Another account signed
   *  in since: the previous one's windows and refusal are dropped, never shown under it. */
  let identityOf: string | null = null;
  /** The two causes of « expired », which can hold together: the token in Claude Code's file is past its time (`localExpired`,
   *  read again on each tick), and Anthropic refused the token of the account signed in (`refused`, a 401). A refusal ends only
   *  with a read that succeeds or another account signing in: a token that expires then comes back meanwhile does not end it. */
  let localExpired = false, refused = false;
  let account: string | null = null, accountAt = -Infinity, accountOf = '';
  let ua: string | undefined, uaAt = -Infinity;
  // Cursor Agent: the same shape, its own state. Its token is read, never refreshed.
  const cur = { listed: false, failed: false, attempted: false, readAt: null as number | null, windows: [] as UsageWindow[], nextAt: 0, backoff: 0,
    refused: false, localExpired: false, account: null as string | null, identity: null as string | null };
  // Codex.
  let codex: { windows: UsageWindow[]; at: number } | null = null;
  let last = '';
  let timer: ReturnType<typeof setInterval> | null = null;
  let reading: Promise<void> | null = null;
  // The login shell's environment (its proxy) is read once in a while, not on each tick: a login shell is slow to start.
  let envCache: { env: Promise<NodeJS.ProcessEnv>; at: number } | null = null;
  const envOf = (): Promise<NodeJS.ProcessEnv> => {
    if (!envCache || now() - envCache.at > REREAD_MS) {
      const entry = { env: deps.env(), at: now() };
      envCache = entry;
      // A failed read is not kept: the next caller asks again.
      entry.env.catch(() => { if (envCache === entry) envCache = null; });
    }
    return envCache.env;
  };

  const statusOf = (s: { localExpired: boolean; refused: boolean; attempted: boolean; failed: boolean; readAt: number | null } = { localExpired, refused, attempted, failed, readAt }, staleMs = STALE_MS): HarnessUsage['status'] => {
    if (s.localExpired || s.refused) return 'expired';
    if (!s.attempted && s.readAt === null) return 'loading';
    if (s.failed) return 'unreachable';
    if (s.readAt === null || now() - s.readAt > staleMs) return s.readAt === null ? 'loading' : 'stale';
    return 'ok';
  };
  const shown = (w: UsageWindow[], at: number | null): UsageWindow[] => (at === null || now() - at > HIDE_MS ? [] : w);

  function harnesses(): HarnessUsage[] {
    const out: HarnessUsage[] = [];
    if (signedIn) {
      const status = statusOf();
      out.push({ harness: 'claude', account, status, readAt: readAt === null ? null : new Date(readAt).toISOString(),
        windows: status === 'expired' || status === 'loading' ? [] : shown(windows, readAt) });
    }
    if (codex && codex.windows.length) {
      const w = shown(codex.windows, codex.at);
      if (w.length) out.push({ harness: 'codex', account: null, status: now() - codex.at > STALE_MS ? 'stale' : 'ok', readAt: new Date(codex.at).toISOString(), windows: w });
    }
    if (cur.listed) {
      const status = statusOf(cur, CURSOR_STALE_MS);
      out.push({ harness: 'cursor', account: cur.account, status, readAt: cur.readAt === null ? null : new Date(cur.readAt).toISOString(),
        windows: status === 'expired' || status === 'loading' ? [] : shown(cur.windows, cur.readAt) });
    }
    return out;
  }

  /** The ids of the alerts open now, put away or not. */
  function openIds(hs: HarnessUsage[]): Set<string> {
    const at = kept.prefs.alert * 100;
    const ids = new Set<string>();
    for (const h of hs) for (const w of h.windows) { const level = w.pct >= 100 ? 'full' : w.pct >= at ? 'threshold' : null; if (level) ids.add(usageAlertId(h.harness, h.account, w, level)); }
    return ids;
  }

  function alerts(hs: HarnessUsage[]): UsageAlert[] {
    const out: UsageAlert[] = [];
    const at = kept.prefs.alert * 100;
    for (const h of hs) for (const w of h.windows) {
      const level = w.pct >= 100 ? 'full' : w.pct >= at ? 'threshold' : null;
      if (!level) continue;
      const id = usageAlertId(h.harness, h.account, w, level);
      if (!kept.acks.includes(id)) out.push({ id, harness: h.harness, account: h.account, window: w, level, at: kept.seen[id] ?? new Date(now()).toISOString() });
    }
    return out.slice(0, 40);
  }

  const state = (): UsageState => { const hs = harnesses(); return { harnesses: hs, alerts: alerts(hs), prefs: { ...kept.prefs } }; };
  /** Remembers when each open alert was first seen (kept with the file: a restart does not make it new again). */
  const markSeen = (s: UsageState): void => {
    let changed = false;
    for (const a of s.alerts) if (!kept.seen[a.id]) { kept.seen[a.id] = a.at; changed = true; }
    if (changed) save();
  };
  const emit = (): void => {
    const s = state();
    markSeen(s);
    const json = JSON.stringify(s);
    if (json === last) return;
    last = json;
    for (const fn of listeners) fn(s);
  };
  const save = (): void => { try { writeKept(deps.file, kept); } catch (e) { log(`usage.json not written: ${(e as Error).message}`); } };

  async function readClaude(): Promise<void> {
    const env = await envOf();
    const home = deps.home;
    const token = await readClaudeToken(home, env, now(), deps.read);
    signedIn = token !== null;
    if (token === null) { localExpired = false; return; }
    // The account is told only for the token Claude Code keeps in its file, the one `~/.claude.json` goes with; an environment
    // token may be another account's: none then. A token that changed (another sign-in) has its account read again.
    const which = token === 'expired' ? 'file:expired' : `${token.from}:${createHash('sha256').update(token.token).digest('hex')}`;
    if (which !== accountOf || now() - accountAt > REREAD_MS) {
      account = token !== 'expired' && token.from === 'env' ? null : await readClaudeAccount(home, deps.read);
      accountAt = now(); accountOf = which;
    }
    if (token === 'expired') { localExpired = true; return; }
    // A valid token again (Claude Code signed in again): its own expiry is over; a refusal of this account still stands.
    localExpired = false;
    // The windows belong to the account they were read for: Claude Code refreshing its token keeps them, another account signed
    // in drops them at once (shown as loading, or unreachable while a 429's wait runs). The next read stays when it was due.
    const identity = account ?? which;
    if (identityOf !== null && identityOf !== identity) {
      windows = []; readAt = null;
      // Anthropic's refusal was the previous account's: the new one is not expired, it is not read yet.
      refused = false;
    }
    identityOf = identity;
    if (now() < nextAt) return;
    if (now() - uaAt > REREAD_MS || !ua) { ua = await version(env); uaAt = now(); }
    attempted = true;
    const headers: Record<string, string> = { Authorization: `Bearer ${token.token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json', ...(ua ? { 'User-Agent': `claude-code/${ua}` } : {}) };
    const r = await get(USAGE_URL, headers, env, HTTP_MS);
    if (r.status === 200) {
      let body: unknown;
      try { body = JSON.parse(r.body); } catch { body = undefined; }
      const w = parseClaudeUsage(body);
      if (w.length) { windows = w; readAt = now(); failed = false; refused = false; backoff = 0; nextAt = now() + READ_EVERY_MS; return; }
      failed = true; nextAt = now() + READ_EVERY_MS;
      log('usage: Anthropic answered without any window');
      return;
    }
    if (r.status === 401) { refused = true; failed = false; nextAt = now() + READ_EVERY_MS; log('usage: Claude Code session expired (401)'); return; }
    failed = true;
    if (r.status === 429) {
      backoff++;
      // Ledge's own doubling stops at 15 minutes; a longer wait the API asks for (Retry-After, in seconds) is kept as asked, up to
      // a day: a longer one is waited a day (a guard against a mistaken header leaving the limits unread for good).
      const after = Number(r.headers['retry-after']);
      const asked = Number.isFinite(after) && after > 0 ? Math.min(RETRY_AFTER_MAX_MS, after * 1000) : 0;
      const wait = Math.max(Math.min(BACKOFF_MAX_MS, READ_EVERY_MS * 2 ** backoff), asked);
      nextAt = now() + wait;
      log(`usage: Anthropic rate-limited the read (429), next in ${Math.round(wait / 1000)} s${ua ? '' : ' (no Claude Code version for the User-Agent)'}`);
      return;
    }
    nextAt = now() + READ_EVERY_MS;
    // Never the token, never the body: the status or the reason only.
    log(`usage: Anthropic not read (${r.status ? `HTTP ${r.status}` : r.error ?? 'no answer'})`);
  }

  async function readCursor(): Promise<void> {
    const env = await envOf();
    const token = await readCursorToken(deps.home, env, now(), deps.read);
    cur.listed = token !== null;
    if (token === null) { cur.localExpired = false; return; }
    // Another account signed in (an expired token included): the previous one's windows and refusal are dropped, never shown under it.
    const identity = token.account ?? `token:${createHash('sha256').update(token.token).digest('hex')}`;
    cur.account = token.account;
    if (cur.identity !== null && cur.identity !== identity) { cur.windows = []; cur.readAt = null; cur.refused = false; }
    cur.identity = identity;
    cur.localExpired = 'expired' in token;
    if ('expired' in token) return;
    if (now() < cur.nextAt) return;
    cur.attempted = true;
    const r = await post(CURSOR_USAGE_URL, { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' }, '{}', env, HTTP_MS);
    cur.nextAt = now() + CURSOR_READ_EVERY_MS;
    if (r.status === 200) {
      let body: unknown;
      try { body = JSON.parse(r.body); } catch { body = undefined; }
      const w = parseCursorUsage(body);
      if (w) { cur.windows = w; cur.readAt = now(); cur.failed = false; cur.refused = false; cur.backoff = 0; return; }
      cur.failed = true;
      log('usage: Cursor not read (unreadable answer)');
      return;
    }
    if (r.status === 401) { cur.refused = true; cur.failed = false; log('usage: Cursor Agent session expired (401)'); return; }
    cur.failed = true;
    if (r.status === 429) {
      cur.backoff++;
      const after = Number(r.headers['retry-after']);
      const asked = Number.isFinite(after) && after > 0 ? Math.min(RETRY_AFTER_MAX_MS, after * 1000) : 0;
      const wait = Math.max(Math.min(BACKOFF_MAX_MS, CURSOR_READ_EVERY_MS * 2 ** cur.backoff), asked);
      cur.nextAt = now() + wait;
      log(`usage: Cursor rate-limited the read (429), next in ${Math.round(wait / 1000)} s`);
      return;
    }
    // Never the token, never the body: the status or the reason only.
    log(`usage: Cursor not read (${r.status ? `HTTP ${r.status}` : r.error ?? 'no answer'})`);
  }

  async function tick(): Promise<void> {
    // Each source is read on its own: one throwing never stops the other.
    if (!reading) reading = (async () => {
      await readClaude().catch(e => { failed = true; log(`usage: read failed: ${(e as Error).message}`); });
      await readCursor().catch(e => { cur.failed = true; log(`usage: Cursor read failed: ${(e as Error).message}`); });
    })().finally(() => { reading = null; });
    await reading;
    // Acks of windows that started again are no longer needed.
    const before = kept.acks.length;
    kept.acks = kept.acks.filter(id => resetOfId(id) > now());
    const seenBefore = Object.keys(kept.seen).length;
    for (const id of Object.keys(kept.seen)) if (resetOfId(id) <= now()) delete kept.seen[id];
    // An id without a reset never ends by itself: it is dropped once its alert is no longer open.
    const open = openIds(harnesses());
    kept.acks = kept.acks.filter(id => resetOfId(id) !== Infinity || open.has(id));
    for (const id of Object.keys(kept.seen)) if (resetOfId(id) === Infinity && !open.has(id)) delete kept.seen[id];
    if (kept.acks.length !== before || Object.keys(kept.seen).length !== seenBefore) save();
    emit();
  }

  return {
    state, tick,
    start() { if (timer) return; void tick(); timer = setInterval(() => { void tick(); }, TICK_MS); timer.unref?.(); },
    stop() { if (timer) clearInterval(timer); timer = null; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    observeCodex(limits) {
      const at = Date.parse(limits.at);
      if (Number.isNaN(at)) return;
      // A later turn of another session may report an older reading, with windows or without: the newest wins.
      if (codex && at < codex.at) return;
      codex = { windows: limits.windows, at };
      emit();
    },
    setPrefs(prefs) { kept.prefs = { alert: prefs.alert }; save(); emit(); },
    ack(id) {
      if (!alerts(harnesses()).some(a => a.id === id)) return false;
      kept.acks = [...kept.acks.filter(a => a !== id), id].slice(-200);
      save(); emit();
      return true;
    }
  };
}
