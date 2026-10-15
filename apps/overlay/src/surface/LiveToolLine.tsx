import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ThreadItem, ToolItem } from '@ledge/protocol';
import type { Messages } from '../i18n/messages';
import { duration } from '../format';
import { ms } from '../motion';
import { elapsedMs, liveTool, SPINNER, SPINNER_STILL, target, toolItems } from '../thread/tools';

/** The thread’s only trace of the turn’s tool calls (docs/ideas/2026-10-14-tools-display-mockups.md, piste 1).
 *  When the tool ends, its spinner becomes the outcome mark (✓ / ✕), held `holdMs` so it can be read; the line
 *  then fades out in 200 ms, or rolls up in 150 ms when the next tool is already waiting. The hold is information,
 *  not motion: reduced motion keeps it and drops the transitions. */
export const LIVE = { fadeMs: 200, rollMs: 150, holdMs: 500, lineH: 22, spinnerMs: 80 } as const;
const mono = { fontFamily: 'var(--font-mono, ui-monospace, monospace)' } as const;
const scaled = (n: number): number => parseInt(ms(n), 10);
const nextFrame = (cb: () => void): (() => void) => {
  if (typeof requestAnimationFrame === 'function') { const id = requestAnimationFrame(cb); return () => cancelAnimationFrame(id); }
  const id = setTimeout(cb, 16); return () => clearTimeout(id);
};
const MARK: Record<Exclude<ToolItem['status'], 'running'>, { glyph: string; color: string }> = {
  success: { glyph: '✓', color: 'var(--success)' }, failed: { glyph: '✕', color: 'var(--destructive)' }, unknown: { glyph: '·', color: 'var(--muted-foreground)' }
};

/** `enter`: sliding in from below. `live`: the spinner turns. `done`: the mark holds. `exit`: fading or rolling out. */
type Row = { id: string; phase: 'enter' | 'live' | 'done' | 'exit'; exit?: 'fade' | 'up'; since: number };

export interface LiveToolLineProps {
  items: ThreadItem[]; t: Messages; now?: number; paused?: boolean; reducedMotion?: boolean; style?: CSSProperties;
}

