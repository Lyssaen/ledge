import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
import type { Session } from '@ledge/protocol';
import { useDaemon } from '../daemon/store';
import type { DaemonClient } from '../daemon/client';
import { botState, poseFor } from '../bots/poseFor';
import { layout, slotSizes, SIZES, SURFACE_BORDER, SURFACE_CHROME_Y, type Layout } from './geometry';
import { createSurfaceController } from './controller';
import type { SurfaceState } from './machine';
import { Handle, type HandleBot } from './Handle';
import { Tooltip } from './Tooltip';
import { Bubble, type BubbleAck } from './Bubble';
import { SettingsView } from './SettingsView';
import { HelpView } from './HelpView';
import { useMeasuredHeight } from './useMeasuredHeight';
import { useDaemonAsks, isPending } from './useDaemonAsks';
import { useFocusRestore } from './useFocusRestore';
import { useMotionPreferences, useOsReducedMotion } from '../motionPreferences';
import { SessionList, rowHint, EXPANDED_ROW_H } from './SessionList';
import { SessionView, measureSessionH } from './SessionView';
import { transition, MOTION, ms } from '../motion';
import { focusTerminal, onShortcut, onEdge, setHotZones, focusOverlay, releaseFocus, isTauri } from '../tauri/bridge';
import { useNativeFrame } from '../tauri/useNativeFrame';
import { frameOf, type Box } from './frame';
import { useKeyboard, isYesNo } from '../keyboard/useKeyboard';
import { Coachmark, countCoachmarkOpen, COACHMARK_H } from '../keyboard/Coachmark';

/** Fallback extents of the extras beside the surface, before (or without) a layout measurement. */
export const TOOLTIP_BOX = { left: 36, w: 324, h: 30 } as const;
export const STATUS_BOX = { w: 190, h: 20 } as const;
/** The native frame waits out the surface's size transition before it shrinks (shrink delay + duration). */
const SETTLE_MS = Math.max(MOTION.grow.ms, MOTION.shrink.delayMs + MOTION.shrink.ms);
const measure = (el: HTMLElement | null) => ({ w: el?.offsetWidth ?? 0, h: el?.offsetHeight ?? 0 });
const inside = (p: { x: number; y: number } | null, g: Layout) => p !== null && p.x >= 0 && p.x < g.w && p.y >= g.top && p.y < g.top + g.h;

const OFFLINE = 'Offline: reconnecting to the daemon';
const READ_ONLY = 'Read only: started without Ledge, answer in its terminal';

