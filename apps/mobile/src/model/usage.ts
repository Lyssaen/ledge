import type { PhoneHarnessUsage, PhoneSession, UsageWindow } from '@ledge/protocol';
import { effortLabel } from './modelChoice';

/** A model id as people say it: `claude-opus-5-5` → « Opus 5.5 », `fable` → « Fable »; anything else as it is. */
export function modelName(id: string): string {
  const m = /^(?:claude-)?(fable|opus|sonnet|haiku)(?:-(\d+)(?:-(\d+))?)?/i.exec(id);
  if (!m) return id;
  const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
  return [family, m[2] ? (m[3] ? `${m[2]}.${m[3]}` : m[2]) : ''].filter(Boolean).join(' ');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A span of time: `40 s`, `12 min`, `1 h 12`, `4 j`. */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${pad(m % 60)}`;
  return `${Math.floor(h / 24)} j`;
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const weekday = (d: Date) => d.toLocaleDateString('fr-FR', { weekday: 'short' });

const WEEK_MS = 7 * 24 * 3_600_000;

/** When a window starts again: `14:30` today, `lun. 09:00` another day; `short`: `lun.` alone. A week or more away it is a
 *  date: `1 déc.` (`1 déc. 13:43` unless `short`). */
export function resetLabel(iso: string, now: number, short = false): string {
  const d = new Date(iso);
  if (d.getTime() - now >= WEEK_MS) {
    const date = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    return short ? date : `${date} ${hm(d)}`;
  }
  if (sameDay(d, new Date(now))) return hm(d);
  return short ? weekday(d) : `${weekday(d)} ${hm(d)}`;
}

export const reached = (w: Pick<UsageWindow, 'pct'>): boolean => w.pct >= 100;

/** Neutral under the PC's threshold (`alert`, 0.5–0.95; null: not known yet), amber past it, red at 100 %. */
export function usageTone(pct: number, alert: number | null): '' | 'amber' | 'red' {
  return pct >= 100 ? 'red' : alert !== null && pct >= alert * 100 ? 'amber' : '';
}

/** Values read more than an hour ago are never shown (M9). */
export const USAGE_SHOWN_MS = 60 * 60_000;

/**
 * The limits as they may be shown now: a link that is not fresh cannot say its values are still true, so « ok » reads as old
 * (dimmed, with its age); windows read more than an hour ago (or never) are dropped (M9).
 */
export function shownUsage(usage: readonly PhoneHarnessUsage[], now: number, fresh = true): PhoneHarnessUsage[] {
  return usage.map(h => {
    const old = h.readAt === null || now - Date.parse(h.readAt) > USAGE_SHOWN_MS;
    return { ...h, status: !fresh && h.status === 'ok' ? 'stale' : h.status, windows: old ? [] : h.windows };
  });
}

/** Every harness's windows past the threshold, for « À toi », in the windows' order (5 h, week, models), as the mockup lists
 *  them; never from values over an hour old. */
export function overWindows(usage: readonly PhoneHarnessUsage[], alert: number | null, now: number = Date.now()): { harness: PhoneHarnessUsage['harness']; window: UsageWindow; tone: 'amber' | 'red' }[] {
  return shownUsage(usage, now).flatMap(h => (h.status === 'expired' || h.status === 'loading' ? [] : h.windows.flatMap(window => {
    const tone = usageTone(window.pct, alert);
    return tone ? [{ harness: h.harness, window, tone }] : [];
  })));
}

/**
 * A session's indicators, in the order the mockup draws them (Agents, a session's line): model, effort, context, duration.
 * What is not known is not there. `near`: the context is past « Contexte max ».
 */
export function indicators(s: PhoneSession, now: number, threshold: number): { model?: string; effort?: string; context?: { pct: number; near: boolean }; duration?: string } {
  const started = Date.parse(s.startedAt);
  const share = s.context ? Math.min(1, s.context.used / s.context.window) : undefined;
  return {
    ...(s.model ? { model: modelName(s.model) } : {}),
    ...(s.effort ? { effort: effortLabel(s.effort).toLowerCase() } : {}),
    ...(share !== undefined ? { context: { pct: Math.round(share * 100), near: share >= threshold } } : {}),
    ...(Number.isFinite(started) && s.state !== 'exited' ? { duration: span(now - started) } : {})
  };
}