/** One line for the running tool: spinner, name, short target, elapsed time. Nothing when no tool runs. */
export function LiveToolLine({ items, t, now, paused, reducedMotion, style }: LiveToolLineProps) {
  const byId = new Map(toolItems(items).map(i => [i.id, i] as const));
  const live = liveTool(items);
  const liveId = live?.id;
  const liveRef = useRef(liveId); liveRef.current = liveId;
  const still = !!reducedMotion || scaled(LIVE.rollMs) === 0;
  const [rows, setRows] = useState<Row[]>(() => (liveId ? [{ id: liveId, phase: still ? 'live' : 'enter', since: Date.now() }] : []));
  const [frame, setFrame] = useState(0);
  const [, setTick] = useState(0);
  const shown = rows.find(r => r.phase !== 'exit');
  const shownStatus = shown ? byId.get(shown.id)?.status : undefined;

  // The shown tool ended: its line holds the mark. Another tool took over while it still runs (parallel calls): the
  // line rolls to it. No tool shown and one runs: a line enters. A held line brings the next tool itself, at hold's end.
  useEffect(() => {
    setRows(prev => {
      const cur = prev.find(r => r.phase !== 'exit');
      if (cur && (cur.phase === 'enter' || cur.phase === 'live') && shownStatus !== undefined && shownStatus !== 'running') {
        return prev.map(r => (r === cur ? { ...r, phase: 'done', since: Date.now() } : r));
      }
      if (cur?.id === liveId || cur?.phase === 'done') return prev;
      const next: Row[] = prev.filter(r => r.phase === 'exit');
      if (cur && !still) next.push({ ...cur, phase: 'exit', exit: liveId ? 'up' : 'fade', since: Date.now() });
      if (liveId) next.push({ id: liveId, phase: still ? 'live' : 'enter', since: Date.now() });
      return next;
    });
  }, [liveId, shownStatus, still]);
  // The hold is over: the line leaves (up when a tool waits behind it, fading otherwise) and the waiting tool enters.
  useEffect(() => {
    const held = rows.filter(r => r.phase === 'done');
    if (!held.length) return;
    const ids = held.map(r => window.setTimeout(() => setRows(p => {
      if (!p.includes(r)) return p;
      const next = liveRef.current;
      const following = next !== undefined && next !== r.id;
      const out = p.filter(x => x !== r);
      if (!still) out.push({ ...r, phase: 'exit', exit: following ? 'up' : 'fade', since: Date.now() });
      if (following && !p.some(x => x.id === next && x.phase !== 'exit')) out.push({ id: next, phase: still ? 'live' : 'enter', since: Date.now() });
      return out;
    }), Math.max(0, LIVE.holdMs - (Date.now() - r.since))));
    return () => ids.forEach(clearTimeout);
  }, [rows, still]);
  // An entering line settles on the next frame; a leaving one is dropped once its motion is over.
  useEffect(() => {
    if (!rows.some(r => r.phase === 'enter')) return;
    return nextFrame(() => setRows(p => p.map(r => (r.phase === 'enter' ? { ...r, phase: 'live' } : r))));
  }, [rows]);
  useEffect(() => {
    const leaving = rows.filter(r => r.phase === 'exit');
    if (!leaving.length) return;
    const ids = leaving.map(r => window.setTimeout(() => setRows(p => p.filter(x => x !== r)), Math.max(0, scaled(r.exit === 'up' ? LIVE.rollMs : LIVE.fadeMs) - (Date.now() - r.since))));
    return () => ids.forEach(clearTimeout);
  }, [rows]);
  // The spinner turns and the elapsed time counts only while a line shows and the view is visible.
  const active = rows.length > 0 && !paused;
  useEffect(() => {
    if (!active || still) return;
    const id = setInterval(() => setFrame(f => (f + 1) % SPINNER.length), LIVE.spinnerMs);
    return () => clearInterval(id);
  }, [active, still]);
  useEffect(() => {
    if (!active || now !== undefined) return;
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [active, now]);

  if (!rows.length) return null;
  const clock = now ?? Date.now();
  const spin = still ? SPINNER_STILL : SPINNER[frame];
  return (
    <div data-item="tools" data-live-tools role="status" aria-label={t.thread.liveLabel} style={{ position: 'relative', height: LIVE.lineH, overflow: 'hidden', margin: '6px 0', ...style }}>
      {rows.map(r => {
        const item: ToolItem | undefined = byId.get(r.id);
        if (!item) return null;
        const mark = item.status === 'running' ? undefined : MARK[item.status];
        const y = r.phase === 'enter' ? LIVE.lineH : r.exit === 'up' ? -LIVE.lineH : 0;
        const dur = r.exit === 'fade' ? LIVE.fadeMs : LIVE.rollMs;
        return (
          <div key={r.id} data-live-tool data-phase={r.phase} data-exit={r.exit}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', alignItems: 'center', gap: 8, height: LIVE.lineH, fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)',
              transform: `translateY(${y}px)`, opacity: r.phase === 'live' || r.phase === 'done' ? 1 : 0,
              transition: still ? 'none' : `transform ${ms(dur)} cubic-bezier(.22,1,.36,1), opacity ${ms(dur)} ease-out` }}>
            {mark
              ? <span aria-hidden data-mark={item.status} style={{ ...mono, width: 14, textAlign: 'center', color: mark.color, fontSize: 13, fontWeight: 700, animation: still ? 'none' : `ledge-mark-in ${ms(160)} cubic-bezier(.34,1.3,.64,1)` }}>{mark.glyph}</span>
              : <span aria-hidden data-spinner style={{ ...mono, width: 14, textAlign: 'center', color: 'var(--info)', fontSize: 13 }}>{spin}</span>}
            <strong style={{ fontWeight: 600, color: 'var(--sidebar-foreground)', whiteSpace: 'nowrap' }}>{item.tool}</strong>
            <span style={{ ...mono, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{target(item)}</span>
            <span data-elapsed style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{duration(elapsedMs(item, clock), t)}</span>
          </div>
        );
      })}
    </div>
  );
}