export function Surface({ screenH, theme, client, dnd, onToggleDnd, onToggleTheme }: { screenH: number; theme: 'dark' | 'light'; client: DaemonClient; dnd: boolean; onToggleDnd: () => void; onToggleTheme?: () => void }) {
  const { sessions, byId, status, previews, lastError } = useDaemon();
  // One app-level motion preference drives every bot in every layer.
  const motionPrefs = useMotionPreferences();
  const osReduced = useOsReducedMotion();
  const reducedMotion = motionPrefs.reduced;
  const [ctl] = useState(() => createSurfaceController({ onState: s => setSt(s) }));
  const [st, setSt] = useState<SurfaceState>(() => ctl.state());
  const dispatch = ctl.dispatch;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const offsetRef = useRef(0);
  useEffect(() => () => ctl.dispose(), [ctl]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [coach, setCoach] = useState(false);
  const replyAfterOpen = useRef(false);

  // Ctrl+Alt+L (the global shortcut in Tauri, a window key binding in the browser) toggles a keyboard-opened list, from
  // the handle or over a bubble. Opening takes OS focus so single-letter keys reach the overlay; asks and bubbles never do.
  useEffect(() => onShortcut(() => {
    const was = ctl.state().mode;
    dispatch({ type: 'shortcut' });
    if ((was === 'handle' || was === 'bubble') && ctl.state().mode === 'list') void focusOverlay();
  }), [ctl, dispatch]);

  // The native window only covers what it draws, so in Tauri the shell watches the edge bands and reports crossings.
  useEffect(() => onEdge(on => dispatch({ type: on ? 'edgeEnter' : 'edgeLeave' })), [dispatch]);

  // Daemon changes drive the machine. DND keeps the bot growing in the handle but never asks for a bubble.
  // A reply the daemon rejects comes back into its draft (unless something new was typed meanwhile).
  const asks = useDaemonAsks({ sessions, status, lastError, dnd, dispatch, onReplyRejected: (id, text) => setDrafts(x => (x[id] ? x : { ...x, [id]: text })) });

  // DND switched on takes any bubble down and drops queued asks. Turning it off does not re-bubble asks already pending.
  useEffect(() => { if (dnd) dispatch({ type: 'dnd', on: true }); }, [dnd, dispatch]);

  // A hidden document holds the bubble clock.
  useEffect(() => {
    const sync = () => dispatch({ type: 'visibility', hidden: document.hidden });
    if (document.hidden) sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [dispatch]);

  // The last known pointer position, to tell whether the surface shrank out from under it.
  useEffect(() => {
    // In page coordinates: under Tauri the window (and so the viewport) starts at the frame's top.
    const track = (e: PointerEvent | MouseEvent) => { pointer.current = { x: e.clientX, y: e.clientY + offsetRef.current }; };
    document.addEventListener('pointermove', track); document.addEventListener('mousemove', track);
    return () => { document.removeEventListener('pointermove', track); document.removeEventListener('mousemove', track); };
  }, []);

  // Keyboard focus follows the view: a keyboard open lands on the oldest ask (or the first row) and counts toward the
  // coachmark; back from a session lands on that session's row; folding to the handle or the bubble forgets it.
  // A keyboard-opened surface folding back to the handle hands OS focus back to the window that had it.
  const prevView = useRef({ mode: st.mode, selectedId: st.selectedId, openedBy: st.openedBy });
  useEffect(() => {
    const was = prevView.current; prevView.current = { mode: st.mode, selectedId: st.selectedId, openedBy: st.openedBy };
    if (was.mode === st.mode) return;
    if (st.mode === 'handle' && was.mode !== 'bubble' && was.openedBy === 'keyboard') void releaseFocus();
    if (st.mode === 'list' && (was.mode === 'handle' || was.mode === 'bubble') && st.openedBy === 'keyboard') {
      setFocusedId(sessions.find(isPending)?.id ?? sessions[0]?.id ?? null);
      setCoach(countCoachmarkOpen());
    } else if (st.mode === 'list' && was.mode === 'session') setFocusedId(was.selectedId);
    else if (st.mode === 'handle' || st.mode === 'bubble') { setFocusedId(null); setCoach(false); replyAfterOpen.current = false; }
  }, [st.mode, st.selectedId, st.openedBy, sessions]);

  useFocusRestore(surfaceRef, { mode: st.mode, selectedId: st.selectedId });

  const kb = st.openedBy === 'keyboard';
  const focused = kb && focusedId ? byId.get(focusedId) ?? null : null;
  const focusedRowId = focused?.id ?? null;

  // The focused row holds the real DOM focus, so the scroll container keeps it in view and Tab continues from it.
  // Keyed on the id only: a daemon update to that session must not pull focus back from wherever Tab took it.
  useEffect(() => {
    if (st.mode !== 'list' || !focusedRowId) return;
    const row = surfaceRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(focusedRowId)}"] [data-row]`);
    if (row && document.activeElement !== row) row.focus();
  }, [st.mode, focusedRowId]);

  // `r` from the list opens the row first, then puts the cursor in its reply field once the view is live.
  useEffect(() => {
    if (st.mode !== 'session' || !replyAfterOpen.current) return;
    replyAfterOpen.current = false;
    surfaceRef.current?.querySelector<HTMLInputElement>('[data-layer="session"] input[aria-label^="Reply to"]')?.focus();
  }, [st.mode, st.selectedId]);

  const bots: HandleBot[] = useMemo(() => sessions.map(s => ({ id: s.id, name: s.name, tool: s.tool, state: botState(s), pose: poseFor(s.id, s.state), pending: isPending(s), readOnly: s.source === 'hook_only', tip: isPending(s) ? `${botState(s) === 'question' ? 'has a question' : 'needs your approval'} · ${s.pending?.text ?? ''}` : rowHint(s) })), [sessions]);
  const selected = st.selectedId ? byId.get(st.selectedId) ?? null : null;
  // The last open session stays mounted (inert) while the view slides out, so its content fades instead of vanishing
  // and focus left on it is detectably stranded (see useFocusRestore). A removed session unmounts at once.
  const [lastShownId, setLastShownId] = useState<string | null>(null);
  if (st.selectedId && st.selectedId !== lastShownId) setLastShownId(st.selectedId);
  const shownId = st.selectedId ?? lastShownId;
  const shown = shownId ? byId.get(shownId) ?? null : null;
  const bubbleSession = st.bubbleId ? byId.get(st.bubbleId) ?? null : null;
  const bubbleRef = useRef<HTMLDivElement>(null);
  const bubbleH = useMeasuredHeight(bubbleRef, st.mode === 'bubble');
  const geo = layout({ bots: bots.map(b => ({ id: b.id, pending: b.pending })), mode: st.mode, screenH, bubbleId: st.bubbleId, bubbleH: bubbleH ? bubbleH + SURFACE_CHROME_Y : undefined, sessionH: selected ? measureSessionH(selected, st.reading) : 480, reading: st.reading, listExtraH: focused && isYesNo(focused) ? EXPANDED_ROW_H - SIZES.rowH : 0 });

  // Grow when the area grows, shrink otherwise; remembered per area so unrelated re-renders keep the direction.
  const areaNow = geo.w * geo.h;
  const [dir, setDir] = useState({ area: areaNow, growing: true });
  if (dir.area !== areaNow) setDir({ area: areaNow, growing: areaNow > dir.area });
  const growing = dir.area === areaNow ? dir.growing : areaNow > dir.area;


  // The machine's hover and focus facts are sticky: when the surface changes shape (close, shortcut, fold, back)
  // the pointer may no longer be over it without any mouseleave, and focus may sit in a layer that just went inert.
  useEffect(() => {
    const s = ctl.state();
    if (s.hovering && !inside(pointer.current, geo)) dispatch({ type: 'surfaceLeave' });
    if (s.focusWithin) {
      const a = document.activeElement;
      if (!a || !surfaceRef.current?.contains(a) || a.closest('[inert]')) dispatch({ type: 'focusWithin', on: false });
    }
  }, [st.mode, geo.top, geo.w, geo.h, ctl, dispatch]);

  const onBlur = (e: FocusEvent) => { if (!surfaceRef.current?.contains(e.relatedTarget as Node | null)) dispatch({ type: 'focusWithin', on: false }); };
  const onMouseMove = () => { if (!ctl.state().hovering) dispatch({ type: 'surfaceEnter' }); };

  const { big } = slotSizes(bots.length);
  const hovBot = bots.find(b => b.id === hoverId) ?? null;
  const hovSlot = geo.slots.find(s => s.id === hoverId);
  const panel = st.mode !== 'handle' && st.mode !== 'bubble';
  const detail = st.mode === 'session' || st.mode === 'settings' || st.mode === 'help';
  const unreachable = status === 'unreachable';
  const bubblePaused = st.hovering || st.focusWithin || st.hidden || st.ack !== null;
  const send = (m: Parameters<DaemonClient['send']>[0]) => client.send(m);
  // Offline or read-only: every send/decision path (buttons and keys alike) is off, with the reason shown.
  const blockedFor = (s: Session | null | undefined): string | null => unreachable ? OFFLINE : s?.source === 'hook_only' ? READ_ONLY : s ? null : OFFLINE;
  const canDecide = (s: Session) => blockedFor(s) === null && !asks.inFlight.has(s.id);
  /** One decision command per request: false when blocked or already in flight. */
  const decide = (id: string, d: 'accept' | 'deny'): boolean => {
    if (blockedFor(byId.get(id)) !== null || !asks.begin(id)) return false;
    send({ type: 'session.decide', id, decision: d }); return true;
  };
  /** A typed reply. A permission, diff or plan prompt takes Approve/Deny only (the field explains it); answering a
   *  question locks it like a decision. The draft is cleared on send and comes back if the daemon rejects it. */
  const reply = (id: string, text: string) => {
    const s = byId.get(id);
    if (!s || blockedFor(s) !== null || (s.pending && s.pending.kind !== 'question')) return;
    if (s.pending && !asks.begin(id)) return;
    asks.replied(id, text);
    send({ type: 'session.reply', id, text }); setDrafts(x => ({ ...x, [id]: '' })); dispatch({ type: 'typing', on: false });
  };
  const bubbleAck: BubbleAck = st.ack ? (st.ack.confirmed ? 'confirmed' : 'pending') : st.failed && st.failed === st.bubbleId ? 'failed' : null;
  // The coachmark sits 8 px under the focused row; when that would leave the frame it flips above the row, and when
  // neither fits (a short list) it stays below and the native frame reported to the shell extends to hold it.
  const coachShown = coach && kb && st.mode === 'list';
  const focusIndex = focused ? sessions.findIndex(s => s.id === focused.id) : -1;
  const rowTop = geo.top + SIZES.headerH + 8 + Math.max(0, focusIndex) * SIZES.rowH;
  const rowBottom = focusIndex < 0 ? geo.top + SIZES.headerH : rowTop + (focused && isYesNo(focused) ? EXPANDED_ROW_H : SIZES.rowH);
  const below = rowBottom + 8; const above = rowTop - 8 - COACHMARK_H;
  const coachTop = below + COACHMARK_H <= geo.top + geo.h || above < geo.top ? below : above;
  // The native window is the bounding frame of what is visible: the surface plus the tooltip, the status line and the
  // coachmark when shown. Text extras are measured after layout (fixed fallbacks where layout gives nothing).
  const tipRef = useRef<HTMLDivElement>(null); const statusRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState({ tip: { w: 0, h: 0 }, status: { w: 0, h: 0 } });
  useLayoutEffect(() => {
    const tip = measure(tipRef.current), status = measure(statusRef.current);
    setSizes(s => s.tip.w === tip.w && s.tip.h === tip.h && s.status.w === status.w && s.status.h === status.h ? s : { tip, status });
  });
  const tipShown = st.mode === 'handle' && hovBot !== null;
  const extras: Box[] = [];
  if (tipShown) { const h = sizes.tip.h || TOOLTIP_BOX.h; extras.push({ left: TOOLTIP_BOX.left, top: (hovSlot?.center ?? geo.top) - h / 2, w: sizes.tip.w || TOOLTIP_BOX.w, h }); }
  if (unreachable) extras.push({ left: Math.max(geo.w, SIZES.handleW) + 8, top: geo.top, w: sizes.status.w || STATUS_BOX.w, h: sizes.status.h || STATUS_BOX.h });
  if (coachShown) extras.push({ left: 44, top: coachTop, w: 300, h: COACHMARK_H });
  const frame = frameOf(geo, extras, screenH);
  const offset = useNativeFrame(frame, parseFloat(ms(SETTLE_MS)));
  offsetRef.current = offset;
  // Armed only while the bare handle shows and the daemon is reachable, exactly like the DOM zones' pointer-events.
  const zonesArmed = st.mode === 'handle' && !unreachable;
  const zonesKey = zonesArmed ? geo.hotZones.map(z => `${z.top}:${z.h}`).join(',') : '';
  useEffect(() => { setHotZones(zonesArmed ? geo.hotZones : []); }, [zonesKey]); // the bands are captured through `zonesKey`
  // The terminal tab is the fallback for read-only and offline sessions too: only the daemon message needs the daemon.
  const focusTab = (id: string) => { const s = byId.get(id); if (!s) return; if (!unreachable) send({ type: 'session.focus', id }); void focusTerminal(s.title); };
  const chooseOption = (n: number) => {
    if (blockedFor(selected) !== null) return;
    const radios = surfaceRef.current?.querySelectorAll<HTMLInputElement>('[data-layer="session"] [data-ask] input[type="radio"]:not([aria-label="Other"])');
    const r = radios?.[n - 1]; if (!r) return;
    r.click(); r.focus();
  };
  const openRow = (id: string) => dispatch({ type: 'rowClick', id });
  useKeyboard({
    enabled: panel, mode: st.mode, sessions, focusedId: st.mode === 'session' ? st.selectedId : st.mode === 'list' ? focused?.id ?? null : null,
    onFocus: setFocusedId, onOpen: openRow, onDecide: decide,
    onNextAsk: () => {
      const pend = sessions.filter(isPending).map(s => s.id);
      const from = st.mode === 'session' ? st.selectedId : focused?.id ?? null;
      const ids = sessions.map(s => s.id); const at = from ? ids.indexOf(from) : -1;
      const next = [...ids.slice(at + 1), ...ids.slice(0, at + 1)].find(id => pend.includes(id));
      if (!next || next === from) return;
      if (st.mode === 'session') openRow(next); else setFocusedId(next);
    },
    onClose: () => dispatch({ type: detail ? 'back' : 'close' }),
    onReplyFocus: () => {
      if (st.mode !== 'session' && st.mode !== 'list') return;
      if (st.mode === 'session') { surfaceRef.current?.querySelector<HTMLInputElement>('[data-layer="session"] input[aria-label^="Reply to"]')?.focus(); return; }
      if (focused) { replyAfterOpen.current = true; openRow(focused.id); }
    },
    onToggleDnd, onHelp: () => dispatch({ type: st.mode === 'help' ? 'back' : 'help' }), onTerminal: focusTab, onChooseOption: chooseOption
  });
  const motion = growing ? MOTION.grow : MOTION.shrink;
  const delay = growing ? 0 : MOTION.shrink.delayMs;

  const tauri = isTauri();
  const content = (
    <>
      {!tauri && geo.hotZones.map((z, i) => <div key={i} data-hotzone onMouseEnter={() => dispatch({ type: 'edgeEnter' })} onMouseLeave={() => dispatch({ type: 'edgeLeave' })} style={{ position: 'absolute', left: 0, top: z.top, width: 14, height: z.h, pointerEvents: st.mode === 'handle' && !unreachable ? 'auto' : 'none', background: st.hot ? 'var(--edge-hot)' : 'transparent', transition: transition([['background-color', 'hover']]) }} />)}

      <div ref={surfaceRef} data-surface data-mode={st.mode}
        onMouseEnter={() => dispatch({ type: 'surfaceEnter' })} onMouseLeave={() => dispatch({ type: 'surfaceLeave' })} onMouseMove={onMouseMove}
        onFocus={e => {
          if (!ctl.state().focusWithin) dispatch({ type: 'focusWithin', on: true });
          // Native Tab onto another row moves the keyboard focus with it.
          const row = (e.target as HTMLElement).closest?.('[data-row]') ? (e.target as HTMLElement).closest<HTMLElement>('[data-row-id]')?.dataset.rowId : undefined;
          if (row && kb && ctl.state().mode === 'list') setFocusedId(row);
        }} onBlur={onBlur}
        style={{ position: 'absolute', left: 0, top: geo.top, width: geo.w, height: geo.h, boxSizing: 'border-box', overflow: 'hidden', background: 'var(--sidebar)', color: 'var(--sidebar-foreground)', border: `${SURFACE_BORDER}px solid var(--sidebar-border)`, borderLeft: 'none', borderRadius: '0 var(--radius-xl) var(--radius-xl) 0', boxShadow: 'var(--shadow-overlay)', opacity: unreachable ? 0.6 : 1, willChange: 'top, width, height',
          transition: ['top', 'width', 'height'].map(p => `${p} ${ms(motion.ms)} ${motion.ease} ${ms(delay)}`).join(', ') + `, opacity ${ms(150)} ease-out` }}>
        <Handle bots={bots} slots={geo.slots} big={big} visible={st.mode === 'handle'} hoverId={hoverId} onHover={setHoverId} onOpen={id => dispatch({ type: 'botClick', id })} theme={theme} frozen={unreachable} reducedMotion={reducedMotion} />
        <Bubble ref={bubbleRef} session={bubbleSession} moreCount={Math.max(0, st.queue.length - 1)} visible={st.mode === 'bubble'} paused={bubblePaused} remainingMs={ctl.bubbleRemaining() ?? undefined}
          ack={bubbleAck} deciding={!!st.bubbleId && asks.inFlight.has(st.bubbleId)} failure={st.bubbleId ? asks.failures[st.bubbleId] : undefined} blocked={bubbleSession ? blockedFor(bubbleSession) : null} frozen={unreachable} reducedMotion={reducedMotion}
          onOpen={() => dispatch({ type: 'bubbleClick' })} onDismiss={() => dispatch({ type: 'close' })}
          onDecide={d => { if (st.bubbleId && !ctl.state().ack && decide(st.bubbleId, d)) dispatch({ type: 'decidedInBubble' }); }}
          onReply={t => {
            const id = st.bubbleId; if (!id || ctl.state().ack || blockedFor(byId.get(id)) !== null || !asks.begin(id)) return;
            send({ type: 'session.reply', id, text: t }); dispatch({ type: 'decidedInBubble' });
          }} theme={theme} />
        <div data-panel style={{ position: 'absolute', inset: 0, opacity: panel ? 1 : 0, pointerEvents: panel ? 'auto' : 'none', transition: transition([['opacity', panel ? 'fadeIn' : 'fadeOut', panel ? 120 : 0]]) }}>
          <div aria-hidden={st.mode !== 'list' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'list' ? 'auto' : 'none', transform: `translateX(${detail ? -12 : 0}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            <SessionList sessions={sessions} visible={st.mode === 'list'} numbered={kb} selectedId={st.selectedId} focusedId={st.mode === 'list' ? focused?.id ?? null : null} dnd={dnd} onToggleDnd={onToggleDnd} onOpen={openRow} onDecide={decide} canDecide={canDecide}
              onClose={() => dispatch({ type: 'close' })} onSettings={() => dispatch({ type: 'settings' })} onHelp={() => dispatch({ type: 'help' })} theme={theme} frozen={unreachable} reducedMotion={reducedMotion} />
          </div>
          <div aria-hidden={st.mode !== 'settings' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'settings' ? 'auto' : 'none', transform: `translateX(${st.mode === 'settings' ? 0 : 12}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            <SettingsView visible={st.mode === 'settings'} theme={theme} dnd={dnd} reduced={motionPrefs.app} osReduced={osReduced}
              onToggleTheme={onToggleTheme} onToggleDnd={onToggleDnd} onReduced={motionPrefs.setReduced} onBack={() => dispatch({ type: 'back' })} onClose={() => dispatch({ type: 'close' })} />
          </div>
          <div aria-hidden={st.mode !== 'help' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'help' ? 'auto' : 'none', transform: `translateX(${st.mode === 'help' ? 0 : 12}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            <HelpView visible={st.mode === 'help'} onBack={() => dispatch({ type: 'back' })} onClose={() => dispatch({ type: 'close' })} />
          </div>
          <div aria-hidden={st.mode !== 'session' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'session' ? 'auto' : 'none', transform: `translateX(${st.mode === 'session' ? 0 : 12}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            {shown && <SessionView session={shown} preview={previews.get(shown.id) ?? []} visible={st.mode === 'session'} reading={st.reading} draft={drafts[shown.id] ?? ''}
              blocked={blockedFor(shown)} deciding={asks.inFlight.has(shown.id)} failure={asks.failures[shown.id]} frozen={unreachable} reducedMotion={reducedMotion}
              onDraft={t => { setDrafts(x => ({ ...x, [shown.id]: t })); dispatch({ type: 'typing', on: t.length > 0 }); }}
              onBack={() => dispatch({ type: 'back' })} onClose={() => dispatch({ type: 'close' })} onDecide={d => decide(shown.id, d)} onReply={t => reply(shown.id, t)}
              onInterrupt={() => send({ type: 'session.interrupt', id: shown.id })} onKill={() => send({ type: 'session.kill', id: shown.id })}
              onFocus={() => focusTab(shown.id)} onToggleReading={() => dispatch({ type: 'reading', on: !st.reading })} theme={theme} />}
          </div>
        </div>
      </div>

      <Coachmark visible={coachShown} top={coachTop} onDismiss={() => { setCoach(false); if (focusedRowId) surfaceRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(focusedRowId)}"] [data-row]`)?.focus(); }} />
      <Tooltip ref={tipRef} bot={st.mode === 'handle' ? hovBot : null} y={hovSlot?.center ?? geo.top} />
      {unreachable && <div ref={statusRef} role="status" style={{ position: 'absolute', left: Math.max(geo.w, SIZES.handleW) + 8, top: geo.top, fontSize: 12, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>daemon unreachable, retrying</div>}
    </>
  );
  // Under Tauri the page is shifted so page y = screen y - frame top; the browser renders at page coordinates as is.
  return tauri ? <div data-frame-content style={{ position: 'absolute', left: 0, top: -offset, width: '100%' }}>{content}</div> : content;
}
