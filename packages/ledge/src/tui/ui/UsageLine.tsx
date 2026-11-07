import { Box, Text } from 'ink';
import { isUnread, resetShort, shownWindows, span, usageGroups, usageThreshold, useUsage, type UsageGroup } from '@ledge/fleet';
import type { UsageWindow } from '@ledge/protocol';
import { useTui } from '../context.js';
import { C } from '../theme.js';
import { useNow } from './now.js';

type Seg = readonly [string, string, boolean?];

/** A gauge of `n` cells. */
export const bars = (pct: number, n: number, full: string, empty: string): string => {
  const f = Math.round((Math.min(100, pct) / 100) * n);
  return full.repeat(f) + empty.repeat(n - f);
};

/**
 * The harnesses' limits on one line above the keys, on every screen (docs/mockups/ledge-harness-usage.html, « TUI »): per
 * account its mark (✻ Claude Code, >_ Codex), the 5 hours and the week, the models past the threshold; from 120 columns with
 * gauges and the week's reset. Grey under the threshold, yellow past it, red at 100 %; old values grey with their age in
 * yellow. The machine's name when one harness shows two groups, always on Codex (N2). Nothing when no harness gives limits.
 */
export function usageSegments(groups: readonly UsageGroup[], o: { wide: boolean; threshold: number; now: number; lang: string; label(id: string): string; t: ReturnType<typeof useTui>['t']; g: ReturnType<typeof useTui>['g'] }): Seg[] {
  const { t, g } = o;
  const u = t.usage;
  const segs: Seg[] = [];
  const named = (x: UsageGroup) => x.harness === 'codex' || groups.filter(y => y.harness === x.harness).length > 1;
  const col = (pct: number, dim: boolean) => (dim ? C.faint : pct >= 100 ? C.red : pct >= o.threshold * 100 ? C.yellow : C.dim);
  groups.forEach((x, i) => {
    if (i) segs.push(['  │  ', C.line]);
    const cursor = x.harness === 'cursor';
    segs.push([`${x.harness === 'claude' ? g.markClaude : cursor ? g.markCursor : g.markCodex} `, x.harness === 'claude' ? C.coral : cursor ? C.fg : C.violet, cursor]);
    if (named(x)) segs.push([`${x.machines.map(o.label).join(' + ')} `, C.fg]);
    if (x.status === 'loading') { segs.push([u.reading, C.faint]); return; }
    if (x.status === 'expired') { segs.push([o.wide ? u.expired(u.harness[x.harness] ?? x.harness) : u.expiredShort, C.yellow]); return; }
    const dim = x.status === 'stale' || x.status === 'unreachable';
    const one = (k: string, w: UsageWindow, reset: string) => {
      const c = col(w.pct, dim);
      segs.push([`${k} `, C.faint]);
      if (o.wide) segs.push([`${bars(w.pct, 6, g.barFull, g.barEmpty)} `, c]);
      segs.push([`${w.pct}%`, c === C.dim ? C.fg : c]);
      if (reset) segs.push([` ${g.reset}${reset}`, C.faint]);
      segs.push(['  ', '']);
    };
    if (cursor && isUnread(x, o.now)) { segs.push([u.unread, C.faint]); return; }
    const s = shownWindows(x, o.threshold);
    const at = (w: UsageWindow | undefined) => (w?.resetsAt ? resetShort(w.resetsAt, o.now, o.lang) : '');
    if (cursor) {
      // Its total (month, or week on weekly plans) with its reset, then the pools past the threshold.
      const total = s.month ?? s.week;
      if (total) one(s.month ? (o.wide ? u.month : u.monthShort) : (o.wide ? u.week : u.weekShort), total, o.wide ? at(total) : '');
      for (const w of s.hot) one(u.cursorPool[w.pool ?? ''] ?? '', w, '');
    } else {
      if (s.five) one(u.five, s.five, at(s.five));
      if (s.week) one(o.wide ? u.week : u.weekShort, s.week, o.wide ? at(s.week) : '');
      for (const w of s.hot) one(w.model ?? '', w, '');
    }
    if (dim) segs.push([x.status === 'unreachable' ? u.unreachable : x.readAt ? u.ago(span(o.now - Date.parse(x.readAt), o.lang)) : u.never, C.yellow]);
  });
  return segs;
}

/** Every machine's limits as the TUI shows them. */
export function useUsageGroups(): { groups: UsageGroup[]; threshold: number; now: number; label(id: string): string } {
  const { client, machines } = useTui();
  const states = useUsage(client);
  // The ages and resets move by the minute: the second's clock, rounded.
  const now = Math.floor(useNow() / 30_000) * 30_000;
  const byId = new Map(machines.map(m => [m.id, m]));
  return { groups: usageGroups(states, id => byId.get(id)?.status === 'open', now), threshold: usageThreshold(states), now, label: id => byId.get(id)?.label ?? id };
}

export function UsageLine({ columns }: { columns: number }) {
  const { t, g, lang } = useTui();
  const { groups, threshold, now, label } = useUsageGroups();
  if (!groups.length) return null;
  const segs = usageSegments(groups, { wide: columns >= 120, threshold, now, lang, label, t, g });
  return (
    <Box paddingX={1} height={1} overflow="hidden">
      <Text wrap="truncate">{segs.map(([s, c, b], i) => <Text key={i} color={c || undefined} bold={b}>{s}</Text>)}</Text>
    </Box>
  );
}
