import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
import type { Session, Tool } from '@ledge/protocol';
import { loadDefaultTool, saveDefaultTool } from '../defaultTool';
import { useDaemon, daemonStore } from '../daemon/store';
import type { DaemonClient } from '../daemon/client';
import { botState, poseFor } from '../bots/poseFor';
import type { ResidentGesture } from '../bots/ResidentMascot';
import { displayOrder, groupSessions, headersBefore } from './groups';
import { ISLAND, LEDGE_ID, scaledLayout, SIZES, SURFACE_CHROME_Y, type IslandPosition, type Layout } from './geometry';
import { createSurfaceController } from './controller';
import type { SurfaceState } from './machine';
import { Handle, type HandleBot } from './Handle';
import { UnreadSay, UNREAD_SAY_BOX, SAY_TAIL_X } from './UnreadSay';
import { pickSay, pickSpeaker, sayKindOf, type SayCandidate } from './say';
import { Bubble, type BubbleAck } from './Bubble';
import { SettingsView } from './SettingsView';
import { HelpView } from './HelpView';
import { LaunchView, LAUNCH_FOOTER_H, type LaunchRequest } from './LaunchView';
import { ChatView, CHAT_HEADER_H } from './ChatView';
import { DETAIL_HEADER_H } from './DetailHeader';
import { useMeasuredHeight } from './useMeasuredHeight';
import { useDaemonAsks, isPending } from './useDaemonAsks';
import { useFocusRestore } from './useFocusRestore';
import { useSoundPrefs } from '../sounds/preferences';
import { useSounds } from '../sounds/useSounds';
import { createSilentPlayer, type SoundPlayer } from '../sounds/player';
import { useMotionPreferences, useOsReducedMotion } from '../motionPreferences';
import { SessionList, EXPANDED_ROW_H, ASK_H, NOTICE_GAP, type ListNotice } from './SessionList';
import { SessionView, measureSessionH, SESSION_HEADER_H } from './SessionView';
import { useI18n, type Lang } from '../i18n/lang';
import { transition, MOTION, ms, enterDelay } from '../motion';
import { focusTerminal, openTerminal, onShortcut, onNewSessionShortcut, onOutsideClick, setOutsideWatch, onCursorProximity, onTrayAction, focusOverlay, releaseFocus, isTauri, onForegroundCovered, setHotZone, openUrl } from '../tauri/bridge';
import { useNativeFrame } from '../tauri/useNativeFrame';
import { useDelayed } from './useDelayed';
import { UpdateCard } from '../update/UpdateCard';
import { targetOf } from '../update/machine';
import type { UpdateController } from '../update/useUpdate';
import { frameOf, type Box } from './frame';
import { Shoulders, shoulderR } from './Shoulders';
import { useKeyboard, isYesNo } from '../keyboard/useKeyboard';
import { useDocumentReader } from '../documents/useDocumentReader';
import type { DocumentReference } from '../documents/references';
import { DocumentView, type DocumentViewState } from './DocumentView';
import type { ScaleTarget, UiScale } from '../scale';
import type { MonitorInfo } from '../monitor';
import { Coachmark, countCoachmarkOpen, COACHMARK_H } from '../keyboard/Coachmark';

/** Fallback extents of the extras beside the surface, before (or without) a layout measurement. */
export const STATUS_BOX = { w: 190, h: 20 } as const;
/** The native frame waits out the surface's size transition before it shrinks (shrink delay + duration). */
const SETTLE_MS = Math.max(MOTION.grow.ms, MOTION.shrink.delayMs + MOTION.shrink.ms);
/** A drawn box in real px (its zoom included); 0 where layout gives nothing (jsdom). */
const measure = (el: HTMLElement | null) => { const r = el?.getBoundingClientRect(); return { w: r?.width ?? 0, h: r?.height ?? 0 }; };
/** The hot band along the top edge: 10 px deep, 40 px past the island either side (spec 2026-10-12 §4). */
export const HOT_BAND_H = 10;
export const HOT_BAND_OVERHANG = 40;
/** The discreet strip comes back this long after the island folds. */
const STRIP_BACK_MS = 500;
const inside = (p: { x: number; y: number } | null, g: Layout) => p !== null && p.x >= g.left && p.x < g.left + g.w && p.y >= 0 && p.y < g.h;
const inBand = (p: { x: number; y: number } | null, g: Layout) => p !== null && p.y >= 0 && p.y <= HOT_BAND_H && p.x >= g.handle.left - HOT_BAND_OVERHANG && p.x < g.handle.left + g.handle.w + HOT_BAND_OVERHANG && !inside(p, g);
/** One shared empty preview, so a session without one keeps a stable value across renders. */
const NO_LINES: string[] = [];
/** How long the "X is starting in Y" line stays under the list header. */
export const LAUNCH_NOTICE_MS = 6000;


export interface SurfaceProps {
  /** The work-area height in logical px (the page itself is never zoomed). */
  screenH: number; theme: 'dark' | 'light'; client: DaemonClient; dnd: boolean; onToggleDnd: () => void; onToggleTheme?: () => void;
  /** The work-area width in logical px: the island is centred on its axis within it. */
  screenW?: number;
  /** The island's axis and the discreet strip (Settings, spec 2026-10-12 §5). */
  islandPosition?: IslandPosition; onIslandPosition?: (p: IslandPosition) => void; discreet?: boolean; onDiscreet?: (on: boolean) => void;
  /** The applied scales: the handle's (its layer and slots) and the opened views' (bubble, list, session,
   *  settings, help, coachmark). Each is a CSS `zoom` on its own layer, with the geometry multiplied to match. */
  handleScale?: number; panelScale?: number;
  /** The two size settings, the values Auto resolves to, and how to change them (Settings). */
  scales?: Record<ScaleTarget, UiScale>; autoScales?: Record<ScaleTarget, number>; onScale?: (target: ScaleTarget, s: UiScale) => void;
  /** The Language setting (Settings). */
  onLang?: (l: Lang) => void;
  /** The Screen setting: the monitors to choose from, the choice (null: the primary) and how to change it (live).
   *  `onSettingsOpen` fires when the Settings view opens, so the monitors can be listed again. */
  monitors?: MonitorInfo[]; monitor?: string | null; onMonitor?: (id: string | null) => void; onSettingsOpen?: () => void;
  /** Launch at login (null or absent: not offered) and how to change it. */
  autostart?: boolean | null; onAutostart?: (on: boolean) => void;
  /** The brand colour (null: factory coral) and how to change it (live). */
  accent?: string | null; onAccent?: (hex: string | null) => void;
  /** Plays the sound cues (one Web Audio player per app); a silent player when absent. */
  soundPlayer?: SoundPlayer;
  /** The auto-update (App owns it): the card in the list, the pip on the island and on the gear. */
  update?: UpdateController;
}

