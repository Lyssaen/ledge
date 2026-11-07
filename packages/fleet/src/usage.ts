/** The harness limits (docs/mockups/ledge-harness-usage.html), as every front shows them: Desktop, the TUI. */
import { USAGE_ALERT, type UsageAlert, type UsageHarness, type UsageStateMessage, type UsageStatus, type UsageWindow } from '@ledge/protocol';

/**
 * The harness limits as the footer shows them (docs/mockups/ledge-harness-usage.html, v2 variant B): one group per account
 * (M3), whichever machines read it. A machine that is not connected cannot say its values are still true: they show as old.
 */
export interface UsageGroup {
  key: string;
  harness: UsageHarness;
  /** The machines signed in to that account, the local one first (ids). */
  machines: string[];
  status: UsageStatus;
  readAt: string | null;
  /** The 5 hours and the week first, then one per model; empty when there is nothing recent enough to show. */
  windows: UsageWindow[];
}

/** Values read more than an hour ago are never shown (M9). */
export const USAGE_SHOWN_MS = 60 * 60_000;
const HARNESS_ORDER: Record<UsageHarness, number> = { claude: 0, codex: 1, cursor: 2 };

const newer = (a: string | null, b: string | null) => (a ?? '') > (b ?? '');

/** The groups, Claude Code before Codex, the local machine's first. `online(id)`: is that machine connected now. */
export function usageGroups(states: ReadonlyMap<string, UsageStateMessage>, online: (machine: string) => boolean, now: number): UsageGroup[] {
  const groups = new Map<string, UsageGroup>();
  const machines = [...states.keys()].sort((a, b) => (a === 'local' ? -1 : b === 'local' ? 1 : 0));
  for (const machine of machines) {
    const up = online(machine);
    for (const h of states.get(machine)!.harnesses) {
      // Codex has no account to tell: one group per machine.
      const key = h.account ? `${h.harness}|${h.account}` : `${h.harness}|@${machine}`;
      let status = h.status;
      // Not connected: whatever it said last is old now; never « loading » forever either.
      if (!up && (status === 'ok' || status === 'loading')) status = 'stale';
      const fresh = h.readAt !== null && now - Date.parse(h.readAt) <= USAGE_SHOWN_MS;
      const mine: UsageGroup = { key, harness: h.harness, machines: [machine], status, readAt: h.readAt, windows: fresh ? h.windows : [] };
      const had = groups.get(key);
      if (!had) { groups.set(key, mine); continue; }
      had.machines.push(machine);
      // Two machines, one account: the most recent read speaks for it.
      if (newer(mine.readAt, had.readAt)) Object.assign(had, { status: mine.status, readAt: mine.readAt, windows: mine.windows });
    }
  }
  return [...groups.values()].sort((a, b) => HARNESS_ORDER[a.harness] - HARNESS_ORDER[b.harness]);
}

/** The threshold, as the local machine keeps it (each machine has a copy, all set together). */
export function usageThreshold(states: ReadonlyMap<string, UsageStateMessage>): number {
  return (states.get('local') ?? states.values().next().value)?.prefs.alert ?? USAGE_ALERT;
}

/**
 * The open alerts, once each (the same account on two machines raises the same one), the newest first. A machine that is not
 * connected cannot say its alert still holds: it counts only while its reading of that account is under an hour old (M9), as
 * its windows do.
 */
export function usageAlerts(states: ReadonlyMap<string, UsageStateMessage>, online: (machine: string) => boolean = () => true, now: number = Date.now()): UsageAlert[] {
  const byId = new Map<string, UsageAlert>();
  for (const [machine, s] of states) {
    const up = online(machine);
    for (const a of s.alerts) {
      if (byId.has(a.id)) continue;
      if (!up) {
        const read = s.harnesses.find(h => h.harness === a.harness && h.account === a.account)?.readAt;
        if (!read || now - Date.parse(read) > USAGE_SHOWN_MS) continue;
      }
      byId.set(a.id, a);
    }
  }
  return [...byId.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** The 5 hours, the week or month, the pools, and the models and pools past the threshold (the rest stays in the detail). */
export function shownWindows(g: UsageGroup, threshold: number): {
  five?: UsageWindow; week?: UsageWindow; month?: UsageWindow;
  /** The pools (kind 'pool'), Cursor's first. */ pools: UsageWindow[];
  /** Models and pools past the threshold. */ hot: UsageWindow[];
  models: UsageWindow[];
} {
  const models = g.windows.filter(w => w.kind === 'model');
  const pools = g.windows.filter(w => w.kind === 'pool').sort((a, b) => Number(a.pool === 'other') - Number(b.pool === 'other'));
  const past = (w: UsageWindow) => w.pct >= threshold * 100;
  return {
    five: g.windows.find(w => w.kind === 'five_hour'),
    week: g.windows.find(w => w.kind === 'seven_day'),
    month: g.windows.find(w => w.kind === 'month'),
    pools,
    hot: [...models.filter(past), ...pools.filter(past)],
    models
  };
}

/** ok, freshly read (under an hour), and nothing to show: « limite non lue ». */
export function isUnread(g: Pick<UsageGroup, 'status' | 'windows' | 'readAt'>, now: number): boolean {
  return g.status === 'ok' && g.readAt !== null && now - Date.parse(g.readAt) <= USAGE_SHOWN_MS && g.windows.length === 0;
}

/** Neutral under the threshold, amber past it, red at 100 %. */
export function usageTone(pct: number, threshold: number): '' | 'amber' | 'red' {
  return pct >= 100 ? 'red' : pct >= threshold * 100 ? 'amber' : '';
}

const pad = (n: number) => String(n).padStart(2, '0');
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const weekday = (d: Date, lang: string) => d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'short' });

const dateOf = (d: Date, lang: string) => d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short' });

/** A reset a week or more away reads as a date, not a weekday. */
export function resetIsDate(iso: string, now: number): boolean {
  return Date.parse(iso) - now >= 7 * 86_400_000;
}

/** When a window starts again, short (the footer): `14:30` today, `lun.` another day, `1 déc.` a week or more away. */
export function resetShort(iso: string, now: number, lang: string): string {
  const d = new Date(iso);
  if (resetIsDate(iso, now)) return dateOf(d, lang);
  return sameDay(d, new Date(now)) ? hm(d) : weekday(d, lang);
}

/** When a window starts again, long (the detail): `14:30` today, `lun. 09:00` another day, `1 déc. 13:43` a week or more away. */
export function resetLong(iso: string, now: number, lang: string): string {
  const d = new Date(iso);
  if (resetIsDate(iso, now)) return `${dateOf(d, lang)} ${hm(d)}`;
  return sameDay(d, new Date(now)) ? hm(d) : `${weekday(d, lang)} ${hm(d)}`;
}

/** A span of time: `40 s`, `12 min`, `2 h 10`, `4 j` (`4 d`). */
export function span(ms: number, lang: string): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${pad(m % 60)}`;
  return `${Math.floor(h / 24)} ${lang === 'fr' ? 'j' : 'd'}`;
}

/** A model id as people say it: `claude-opus-5-5` → « Opus 5.5 », `fable` → « Fable »; anything else as it is. */
export function modelName(id: string): string {
  const m = /^(?:claude-)?(fable|opus|sonnet|haiku)(?:-(\d+)(?:-(\d+))?)?/i.exec(id);
  if (!m) return id;
  const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
  return [family, m[2] ? (m[3] ? `${m[2]}.${m[3]}` : m[2]) : ''].filter(Boolean).join(' ');
}