/** A text field or editable content: focus there means someone is filling it in. Radios, buttons and rows are not. */
const isEditable = (el: Element | null) => !!el && ((el.tagName === 'INPUT' && !['radio', 'checkbox', 'button', 'submit'].includes((el as HTMLInputElement).type)) || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);

export function Surface({ screenH, screenW = window.innerWidth, theme, client, dnd, onToggleDnd, onToggleTheme, handleScale = 1, panelScale = 1, scales, autoScales, onScale, onLang, monitors, monitor = null, onMonitor, onSettingsOpen, autostart = null, onAutostart, accent = null, onAccent, soundPlayer, islandPosition = 'center', onIslandPosition, discreet = true, onDiscreet, update }: SurfaceProps) {
  // Geometry, pointer and frames are in real px; the handle layer is zoomed by `hs`, the opened views by `ps`. A
  // measured view (bubble, session, settings, help) reports its base height: its client rect divided by `ps`.
  const hs = handleScale, ps = panelScale;
  const { sessions: daemonSessions, byId, status, previews, lastError, recents, launcher, lastLaunched, lastListing, chat, chatLive } = useDaemon();
  // Everything indexed (digits, J/K, the handle, the coachmark row) follows the order the list displays: grouped by repository.
  const sessions = useMemo(() => displayOrder(daemonSessions), [daemonSessions]);
  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const { t } = useI18n();
  // One app-level motion preference drives every bot in every layer.
  const motionPrefs = useMotionPreferences();
  const osReduced = useOsReducedMotion();
  const reducedMotion = motionPrefs.reduced;
  const prefs = useSoundPrefs();
  const finishedBubble = prefs.finished === 'both' || prefs.finished === 'bubble';
  const [defaultTool, setDefaultTool] = useState(loadDefaultTool);
  const chooseDefaultTool = (tool: Tool) => { setDefaultTool(tool); saveDefaultTool(tool); };
  // Work time of the last finish per session, so the finished bubble can say "2m 40s of work".
  const [elapsed, setElapsed] = useState<Record<string, number>>({});
  const [ledgePreview, setLedgePreview] = useState<string | undefined>();
  const [ledgeUnread, setLedgeUnread] = useState(false);
  const [ledgeSaySeed, setLedgeSaySeed] = useState('ledge');
  const [finishedUnread, setFinishedUnread] = useState<Record<string, string>>({});
  const [ctl] = useState(() => createSurfaceController({ onState: s => setSt(s) }));
  const [st, setSt] = useState<SurfaceState>(() => ctl.state());
  const documentSourceFocus = useRef<HTMLElement | null>(null);
  const dispatch = ctl.dispatch;
  const reader = useDocumentReader({ client, onExit: () => dispatch({ type: 'back' }) });
  useEffect(() => {
    if (st.mode !== 'reader' && reader.state.current) reader.close();
    if (st.mode === 'handle' || st.mode === 'bubble') documentSourceFocus.current = null;
  }, [st.mode, reader.state.current, reader.close]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [residentPointer, setResidentPointer] = useState<{ x: number; y: number } | null>(null);
  /** The pointer while it is in the top band beside the island (null elsewhere); it arms the dwell like the island does. */
  const [bandPointer, setBandPointer] = useState<{ x: number; y: number } | null>(null);
  /** A maximised window in the foreground covers the island's spot (the shell says so). */
  const [covered, setCovered] = useState(false);
  const offsetRef = useRef({ left: 0, top: 0 });
  const geoRef = useRef<Layout>(null!);
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

  // Ctrl+Alt+N opens the new-session form from anywhere, with focus so its field takes keys at once; again folds it.
  useEffect(() => onNewSessionShortcut(() => {
    const was = ctl.state().mode;
    dispatch({ type: 'newSession' });
    if (ctl.state().mode === 'launch' && (was === 'handle' || was === 'bubble')) void focusOverlay();
  }), [ctl, dispatch]);

  // A press outside an open panel folds it back to the handle. The overlay window never takes focus on a mouse open,
  // so under Tauri the shell watches the mouse buttons; in the browser the document's own presses tell.
  // Focus stays with whatever was clicked: no hand-back over it.
  const foldedOutside = useRef(false);
  const outsideClick = () => {
    const m = ctl.state().mode; if (m === 'handle' || m === 'bubble') return;
    foldedOutside.current = true;
    dispatch({ type: 'outsideClick' });
  };
  const outsideRef = useRef(outsideClick); outsideRef.current = outsideClick;
  useEffect(() => onOutsideClick(() => outsideRef.current()), []);
  useEffect(() => {
    if (isTauri()) return;
    const press = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && (surfaceRef.current?.contains(t) || t.closest?.('[data-zoom]'))) return;
      outsideRef.current();
    };
    document.addEventListener('pointerdown', press);
    return () => document.removeEventListener('pointerdown', press);
  }, []);
  // The native poller covers the screen beyond the webview: the gaze and the top band both read it.
  useEffect(() => onCursorProximity(point => {
    if (point) pointer.current = point;
    setBandPointer(inBand(point, geoRef.current) ? point : null);
    setResidentPointer(ctl.state().mode === 'handle' ? point : null);
  }), [ctl]);
  useEffect(() => onForegroundCovered(setCovered), []);
  useEffect(() => onTrayAction(action => {
    if (action === 'dnd') { onToggleDnd(); return; }
    dispatch({ type: 'close' });
    dispatch({ type: 'shortcut' });
    if (action === 'new') dispatch({ type: 'launch' });
    void focusOverlay();
  }), [dispatch, onToggleDnd]);

  // Daemon changes drive the machine. DND keeps the bot growing in the handle but never asks for a bubble.
  // A reply the daemon rejects comes back into its draft (unless something new was typed meanwhile).
  const player = useMemo(() => soundPlayer ?? createSilentPlayer(), [soundPlayer]);
  const sounds = useSounds({ player, dnd, status });
  const asks = useDaemonAsks({ sessions, status, lastError, dnd, dispatch, finishedBubble, onChange: (c, info) => {
    sounds.onChange(c);
    if (c.kind === 'finished' && info.elapsedMs !== undefined) setElapsed(x => ({ ...x, [c.id]: info.elapsedMs! }));
    if (c.kind === 'finished') {
      const looking = ctl.state().mode === 'session' && ctl.state().selectedId === c.id;
      if (!looking) setFinishedUnread(x => ({ ...x, [c.id]: `${c.id}:finished:${info.elapsedMs ?? 0}` }));
    }
    if (c.kind === 'asked' || c.kind === 'left' || c.kind === 'failed') setFinishedUnread(x => { if (!(c.id in x)) return x; const { [c.id]: _gone, ...rest } = x; return rest; });
  }, onReplyRejected: (id, text) => setDrafts(x => (x[id] ? x : { ...x, [id]: text })) });

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
    const track = (e: PointerEvent | MouseEvent) => {
      pointer.current = { x: e.clientX + offsetRef.current.left, y: e.clientY + offsetRef.current.top };
      setBandPointer(inBand(pointer.current, geoRef.current) ? pointer.current : null);
      // The native poller covers the screen beyond the webview; browser previews use document events for the gaze too.
      if (!isTauri()) setResidentPointer(pointer.current);
    };
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
    const outside = foldedOutside.current; foldedOutside.current = false;
    if (st.mode === 'handle' && was.mode !== 'bubble' && was.openedBy === 'keyboard' && !outside) void releaseFocus();
    if (st.mode === 'list' && (was.mode === 'handle' || was.mode === 'bubble') && st.openedBy === 'keyboard') {
      setFocusedId(sessions.find(isPending)?.id ?? sessions[0]?.id ?? null);
      setCoach(countCoachmarkOpen());
    } else if (st.mode === 'list' && was.mode === 'session') setFocusedId(was.selectedId);
    else if (st.mode === 'handle' || st.mode === 'bubble') { setFocusedId(null); setCoach(false); replyAfterOpen.current = false; }
  }, [st.mode, st.selectedId, st.openedBy, sessions]);

  useFocusRestore(surfaceRef, { mode: st.mode, selectedId: st.selectedId });
  useEffect(() => {
    if ((st.mode !== 'session' && st.mode !== 'chat' && st.mode !== 'list') || !documentSourceFocus.current) return;
    const source = documentSourceFocus.current;
    documentSourceFocus.current = null;
    if (source.isConnected && !source.closest('[inert]')) source.focus({ preventScroll: true });
    else surfaceRef.current?.querySelector<HTMLElement>(`[data-layer="${st.mode}"] [data-initial-focus]`)?.focus({ preventScroll: true });
  }, [st.mode]);

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
    surfaceRef.current?.querySelector<HTMLTextAreaElement>('[data-layer="session"] [data-reply]')?.focus();
  }, [st.mode, st.selectedId]);

  // The finishing bot is big from the moment its notice is due until the bubble folds.
  const liftedId = st.queue.length === 0 && st.done.length > 0 && (st.unfoldDue || (st.mode === 'bubble' && st.bubbleKind === 'finished')) ? st.done[0] : null;
  const bots: HandleBot[] = useMemo(() => sessions.map(s => ({ id: s.id, name: s.name, tool: s.tool, state: botState(s), pose: poseFor(s.id, s.state), pending: isPending(s), lifted: s.id === liftedId, held: !!finishedUnread[s.id], readOnly: s.source === 'hook_only' })), [sessions, liftedId, finishedUnread]);
  const previousResident = useRef({ ids: new Set(sessions.map(s => s.id)), pending: new Set(sessions.filter(isPending).map(s => s.id)) });
  const signalCounter = useRef(0);
  const [residentSignal, setResidentSignal] = useState<{ key: number; kind: ResidentGesture }>();
  useEffect(() => {
    const before = previousResident.current;
    const ids = new Set(sessions.map(s => s.id));
    const pending = new Set(sessions.filter(isPending).map(s => s.id));
    if ([...ids].some(id => !before.ids.has(id))) setResidentSignal({ key: ++signalCounter.current, kind: 'hello' });
    else if ([...pending].some(id => !before.pending.has(id))) setResidentSignal({ key: ++signalCounter.current, kind: 'pulse' });
    previousResident.current = { ids, pending };
  }, [sessions]);
  // A turn Ledge just answered, while we were watching it (history on connect is ignored): same finished cue as a bot.
  const prevChat = useRef(chat);
  useEffect(() => {
    const before = prevChat.current;
    prevChat.current = chat;
    for (const turn of chat) {
      const was = before.find(t => t.qid === turn.qid);
      if (!was || was.answeredAt || was.error || !turn.answeredAt || turn.error) continue;
      const elapsedMs = Date.parse(turn.answeredAt) - Date.parse(turn.askedAt);
      if (Number.isFinite(elapsedMs) && elapsedMs >= 0) setElapsed(x => ({ ...x, [LEDGE_ID]: elapsedMs }));
      setLedgePreview(turn.answer?.trim() || undefined);
      sounds.onChange({ kind: 'finished', id: LEDGE_ID });
      if (finishedBubble && !dnd) dispatch({ type: 'finished', id: LEDGE_ID });
      if (ctl.state().mode !== 'chat') { setLedgeUnread(true); setLedgeSaySeed(turn.qid); }
      setResidentSignal({ key: ++signalCounter.current, kind: 'happy' });
    }
  }, [chat]); // eslint-disable-line react-hooks/exhaustive-deps -- finishedBubble/dnd/sounds read the live values of this render
  useEffect(() => { if (st.mode === 'chat') setLedgeUnread(false); }, [st.mode]);
  useEffect(() => {
    if (st.mode !== 'session' || !st.selectedId) return;
    setFinishedUnread(x => { if (!(st.selectedId! in x)) return x; const { [st.selectedId!]: _gone, ...rest } = x; return rest; });
  }, [st.mode, st.selectedId]);
  useEffect(() => {
    setFinishedUnread(x => {
      let next = x;
      for (const id of Object.keys(x)) {
        const s = byId.get(id);
        if (s && s.state === 'idle') continue;
        if (next === x) next = { ...x };
        delete next[id];
      }
      return next;
    });
  }, [sessions, byId]);
  const selected = st.selectedId ? byId.get(st.selectedId) ?? null : null;
  // The last open session stays mounted (inert) while the view slides out, so its content fades instead of vanishing
  // and focus left on it is detectably stranded (see useFocusRestore). A session removed by the daemon leaves the same
  // way, drawn from its last known state and preview, so the panel never flashes empty while the list fades in.
  const [lastShown, setLastShown] = useState<{ session: Session; preview: string[] } | null>(null);
  const shownId = st.selectedId ?? lastShown?.session.id ?? null;
  const live = shownId ? byId.get(shownId) ?? null : null;
  const livePreview = live ? previews.get(live.id) ?? NO_LINES : NO_LINES;
  if (live && (live !== lastShown?.session || livePreview !== lastShown.preview)) setLastShown({ session: live, preview: livePreview });
  const shown = live ?? (lastShown?.session.id === shownId ? lastShown.session : null);
  const shownPreview = live ? livePreview : lastShown?.preview ?? NO_LINES;
  const bubbleSession = st.bubbleId ? byId.get(st.bubbleId) ?? null : null;
  const bubbleRef = useRef<HTMLDivElement>(null);
  const bubbleH = useMeasuredHeight(bubbleRef, st.mode === 'bubble', ps);
  // The open session sizes itself to its content (header + scroll content + reply area), up to the screen.
  const sessionContentRef = useRef<HTMLDivElement>(null); const sessionReplyRef = useRef<HTMLDivElement>(null);
  const contentH = useMeasuredHeight(sessionContentRef, st.mode === 'session', ps);
  const replyH = useMeasuredHeight(sessionReplyRef, st.mode === 'session', ps);
  const sessionH = !selected ? 480 : contentH ? SESSION_HEADER_H + contentH + (selected.source === 'hook_only' ? 0 : replyH) + SURFACE_CHROME_Y : measureSessionH(selected, st.reading);
  // Settings and help size themselves to their content too (their header is the 56 px DetailHeader).
  const settingsRef = useRef<HTMLDivElement>(null); const helpRef = useRef<HTMLDivElement>(null);
  const settingsH = useMeasuredHeight(settingsRef, st.mode === 'settings', ps);
  // Settings opening: the monitors are listed again, so a screen plugged in since the start can be chosen.
  const settingsOpen = st.mode === 'settings';
  useEffect(() => { if (settingsOpen) onSettingsOpen?.(); }, [settingsOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const helpH = useMeasuredHeight(helpRef, st.mode === 'help', ps);
  // Starting a session from the form: one request at a time; the daemon answers `session.launched` (back to the list,
  // a notice for a few seconds, the terminal tab when asked) or an `error` without id (shown in the form). The form is
  // remounted on each open, so a submitted form never shows its old values again.
  const [launchOpen, setLaunchOpen] = useState(0);
  const launchMode = st.mode === 'launch';
  useEffect(() => { if (launchMode) setLaunchOpen(n => n + 1); }, [launchMode]);
  // Measured on the remounted form (`launchOpen`), not on the one it replaced: a form opened from the handle is first
  // laid out at the island's width, and only the live element reports the height at the settled width.
  const launchRef = useRef<HTMLDivElement>(null);
  const launchH = useMeasuredHeight(launchRef, launchMode, ps, launchOpen);
  // The launch form's footer (the actions) sits under the measured, scrolling body.
  const detailBody = st.mode === 'settings' ? settingsH : st.mode === 'help' ? helpH : launchMode && launchH ? launchH + LAUNCH_FOOTER_H : 0;
  // The chat sizes itself to its thread: header + measured content + the composer (+ the suggestion chips while empty).
  const chatRef = useRef<HTMLDivElement>(null);
  const chatH = useMeasuredHeight(chatRef, st.mode === 'chat', ps);
  const chatBody = st.mode === 'chat' && chatH ? CHAT_HEADER_H + chatH + 60 + (chat.length === 0 ? 44 : 0) + SURFACE_CHROME_Y : undefined;
  const [launching, setLaunching] = useState<{ openTab: boolean } | null>(null);
  const [launchFailure, setLaunchFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<ListNotice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  // The notice sits between the header and the rows: the list grows by its height (it can wrap) rather than scrolling.
  const noticeRef = useRef<HTMLDivElement>(null);
  const noticeH = useMeasuredHeight(noticeRef, st.mode === 'list' && !!notice, ps);
  const noticeExtraH = notice ? NOTICE_GAP + (noticeH || 36) : 0;
  // The update card sits under the notice and is measured the same way.
  const updateCard = update && update.card.kind !== 'hidden' ? update.card : null;
  const updateRef = useRef<HTMLDivElement>(null);
  const updateH = useMeasuredHeight(updateRef, st.mode === 'list' && !!updateCard, ps);
  const updateExtraH = updateCard ? NOTICE_GAP + (updateH || 120) : 0;
  // The « up to date » pip only stays six seconds.
  const [okGone, setOkGone] = useState(false);
  const okPip = update?.pip === 'ok';
  useEffect(() => {
    if (!okPip) { setOkGone(false); return; }
    const timer = setTimeout(() => setOkGone(true), 6000);
    return () => clearTimeout(timer);
  }, [okPip]);
  const updatePip = okPip && okGone ? null : update?.pip ?? null;
  const updateVersion = update ? targetOf(update.state) ?? '' : '';
  const gearLabel = update?.gear ? `${t.list.settings}, ${t.update.pip.new(updateVersion)}` : undefined;
  /** The session's terminal tab: brought forward when it exists, else opened on the session (a daemon-launched one has none yet). */
  const openTab = (id: string) => {
    const s = byId.get(id); if (!s) return;
    void focusTerminal(s.title).then(found => { if (!found && launcher && s.tmuxSession) return openTerminal(s.title, [...launcher, 'attach', id]); return found; });
  };
  const launch = (req: LaunchRequest) => {
    if (launching || status === 'unreachable') return;
    setLaunchFailure(null); setLaunching({ openTab: req.openTab });
    send({ type: 'session.launch', tool: req.tool, cwd: req.cwd, name: req.name, prompt: req.prompt, continue: req.continue });
  };
  useEffect(() => {
    if (!lastLaunched || !launching) return;
    const s = byId.get(lastLaunched.id);
    setLaunching(null);
    if (ctl.state().mode === 'launch') dispatch({ type: 'back' });
    if (s) {
      setNotice({ text: t.list.launched(s.name, s.project), action: { label: t.list.openTerminal, onClick: () => openTab(s.id) } });
      clearTimeout(noticeTimer.current); noticeTimer.current = setTimeout(() => setNotice(null), LAUNCH_NOTICE_MS);
      if (launching.openTab) openTab(s.id);
    }
  }, [lastLaunched?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!launching || !lastError || lastError.id) return;
    setLaunching(null); setLaunchFailure(lastError.message);
  }, [lastError?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (status === 'unreachable' && launching) { setLaunching(null); setLaunchFailure(t.lost); } }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const sayCandidates: SayCandidate[] = [];
  if (ledgeUnread) sayCandidates.push({ id: LEDGE_ID, kind: 'ledge', seed: ledgeSaySeed });
  for (const s of sessions) {
    const live = sayKindOf(s);
    if (live) sayCandidates.push({ id: s.id, kind: live, seed: `${s.id}:${live}:${s.pending?.text ?? s.state}` });
    else if (finishedUnread[s.id]) sayCandidates.push({ id: s.id, kind: 'finished', seed: finishedUnread[s.id]! });
  }
  const speaker = pickSpeaker(sayCandidates);
  const sayText = speaker ? pickSay(t.say[speaker.kind], speaker.seed) : '';
  // The strip shows under a covering window once the island has been folded and left alone for 500 ms; an unread say
  // hanging under its speaker keeps the island compact, the strip has no companion to hang it from.
  const strip = useDelayed(discreet && covered && st.mode === 'handle' && !st.hot && !st.hovering && bandPointer === null && speaker === null, STRIP_BACK_MS);
  const geo = scaledLayout({ bots: bots.map(b => ({ id: b.id, pending: b.pending || !!b.lifted || !!b.held })), mode: st.mode, screenH, screenW, position: islandPosition, strip, dnd, readerExpanded: st.documentExpanded, bubbleH: bubbleH ? bubbleH + SURFACE_CHROME_Y : undefined, sessionH, detailH: st.mode === 'chat' ? chatBody : detailBody ? DETAIL_HEADER_H + detailBody + SURFACE_CHROME_Y : undefined, askH: ASK_H, reading: st.reading, groups: groups.length, listExtraH: (focused && isYesNo(focused) ? EXPANDED_ROW_H - SIZES.rowH : 0) + noticeExtraH + updateExtraH }, { handle: hs, panel: ps });
  geoRef.current = geo;
  // The shell watches the top band over the island's span (its depth and overhang are the shell's own constants).
  useEffect(() => { setHotZone(Math.round(geo.handle.left), Math.round(geo.handle.w)); }, [geo.handle.left, geo.handle.w]);

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
  }, [st.mode, geo.left, geo.w, geo.h, ctl, dispatch]);

  const onBlur = (e: FocusEvent) => {
    if (!surfaceRef.current?.contains(e.relatedTarget as Node | null)) dispatch({ type: 'focusWithin', on: false });
    if (ctl.state().editing && !isEditable(e.relatedTarget as Element | null)) dispatch({ type: 'editing', on: false });
  };
  // Hovering the bare handle opens the list after the dwell, unless the daemon is out of reach.
  const handleArmed = () => ctl.state().mode === 'handle' && !unreachable;
  const onMouseEnter = () => { dispatch({ type: 'surfaceEnter' }); if (handleArmed()) dispatch({ type: 'handleEnter' }); };
  const onMouseLeave = () => { dispatch({ type: 'surfaceLeave' }); if (ctl.state().hot) dispatch({ type: 'handleLeave' }); };
  const onMouseMove = () => {
    if (!ctl.state().hovering) dispatch({ type: 'surfaceEnter' });
    if (handleArmed() && !ctl.state().hot) dispatch({ type: 'handleEnter' });
  };
  // The band along the top edge arms the dwell like the island itself; leaving it (and the island) disarms it. A panel
  // the band opened, left without ever being entered, folds like one the pointer left.
  useEffect(() => {
    if (bandPointer && handleArmed() && !ctl.state().hot) dispatch({ type: 'handleEnter' });
    if (bandPointer || inside(pointer.current, geoRef.current)) return;
    const s = ctl.state();
    if (s.hot) dispatch({ type: 'handleLeave' });
    if (s.mode !== 'handle' && s.openedBy === 'mouse' && !s.hovering) dispatch({ type: 'surfaceLeave' });
  }, [bandPointer]); // eslint-disable-line react-hooks/exhaustive-deps

  const panel = st.mode !== 'handle' && st.mode !== 'bubble';
  const detail = st.mode === 'session' || st.mode === 'settings' || st.mode === 'help' || st.mode === 'launch' || st.mode === 'chat' || st.mode === 'reader';
  const openDocument = (ref: DocumentReference, origin: { kind: 'session'; sessionId: string } | { kind: 'chat' }) => { documentSourceFocus.current = document.activeElement as HTMLElement; reader.open(ref, origin); dispatch({ type: 'documentOpen', origin }); };
  const readerBack = () => reader.back();
  const readerClose = () => { documentSourceFocus.current = null; reader.close(); dispatch({ type: 'close' }); };
  const activeReading = reader.state.current;
  const documentState: DocumentViewState | null = activeReading?.loading ? { status: 'loading', path: activeReading.reference.path }
    : activeReading?.error ? { status: 'error', path: activeReading.reference.path, code: activeReading.error }
    : activeReading?.document ? { status: 'ready', document: activeReading.document } : null;
  const unreachable = status === 'unreachable';
  // A question needs the socket open: the client drops a send while it is still connecting, so the turn would hang.
  const chatOffline = status !== 'open' ? t.offline : null;
  const bubblePaused = st.hovering || st.focusWithin || st.hidden || st.ack !== null;
  const send = (m: Parameters<DaemonClient['send']>[0]) => client.send(m);
  // Offline or read-only: every send/decision path (buttons and keys alike) is off, with the reason shown.
  const blockedFor = (s: Session | null | undefined): string | null => unreachable ? t.offline : s?.source === 'hook_only' ? t.readOnlyBlocked : s ? null : t.offline;
  const canDecide = (s: Session) => blockedFor(s) === null && !asks.inFlight.has(s.id);
  /** One decision command per request: false when blocked or already in flight. */
  const decide = (id: string, d: 'accept' | 'deny'): boolean => {
    if (blockedFor(byId.get(id)) !== null || !asks.begin(id)) return false;
    send({ type: 'session.decide', id, decision: d }); sounds.user(d === 'accept' ? 'accept' : 'deny'); return true;
  };
  /** A typed reply. A permission, diff or plan prompt takes Approve/Deny only (the field explains it); answering a
   *  question locks it like a decision. The draft is cleared on send and comes back if the daemon rejects it. */
  const reply = (id: string, text: string) => {
    const s = byId.get(id);
    if (!s || blockedFor(s) !== null || (s.pending && s.pending.kind !== 'question')) return;
    if (s.pending && !asks.begin(id)) return;
    asks.replied(id, text);
    send({ type: 'session.reply', id, text }); sounds.user('accept'); setDrafts(x => ({ ...x, [id]: '' })); dispatch({ type: 'typing', on: false });
  };
  const bubbleAck: BubbleAck = st.ack ? (st.ack.confirmed ? 'confirmed' : 'pending') : st.failed && st.failed === st.bubbleId ? 'failed' : null;
  // The coachmark sits 8 px under the panel, centred on it, clamped into the work area; the native frame extends to hold it.
  const coachShown = coach && kb && st.mode === 'list';
  const coachLeft = geo.left + geo.w / 2 - 150 * ps;
  const coachTop = Math.min(geo.h + 8 * ps, Math.max(0, screenH - (COACHMARK_H + 8) * ps));
  // The native window is the bounding frame of what is visible: the surface plus the status line, the unread say and
  // the coachmark when shown. Text extras are measured after layout (fixed fallbacks where layout gives nothing).
  const statusRef = useRef<HTMLDivElement>(null); const sayRef = useRef<HTMLButtonElement>(null);
  const [sizes, setSizes] = useState({ status: { w: 0, h: 0 }, say: { w: 0, h: 0 } });
  useLayoutEffect(() => {
    const status = measure(statusRef.current), say = measure(sayRef.current);
    setSizes(s => s.status.w === status.w && s.status.h === status.h && s.say.w === say.w && s.say.h === say.h ? s : { status, say });
  });
  const sayShown = st.mode === 'handle' && speaker !== null;
  const extras: Box[] = [];
  // The status line hangs centred under the island (its scale); the unread say hangs under its speaker, the coachmark under the panel, both at the windows' size.
  const statusW = sizes.status.w || STATUS_BOX.w * hs, statusH = sizes.status.h || STATUS_BOX.h * hs;
  const statusLeft = geo.left + geo.w / 2 - statusW / 2, statusTop = geo.h + 6 * hs;
  const saySlot = speaker && speaker.id !== LEDGE_ID ? geo.slots.find(s => s.id === speaker.id) : undefined;
  const speakerX = saySlot ? saySlot.center : geo.left + (ISLAND.padL + ISLAND.resident / 2) * hs;
  const sayLeft = speakerX - SAY_TAIL_X * ps, sayTop = geo.h + 4 * ps;
  if (sayShown) extras.push({ left: sayLeft, top: sayTop, w: sizes.say.w || UNREAD_SAY_BOX.w * ps, h: sizes.say.h || UNREAD_SAY_BOX.h * ps });
  if (unreachable) extras.push({ left: statusLeft, top: statusTop, w: statusW, h: statusH });
  if (coachShown) extras.push({ left: coachLeft, top: coachTop, w: 300 * ps, h: COACHMARK_H * ps });
  // The fillets either side of the surface, where it leaves the top edge.
  const sr = shoulderR(geo.w, strip);
  if (sr > 0) extras.push({ left: geo.left - sr, top: 0, w: geo.w + 2 * sr, h: sr });
  const frame = frameOf(geo, extras, { w: screenW, h: screenH });
  const offset = useNativeFrame(frame, parseFloat(ms(SETTLE_MS)));
  offsetRef.current = offset;
  useEffect(() => { setOutsideWatch(panel); }, [panel]);
  // The terminal tab is the fallback for read-only and offline sessions too: only the daemon message needs the daemon.
  const focusTab = (id: string) => { const s = byId.get(id); if (!s) return; if (!unreachable) send({ type: 'session.focus', id }); openTab(id); };
  const chooseOption = (n: number) => {
    if (blockedFor(selected) !== null) return;
    const radios = surfaceRef.current?.querySelectorAll<HTMLInputElement>('[data-layer="session"] [data-ask] input[type="radio"]:not([data-other])');
    const r = radios?.[n - 1]; if (!r) return;
    r.click(); r.focus();
  };
  const openRow = (id: string) => dispatch({ type: 'rowClick', id });
  /** Asks Ledge: the turn appears at once in the store, the daemon streams its steps and answer back. */
  const ask = (text: string) => {
    const qid = `q-${Date.now().toString(36)}`;
    daemonStore.beginTurn({ qid, question: text, askedAt: new Date().toISOString(), steps: [] });
    send({ type: 'chat.ask', qid, text, tool: defaultTool });
    if (ctl.state().mode !== 'chat') dispatch({ type: 'chat' });
  };
  useKeyboard({
    enabled: panel, mode: st.mode, sessions, focusedId: st.mode === 'session' ? st.selectedId : st.mode === 'list' ? focused?.id ?? null : null,
    onFocus: setFocusedId, onOpen: openRow, onDecide: decide,
    onClose: () => st.mode === 'reader' ? readerBack() : dispatch({ type: detail ? 'back' : 'close' }),
    onAsk: () => surfaceRef.current?.querySelector<HTMLInputElement>('[data-ask-input]')?.focus(),
    onInstruction: () => surfaceRef.current?.querySelector<HTMLTextAreaElement>('[data-layer="launch"] [data-launch-prompt]')?.focus(),
    onReplyFocus: () => {
      if (st.mode !== 'session' && st.mode !== 'list') return;
      if (st.mode === 'session') { surfaceRef.current?.querySelector<HTMLTextAreaElement>('[data-layer="session"] [data-reply]')?.focus(); return; }
      if (focused) { replyAfterOpen.current = true; openRow(focused.id); }
    },
    onToggleDnd, onHelp: () => dispatch({ type: st.mode === 'help' ? 'back' : 'help' }), onTerminal: focusTab, onChooseOption: chooseOption
  });
  const motion = growing ? MOTION.grow : MOTION.shrink;
  const delay = growing ? 0 : MOTION.shrink.delayMs;
  // The entering view follows the shape once it has nearly settled: later on a shrink (back from a session) than on a grow.
  const enter = enterDelay(growing);

  const tauri = isTauri();
  const radius = strip ? 6 : st.mode === 'handle' ? 19 : 22;
  const surfaceTransition = ['left', 'width', 'height'].map(p => `${p} ${ms(motion.ms)} ${motion.ease} ${ms(delay)}`).join(', ') + `, opacity ${ms(150)} ease-out`;
  const content = (
    <>
      <div ref={surfaceRef} data-surface data-mode={st.mode} data-strip={strip || undefined}
        onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onMouseMove={onMouseMove}
        onFocus={e => {
          if (!ctl.state().focusWithin) dispatch({ type: 'focusWithin', on: true });
          // A field being filled keeps a mouse-opened panel open when the pointer leaves; a button or a row does not.
          const editing = isEditable(e.target as Element);
          if (editing !== ctl.state().editing) dispatch({ type: 'editing', on: editing });
          // Native Tab onto another row moves the keyboard focus with it.
          const row = (e.target as HTMLElement).closest?.('[data-row]') ? (e.target as HTMLElement).closest<HTMLElement>('[data-row-id]')?.dataset.rowId : undefined;
          if (row && kb && ctl.state().mode === 'list') setFocusedId(row);
        }} onBlur={onBlur}
        style={{ position: 'absolute', left: geo.left, top: 0, width: geo.w, height: geo.h, boxSizing: 'border-box', overflow: 'clip', background: 'var(--notch)', color: 'var(--sidebar-foreground)', borderRadius: `0px 0px ${radius}px ${radius}px`, opacity: unreachable ? 0.6 : 1, willChange: 'left, width, height',
          transition: surfaceTransition }}>
        <div data-zoom="handle" style={{ position: 'absolute', left: 0, top: 0, zoom: hs }}>
          <Handle updatePip={updatePip} updateVersion={updateVersion} bots={bots} slots={geo.slots} visible={st.mode === 'handle'} strip={strip} hoverId={hoverId} onHover={setHoverId} onOpen={id => dispatch({ type: 'botClick', id })} onOpenHome={() => dispatch({ type: ledgeUnread ? 'chat' : 'homeClick' })} left={geo.left} scale={hs} pointer={st.mode === 'handle' ? residentPointer : null} residentSignal={residentSignal} unread={ledgeUnread} sayId={speaker && speaker.id !== LEDGE_ID ? speaker.id : null} dnd={dnd} theme={theme} frozen={unreachable} reducedMotion={reducedMotion} />
        </div>
        <div data-zoom="panel" style={{ position: 'absolute', left: 0, top: 0, zoom: ps }}>
        <Bubble ref={bubbleRef} kind={st.bubbleKind} elapsedMs={st.bubbleId ? elapsed[st.bubbleId] : undefined} preview={st.bubbleId === LEDGE_ID ? ledgePreview : undefined} session={bubbleSession} moreCount={Math.max(0, st.queue.length - 1)} visible={st.mode === 'bubble'} paused={bubblePaused} remainingMs={ctl.bubbleRemaining() ?? undefined}
          ack={bubbleAck} deciding={!!st.bubbleId && asks.inFlight.has(st.bubbleId)} failure={st.bubbleId ? asks.failures[st.bubbleId] : undefined} blocked={bubbleSession ? blockedFor(bubbleSession) : null} frozen={unreachable} reducedMotion={reducedMotion}
          onOpen={() => dispatch({ type: 'bubbleClick' })} onDismiss={() => dispatch({ type: 'close' })}
          onDecide={d => { if (st.bubbleId && !ctl.state().ack && decide(st.bubbleId, d)) dispatch({ type: 'decidedInBubble' }); }}
          onReply={t => {
            const id = st.bubbleId; if (!id || ctl.state().ack || blockedFor(byId.get(id)) !== null || !asks.begin(id)) return;
            send({ type: 'session.reply', id, text: t }); sounds.user('accept'); dispatch({ type: 'decidedInBubble' });
          }} theme={theme} />
        </div>
        <div data-panel style={{ position: 'absolute', inset: 0, zoom: ps, opacity: panel ? 1 : 0, pointerEvents: panel ? 'auto' : 'none', transition: transition([['opacity', panel ? 'fadeIn' : 'fadeOut', panel ? 120 : 0]]) }}>
          <div aria-hidden={st.mode !== 'list' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'list' ? 'auto' : 'none', transform: `translateX(${detail ? -12 : 0}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            <SessionList sessions={sessions} visible={st.mode === 'list'} enterDelay={enter} selectedId={st.selectedId} focusedId={st.mode === 'list' ? focused?.id ?? null : null} dnd={dnd} onToggleDnd={onToggleDnd} onOpen={openRow} onDecide={decide} canDecide={canDecide}
              onDismiss={id => { if (!unreachable) send({ type: 'session.dismiss', id }); }} offline={unreachable}
              onClose={() => dispatch({ type: 'close' })} onSettings={() => dispatch({ type: 'settings' })} onHelp={() => dispatch({ type: 'help' })} onLaunch={() => dispatch({ type: 'launch' })} notice={notice} noticeRef={noticeRef} gearPip={!!update?.gear} gearLabel={gearLabel} updateRef={updateRef}
              update={updateCard ? <UpdateCard view={updateCard} sessions={sessions.length} onUpdate={update!.start} onLater={update!.later} onRetry={update!.retry} onAck={update!.ackUpdated} onNotes={() => openUrl('https://github.com/Paradow-dev/ledge/releases/latest')} /> : null} theme={theme} frozen={unreachable} reducedMotion={reducedMotion}
              onAsk={ask} onOpenChat={() => dispatch({ type: 'chat' })} onTyping={on => dispatch({ type: 'typing', on })} askDisabled={chatOffline !== null} />
          </div>
          <div aria-hidden={st.mode !== 'chat' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'chat' ? 'auto' : 'none', transform: `translateX(${st.mode === 'chat' ? 0 : 12}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            <ChatView contentRef={chatRef} turns={chat} live={chatLive} sessions={sessions} visible={st.mode === 'chat'} enterDelay={enter} offline={chatOffline}
              onAsk={ask} onCancel={qid => send({ type: 'chat.cancel', qid })} onReset={() => send({ type: 'chat.reset' })} onBack={() => dispatch({ type: 'back' })} onClose={() => dispatch({ type: 'close' })} onOpenSession={openRow}
              theme={theme} frozen={unreachable} reducedMotion={reducedMotion} onDocument={ref => openDocument(ref, { kind: 'chat' })} />
          </div>
          <div aria-hidden={st.mode !== 'launch' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'launch' ? 'auto' : 'none', transform: `translateX(${st.mode === 'launch' ? 0 : 12}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            <LaunchView key={launchOpen} contentRef={launchRef} visible={st.mode === 'launch'} enterDelay={enter} recents={recents} sessions={sessions} offline={unreachable ? t.offline : null} busy={!!launching} failure={launchFailure}
              listing={lastListing} onFolders={m => send(m)}
              onLaunch={launch} onBack={() => dispatch({ type: 'back' })} onClose={() => dispatch({ type: 'close' })} theme={theme} frozen={unreachable} reducedMotion={reducedMotion} />
          </div>
          <div aria-hidden={st.mode !== 'settings' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'settings' ? 'auto' : 'none', transform: `translateX(${st.mode === 'settings' ? 0 : 12}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            <SettingsView contentRef={settingsRef} onLang={onLang} visible={st.mode === 'settings'} enterDelay={enter} theme={theme} dnd={dnd} reduced={motionPrefs.app} osReduced={osReduced} finished={prefs.finished} onFinished={prefs.setFinished} sounds={prefs.sounds} onSounds={prefs.setSounds} onTestSound={sounds.test} scales={scales} autoScales={autoScales} onScale={onScale}
              monitors={monitors} monitor={monitor} onMonitor={onMonitor} autostart={autostart} onAutostart={onAutostart}
              defaultTool={defaultTool} onDefaultTool={chooseDefaultTool} accent={accent} onAccent={onAccent}
              islandPosition={islandPosition} onIslandPosition={onIslandPosition} discreet={discreet} onDiscreet={onDiscreet}
              onToggleTheme={onToggleTheme} onToggleDnd={onToggleDnd} onReduced={motionPrefs.setReduced} onBack={() => dispatch({ type: 'back' })} onClose={() => dispatch({ type: 'close' })} />
          </div>
          <div aria-hidden={st.mode !== 'help' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'help' ? 'auto' : 'none', transform: `translateX(${st.mode === 'help' ? 0 : 12}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            <HelpView contentRef={helpRef} visible={st.mode === 'help'} enterDelay={enter} onBack={() => dispatch({ type: 'back' })} onClose={() => dispatch({ type: 'close' })} />
          </div>
          <div aria-hidden={st.mode !== 'session' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'session' ? 'auto' : 'none', transform: `translateX(${st.mode === 'session' ? 0 : 12}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            {shown && <SessionView contentRef={sessionContentRef} replyRef={sessionReplyRef} session={shown} preview={shownPreview} visible={st.mode === 'session'} enterDelay={enter} reading={st.reading} draft={drafts[shown.id] ?? ''}
              blocked={blockedFor(shown)} deciding={asks.inFlight.has(shown.id)} failure={asks.failures[shown.id]} frozen={unreachable} reducedMotion={reducedMotion}
              onDraft={t => { setDrafts(x => ({ ...x, [shown.id]: t })); dispatch({ type: 'typing', on: t.length > 0 }); }}
              onBack={() => dispatch({ type: 'back' })} onClose={() => dispatch({ type: 'close' })} onDecide={d => decide(shown.id, d)} onReply={t => reply(shown.id, t)}
              onInterrupt={() => send({ type: 'session.interrupt', id: shown.id })} onKill={() => send({ type: 'session.kill', id: shown.id })}
              onDismiss={() => { if (!unreachable) send({ type: 'session.dismiss', id: shown.id }); }} dismissOff={unreachable}
              onFocus={() => focusTab(shown.id)} onToggleReading={() => dispatch({ type: 'reading', on: !st.reading })} onRename={shown.state !== 'exited' ? topic => send({ type: 'session.rename', id: shown.id, topic }) : undefined} onDocument={ref => openDocument(ref, { kind: 'session', sessionId: shown.id })} theme={theme} />}
          </div>
          {st.mode === 'reader' && activeReading && documentState && <DocumentView state={documentState} reading={activeReading} onReading={reader.setReading} originName={st.documentOrigin?.kind === 'session' ? byId.get(st.documentOrigin.sessionId)?.name ?? st.documentOrigin.sessionId : 'Ledge'} theme={theme} expanded={st.documentExpanded} onBack={readerBack} onClose={readerClose} onExpand={() => dispatch({ type: 'documentExpanded', on: !st.documentExpanded })} onReload={reader.reload} onDocument={reader.follow} />}
        </div>
      </div>

      {/* Drawn after the surface: each overlaps its edge by a pixel, so no seam shows where they meet. */}
      <Shoulders left={geo.left} w={geo.w} strip={strip} opacity={unreachable ? 0.6 : 1} transition={surfaceTransition} />

      {/* Zoomed extras: a zoomed element's own offsets are zoomed too, so their real-px positions are divided back. */}
      <div data-zoom="coachmark" style={{ position: 'absolute', left: 0, top: 0, zoom: ps }}>
        <Coachmark visible={coachShown} top={coachTop / ps} left={coachLeft / ps} onDismiss={() => { setCoach(false); if (focusedRowId) surfaceRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(focusedRowId)}"] [data-row]`)?.focus(); }} />
      </div>
      <div data-zoom="unread-say" style={{ position: 'absolute', left: 0, top: 0, zoom: ps }}>
        <UnreadSay ref={sayRef} visible={sayShown} text={sayText} kind={speaker?.kind ?? 'ledge'} top={sayTop / ps} left={sayLeft / ps} onOpen={() => {
          if (!speaker) return;
          if (speaker.id === LEDGE_ID) dispatch({ type: 'chat' });
          else dispatch({ type: 'botClick', id: speaker.id });
        }} />
      </div>
      <div data-zoom="status" style={{ position: 'absolute', left: 0, top: 0, zoom: hs }}>
        {unreachable && <div ref={statusRef} role="status" style={{ position: 'absolute', left: statusLeft / hs, top: statusTop / hs, fontSize: 12, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>{t.unreachable}</div>}
      </div>
    </>
  );
  // Under Tauri the page is shifted so page y = screen y - frame top; the browser renders at page coordinates as is.
  return tauri ? <div data-frame-content style={{ position: 'absolute', left: -offset.left, top: -offset.top, width: '100%' }}>{content}</div> : content;
}
