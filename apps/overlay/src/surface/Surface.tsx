import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
import { DEFAULT_ISLAND_PREFS, proposalRows, type IslandPrefs, type Session, type Tool } from '@ledge/protocol';
import { loadDefaultTool, saveDefaultTool } from '../defaultTool';
import { useActionCards } from '@ledge/ui/chat/useActionCards';
import { useDaemon, daemonStore } from '../daemon/store';
import type { DaemonClient } from '../daemon/client';
import { useMachines } from '../daemon/machines';
import type { DocumentOrigin } from '../documents/useDocumentReader';
import type { ResidentGesture } from '../bots/ResidentMascot';
import { groupSessions, sayToLedge } from '@ledge/fleet';
import { displayOrder, headersBefore } from './groups';
import { FILET, LEDGE_ID, scaledLayout, SIZES, SURFACE_CHROME_Y, type IslandPosition, type Layout } from './geometry';
import { createSurfaceController } from './controller';
import type { SurfaceState } from './machine';
import { Handle, type HandleMeasure } from './Handle';
import { useHandleLine } from './useHandleLine';
import { UnreadSay, UNREAD_SAY_BOX, SAY_TAIL_X } from './UnreadSay';
import { pickSay, pickSpeaker, sayKindOf, SAY_LINGER_MS, type SayCandidate } from './say';
import { Bubble, type BubbleAck } from './Bubble';
import { PeekCard } from './PeekCard';
import { openInLedge, subscribeOpenInLedge } from '../desktop/openInLedge';
import { SettingsView } from './SettingsView';
import { HelpView } from './HelpView';
import { HelperView } from './HelperView';
import { TurnThumbs } from './TurnThumbs';
import { LaunchView, LAUNCH_FOOTER_H, type LaunchRequest } from './LaunchView';
import { CHAT_HEADER_H, CHAT_COMPOSER_H } from './ChatView';
import { LedgeFeed } from './LedgeFeed';
import { loadOpenTab } from './openTabPreference';
import { DETAIL_HEADER_H } from './DetailHeader';
import { useMeasuredHeight } from './useMeasuredHeight';
import { useDaemonAsks, isPending } from './useDaemonAsks';
import { useFocusRestore } from './useFocusRestore';
import { useSoundPrefs } from '../sounds/preferences';
import { useSounds } from '../sounds/useSounds';
import { createSilentPlayer, type SoundPlayer } from '../sounds/player';
import { useMotionPreferences, useOsReducedMotion } from '../motionPreferences';
import { SessionList, EXPANDED_ROW_H, ASK_H, NOTICE_GAP, type ListNotice } from './SessionList';
import { SessionView, measureSessionH, SESSION_HEADER_H, READING_TERMINAL_H } from './SessionView';
import { useI18n } from '../i18n/lang';
import type { PipTone } from './Handle';
import { transition, MOTION, ms, enterDelay } from '../motion';
import { focusTerminal, openTerminal, onShortcut, onNewSessionShortcut, onOutsideClick, setOutsideWatch, onCursorProximity, focusOverlay, releaseFocus, isTauri, onForegroundCovered, setHotZone, quitApp } from '../tauri/bridge';
import { Icon, ICONS } from '../ui/icons';
import { useNativeFrame } from '../tauri/useNativeFrame';
import { useDelayed } from './useDelayed';
import { frameOf, type Box } from './frame';
import { Shoulders, SHOULDER_R, shoulderR } from './Shoulders';
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
/** No frame at all while the island is hidden: the window takes the mouse nowhere. */
const HIDDEN_FRAME = { left: 0, top: 0, w: 0, h: 0 } as const;
/** A hot zone no cursor reaches while the island is hidden (the shell keeps watching one). */
const HIDDEN_HOT = { left: -100_000, w: 0 } as const;
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
  /** The Screen setting: the monitors to choose from, the choice (null: the primary) and how to change it (live).
   *  `onSettingsOpen` fires when the Settings view opens, so the monitors can be listed again. */
  monitors?: MonitorInfo[]; monitor?: string | null; onMonitor?: (id: string | null) => void; onSettingsOpen?: () => void;
  /** The brand colour (null: factory coral) and how to change it (live). */
  accent?: string | null; onAccent?: (hex: string | null) => void;
  /** Plays the sound cues (one Web Audio player per app); a silent player when absent. */
  soundPlayer?: SoundPlayer;
  /** The version Ledge Desktop found and has not installed (null: none): the « new version » pip on the island. */
  desktopUpdate?: string | null;
  /** The daemon refuses this Ledge for lack of a token (an older daemon): the status line says to update it. */
  daemonOutdated?: boolean;
  /** The island's settings from Ledge Desktop (atelier spec §7): hidden, nothing is drawn and nothing takes the mouse, the
   *  asks are still counted; `shows` says what it shows besides asks and questions; the shortcut is only shown. */
  visible?: boolean; shows?: IslandPrefs['shows']; shortcut?: string;
}

/** A text field or editable content: focus there means someone is filling it in. Radios, buttons and rows are not. */
const isEditable = (el: Element | null) => !!el && ((el.tagName === 'INPUT' && !['radio', 'checkbox', 'button', 'submit'].includes((el as HTMLInputElement).type)) || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);

export function Surface({ screenH, screenW = window.innerWidth, theme, client, dnd, onToggleDnd, onToggleTheme, handleScale = 1, panelScale = 1, scales, autoScales, onScale, monitors, monitor = null, onMonitor, onSettingsOpen, accent = null, onAccent, soundPlayer, islandPosition = 'center', onIslandPosition, discreet = true, onDiscreet, desktopUpdate = null, daemonOutdated = false, visible = true, shows = DEFAULT_ISLAND_PREFS.shows, shortcut }: SurfaceProps) {
  // Geometry, pointer and frames are in real px; the handle layer is zoomed by `hs`, the opened views by `ps`. A
  // measured view (bubble, session, settings, help) reports its base height: its client rect divided by `ps`.
  const hs = handleScale, ps = panelScale;
  const { sessions: daemonSessions, byId, status, previews, threads, lastError, errors, recents, launcher, lastLaunched, lastListing, chat, chatLive } = useDaemon();
  const machines = useMachines(client);
  const launchMachine = client.fleet?.selected();
  const chosenMachine = machines.find(m => m.id === launchMachine);
  const disconnected = machines.filter(m => !m.ready).map(m => m.label);
  // Everything indexed (digits, J/K, the handle, the coachmark row) follows the order the list displays: grouped by repository.
  const sessions = useMemo(() => displayOrder(daemonSessions), [daemonSessions]);
  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const { t } = useI18n();
  // One app-level motion preference drives every bot in every layer.
  const motionPrefs = useMotionPreferences();
  const osReduced = useOsReducedMotion();
  const reducedMotion = motionPrefs.reduced;
  const prefs = useSoundPrefs();
  const finishedBubble = (prefs.finished === 'both' || prefs.finished === 'bubble') && shows.finished;
  const quick = shows.quick;
  const visibleRef = useRef(visible); visibleRef.current = visible;
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
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [residentPointer, setResidentPointer] = useState<{ x: number; y: number } | null>(null);
  /** The pointer while it is in the top band beside the island (null elsewhere); it arms the dwell like the island does. */
  const [bandPointer, setBandPointer] = useState<{ x: number; y: number } | null>(null);
  /** A maximised window in the foreground covers the island's spot (the shell says so). */
  const [covered, setCovered] = useState(false);
  const geoRef = useRef<Layout>(null!);
  useEffect(() => () => ctl.dispose(), [ctl]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [coach, setCoach] = useState(false);
  const replyAfterOpen = useRef(false);

  // Ctrl+Alt+L opens the first ask, else the chat, and folds the chat. Focus follows so the card's keys arrive.
  useEffect(() => onShortcut(() => {
    if (!visibleRef.current) return;
    dispatch({ type: 'shortcut' });
    void focusOverlay();
  }), [ctl, dispatch]);

  // Ctrl+Alt+N no longer opens a form. It asks Ledge Desktop for a new session.
  useEffect(() => onNewSessionShortcut(() => { openInLedge({ kind: 'launch' }); }), [ctl, dispatch]);

  // The keys of the open card. Enter on a focused button keeps its click. Letters never fire inside a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = ctl.state();
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === 'Escape' && st.mode !== 'handle') {
        if (menuOpen) { setMenuOpen(false); return; }
        e.preventDefault();
        dispatch({ type: st.mode === 'bubble' && st.bubbleKind === 'ask' ? 'defer' : 'close' });
        return;
      }
      if (st.mode !== 'bubble' || st.bubbleKind !== 'ask' || !st.bubbleId || st.ack || e.ctrlKey || e.metaKey || e.altKey) return;
      const session = byId.get(st.bubbleId);
      const pending = session?.pending;
      if (e.key === 'Enter' && !(el?.tagName === 'BUTTON') && (!typing || el?.dataset.reply !== undefined)) {
        e.preventDefault();
        if (!quick) openInLedge({ kind: 'session', id: st.bubbleId });
        else if (pending?.kind === 'question') {
          const field = surfaceRef.current?.querySelector<HTMLInputElement>('[data-reply]');
          const chosen = surfaceRef.current?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"] span');
          const answer = field?.value.trim() || chosen?.textContent || '';
          if (!answer) return;
          if (blockedFor(session) !== null || !asks.begin(st.bubbleId)) return;
          send({ type: 'session.reply', id: st.bubbleId, text: answer });
          sounds.user('accept');
          dispatch({ type: 'decidedInBubble' });
        } else if (pending?.kind === 'permission') {
          if (decide(st.bubbleId, 'accept')) dispatch({ type: 'decidedInBubble' });
        } else openInLedge({ kind: 'session', id: st.bubbleId });
        return;
      }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === 'o') { e.preventDefault(); openInLedge(st.bubbleId.startsWith('machine:') ? { kind: 'machines' } : { kind: 'session', id: st.bubbleId }); }
      else if (!quick) return;
      else if (pending?.kind === 'permission' && k === 'y') { if (decide(st.bubbleId, 'accept')) dispatch({ type: 'decidedInBubble' }); }
      else if (pending?.kind === 'permission' && k === 'n') { if (decide(st.bubbleId, 'deny')) dispatch({ type: 'decidedInBubble' }); }
      else if (pending?.kind === 'question' && /^[1-9]$/.test(k)) {
        surfaceRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[Number(k) - 1]?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
    setBandPointer(visibleRef.current && inBand(point, geoRef.current) ? point : null);
    setResidentPointer(ctl.state().mode === 'handle' ? point : null);
  }), [ctl]);
  useEffect(() => onForegroundCovered(setCovered), []);

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
    if (c.kind === 'failed' && !dnd) {
      const crashed = sessions.find(s => s.id === c.id);
      if (crashed && !crashed.pending) dispatch({ type: 'notice', id: c.id, kind: 'error' });
    }
    if (c.kind === 'asked' || c.kind === 'left' || c.kind === 'failed') setFinishedUnread(x => { if (!(c.id in x)) return x; const { [c.id]: _gone, ...rest } = x; return rest; });
  }, onReplyRejected: (id, text) => setDrafts(x => (x[id] ? x : { ...x, [id]: text })) });

  // Hidden from Desktop: whatever was open folds; the asks stay queued for when it shows again.
  useEffect(() => { if (!visible) { dispatch({ type: 'close' }); setBandPointer(null); } }, [visible, dispatch]);
  // DND folds the bubble and keeps the queue. Nothing unfolds on its own. Turning it off does not re-bubble.
  useEffect(() => { dispatch({ type: 'dnd', on: dnd }); }, [dnd, dispatch]);
  // A machine that drops gets a notice. Coming back removes it. Nothing unfolds during Do not disturb.
  const machineReady = useRef<Map<string, boolean>>(new Map());
  useEffect(() => {
    for (const m of machines) {
      const was = machineReady.current.get(m.id);
      if (was === true && !m.ready && !dnd) dispatch({ type: 'notice', id: `machine:${m.id}`, kind: 'offline' });
      if (was === false && m.ready) dispatch({ type: 'removed', id: `machine:${m.id}`, remaining: sessions.map(s => s.id) });
      machineReady.current.set(m.id, m.ready);
    }
  }, [machines, dnd, sessions, dispatch]);
  const [handoff, setHandoff] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => subscribeOpenInLedge((target, outcome) => {
    if (outcome !== 'opening') { setHandoff(t.handoff[outcome]); return; }
    const name = (id: string) => sessions.find(s => s.id === id)?.name ?? id;
    const line = target.kind === 'session' ? t.handoff.session(name(target.id))
      : target.kind === 'terminal' ? t.handoff.terminal(name(target.id))
      : target.kind === 'document' ? t.handoff.document(target.path)
      : t.handoff[target.kind];
    setHandoff(`${line}…`);
  }), [sessions, t]);

  // A hidden document holds the bubble clock.
  useEffect(() => {
    const sync = () => dispatch({ type: 'visibility', hidden: document.hidden });
    if (document.hidden) sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [dispatch]);

  // The last known pointer position, to tell whether the surface shrank out from under it.
  useEffect(() => {
    // Page coordinates are work-area coordinates in both worlds: the native window covers the work area.
    const track = (e: PointerEvent | MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      setBandPointer(visibleRef.current && inBand(pointer.current, geoRef.current) ? pointer.current : null);
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

  useFocusRestore(surfaceRef, { mode: st.mode, selectedId: st.selectedId, helperId: st.helperId });
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

  // The closed notch is Ledge alone (lot 4): its line, and the widths it and the trailing slot measure, size it.
  const line = useHandleLine(client, sessions, t);
  const [handleSizes, setHandleSizes] = useState<HandleMeasure>({ line: 0, trailing: 0 });
  const onHandleMeasure = useCallback((m: HandleMeasure) => setHandleSizes(p => (p.line === m.line && p.trailing === m.trailing ? p : m)), []);
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
      setResidentSignal({ key: ++signalCounter.current, kind: 'happy' });
    }
  }, [chat]); // eslint-disable-line react-hooks/exhaustive-deps -- finishedBubble/dnd/sounds read the live values of this render
  // Unread: a new element of Ledge's thread while the notch is not open on it (an answer finished, a decision in message, one
  // Ledge settled), never the user's own messages nor the exchanges between agents (the closed notch already shows those).
  // Live items only: the history sent on connect is not news.
  useEffect(() => client.onMessage(m => {
    if (m.type !== 'ledge.thread.item') return;
    const i = m.item;
    const news = (i.kind === 'ledge' && !i.pending && !!i.text) || i.kind === 'decided' || i.kind === 'escalation';
    if (news && ctl.state().mode !== 'chat') { setLedgeUnread(true); setLedgeSaySeed(i.id); }
  }), [client, ctl]);
  useEffect(() => { if (st.mode === 'chat') setLedgeUnread(false); }, [st.mode]);
  useEffect(() => {
    if ((st.mode !== 'session' && st.mode !== 'peek') || !st.selectedId) return;
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
  const peekSession = st.mode === 'peek' && st.selectedId ? byId.get(st.selectedId) ?? null : null;
  const offlineMachine = st.bubbleKind === 'offline' && st.bubbleId?.startsWith('machine:') ? machines.find(m => m.id === st.bubbleId!.slice('machine:'.length)) : undefined;
  const bubbleRef = useRef<HTMLDivElement>(null);
  const bubbleH = useMeasuredHeight(bubbleRef, st.mode === 'bubble', ps);
  // The peek is its own card: it never takes the bubble's last height.
  const peekRef = useRef<HTMLDivElement>(null);
  const peekH = useMeasuredHeight(peekRef, st.mode === 'peek', ps, st.selectedId);
  // The open session sizes itself to its content (header + scroll content + reply area), up to the screen.
  const sessionContentRef = useRef<HTMLDivElement>(null); const sessionReplyRef = useRef<HTMLDivElement>(null);
  const contentH = useMeasuredHeight(sessionContentRef, st.mode === 'session', ps);
  const replyH = useMeasuredHeight(sessionReplyRef, st.mode === 'session', ps);
  const helperRef = useRef<HTMLDivElement>(null);
  const helperContentH = useMeasuredHeight(helperRef, st.mode === 'helper', ps);
  // The bottom area holds the terminal strip and, unless read-only, the reply field. In reading mode the terminal sits
  // alongside the thread: the view is at least tall enough for its lines.
  const fitH = !selected ? 480 : contentH ? SESSION_HEADER_H + contentH + replyH + SURFACE_CHROME_Y : measureSessionH(selected, st.reading);
  const sessionH = st.reading && shownPreview.length ? Math.max(fitH, SESSION_HEADER_H + READING_TERMINAL_H + SURFACE_CHROME_Y) : fitH;
  // A helper opens from its row over the reply field, at the bottom of the session: its view keeps at least the
  // session's height, so the panel never shrinks away from under the pointer that just clicked (which would fold it).
  const helperH = Math.max(helperContentH ? helperContentH + SURFACE_CHROME_Y : 480, sessionH);
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
  // The chat sizes itself to its thread: header + measured content (the empty state and its starters included) + the composer.
  const chatRef = useRef<HTMLDivElement>(null);
  const chatH = useMeasuredHeight(chatRef, st.mode === 'chat', ps);
  const chatBody = st.mode === 'chat' && chatH ? CHAT_HEADER_H + chatH + CHAT_COMPOSER_H + SURFACE_CHROME_Y : undefined;
  const [launching, setLaunching] = useState<{ openTab: boolean } | null>(null);
  const [launchFailure, setLaunchFailure] = useState<string | null>(null);
  // A chat card's launch (spec 2026-10-12 §6): the turn's qid while the daemon answers. The card's own state
  // (launched, failed) comes back with chat.history; the chat stays open.
  const [chatLaunching, setChatLaunching] = useState<string | null>(null);
  const [notice, setNotice] = useState<ListNotice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  // The notice sits between the header and the rows: the list grows by its height (it can wrap) rather than scrolling.
  const noticeRef = useRef<HTMLDivElement>(null);
  const noticeH = useMeasuredHeight(noticeRef, st.mode === 'list' && !!notice, ps);
  const noticeExtraH = notice ? NOTICE_GAP + (noticeH || 36) : 0;
  // Desktop checks and installs; the island only says a version is there and hands the click to Desktop.
  const updatePip: PipTone = desktopUpdate ? 'new' : null;
  const updateVersion = desktopUpdate ?? '';
  /** The session's terminal tab: brought forward when it exists, else opened on the session (a daemon-launched one has none yet). */
  const openTab = (id: string) => {
    const s = byId.get(id); if (!s) return;
    const command = client.fleet ? client.fleet.terminal(id) : launcher ? [...launcher, 'attach', id] : null;
    // Identical bot names and topics may exist on different hosts: never focus a local tab for a remote session.
    if (s.machineId && s.machineId !== 'local') { if (command && s.tmuxSession) void openTerminal(`${s.machineName} · ${s.title}`, command); return; }
    void focusTerminal(s.title).then(found => { if (!found && command && s.tmuxSession) return openTerminal(s.title, command); return found; });
  };
  // A chat card's relay (spec 2026-10-12 relay §6): the turn's qid while the daemon answers. The card's own state (queued, sent, failed)
  // comes back with chat.history; a refusal comes back as an id-less error, so a relay and a launch are never in flight together.
  const [relaying, setRelaying] = useState<string | null>(null);
  const relayState = (qid: string | null) => { const r = qid ? chat.find(x => x.qid === qid)?.relay : undefined; return r ? `${r.status ?? ''}|${r.sentAt ?? ''}|${r.error ?? ''}` : 'gone'; };
  const relayFrom = useRef('');
  const relayCard = (type: 'session.relay' | 'session.relay.cancel', qid: string) => {
    if (client.fleet && !client.fleet.turnMachine(qid)?.ready) return;
    if (relaying || launching || chatLaunching || chatClosing || status === 'unreachable' || !chat.find(x => x.qid === qid)?.relay) return;
    relayFrom.current = relayState(qid); setRelaying(qid);
    send({ type, qid });
  };
  const relayingNow = relayState(relaying);
  useEffect(() => { if (relaying && relayingNow !== relayFrom.current) setRelaying(null); }, [relaying, relayingNow]);
  useEffect(() => { if (relaying && lastError && !lastError.id) setRelaying(null); }, [lastError?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (status === 'unreachable' && relaying) setRelaying(null); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const launch = (req: LaunchRequest) => {
    if (launching || chatLaunching || chatClosing || relaying || status === 'unreachable') return;
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
  const launchProposal = (qid: string, asked?: number[]) => {
    if (client.fleet && !client.fleet.turnMachine(qid)?.ready) return;
    const all = proposalRows(chat.find(x => x.qid === qid));
    const rows = (asked ?? [0]).filter(r => all[r] && !all[r]!.launchedId);
    const p = all[rows[0] ?? -1];
    if (!p || launching || chatLaunching || chatClosing || relaying || status === 'unreachable') return;
    launchedFrom.current = rows.map(r => ({ row: r, error: all[r]!.error })); setChatLaunching(qid);
    send({ type: 'session.launch', tool: p.tool, cwd: p.cwd, ...(p.prompt ? { prompt: p.prompt } : {}), qid, ...(asked ? { rows } : {}) });
  };
  useEffect(() => {
    if (!lastLaunched || !chatLaunching) return;
    // A card launching several rows (#24) waits for its marks; each session still gets its tab.
    if (launchedFrom.current.length <= 1) setChatLaunching(null);
    if (loadOpenTab()) openTab(lastLaunched.id);
  }, [lastLaunched?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  // The card's own outcome frees it: the daemon marks the turn (launchedId, or error) in a chat.history, then answers. Any other history frame
  // or id-less error must not, or the later session.launched finds no launch and the tab stays closed. A retry failing with the same message
  // leaves the history unchanged: its error, matching the turn's, frees it.
  // The rows sent and the error each had then (#24: a grouped card sends several); the card is freed once every row is launched or failed anew.
  const launchedFrom = useRef<Array<{ row: number; error: string | undefined }>>([]);
  const launchingRowsNow = chatLaunching ? proposalRows(chat.find(x => x.qid === chatLaunching)) : [];
  const launchSettled = launchedFrom.current.every(({ row, error }) => !launchingRowsNow[row] || launchingRowsNow[row]!.launchedId || launchingRowsNow[row]!.error !== error);
  useEffect(() => {
    if (chatLaunching && (launchingRowsNow.length === 0 || launchSettled)) setChatLaunching(null);
  }, [chatLaunching, launchSettled, launchingRowsNow.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (chatLaunching && lastError && !lastError.id && launchedFrom.current.some(({ row }) => lastError.message === launchingRowsNow[row]?.error)) setChatLaunching(null); }, [lastError?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (status === 'unreachable' && chatLaunching) setChatLaunching(null); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (chatLaunching && client.fleet && !client.fleet.turnMachine(chatLaunching)?.ready) setChatLaunching(null); }, [machines, chatLaunching, client]);
  // A chat card's close: the turn's qid while the daemon closes the open rows. Its marks (closedAt, error) come back with chat.history, a refusal as an
  // id-less `session.close` error; `session.closed` opens no tab. Freed like a launch: every sent row marked (closed, or failed anew), a refusal, or no daemon.
  const [chatClosing, setChatClosing] = useState<string | null>(null);
  const closedFrom = useRef<Array<{ row: number; error: string | undefined }>>([]);
  const closeSessions = (qid: string, asked?: number[]) => {
    if (client.fleet && !client.fleet.turnMachine(qid)?.ready) return;
    if (launching || chatLaunching || chatClosing || relaying || status === 'unreachable') return;
    const all = chat.find(x => x.qid === qid)?.closes ?? [];
    // Always explicit rows: the open ones, those the card has not closed and whose session has not ended on its own.
    const rows = (asked ?? all.map((_, i) => i)).filter(r => all[r] && !all[r]!.closedAt && byId.get(all[r]!.id)?.state !== 'exited');
    if (rows.length === 0) return;
    closedFrom.current = rows.map(r => ({ row: r, error: all[r]!.error })); setChatClosing(qid);
    send({ type: 'session.close', qid, rows });
  };
  const closingRowsNow = chatClosing ? chat.find(x => x.qid === chatClosing)?.closes ?? [] : [];
  const closeSettled = closedFrom.current.every(({ row, error }) => !closingRowsNow[row] || closingRowsNow[row]!.closedAt || closingRowsNow[row]!.error !== error);
  useEffect(() => {
    if (chatClosing && (closingRowsNow.length === 0 || closeSettled)) setChatClosing(null);
  }, [chatClosing, closeSettled, closingRowsNow.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (chatClosing && lastError && !lastError.id && lastError.request === 'session.close') setChatClosing(null); }, [lastError?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (status === 'unreachable' && chatClosing) setChatClosing(null); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (chatClosing && client.fleet && !client.fleet.turnMachine(chatClosing)?.ready) setChatClosing(null); }, [machines, chatClosing, client]);
  const sayCandidates: SayCandidate[] = [];
  if (ledgeUnread) sayCandidates.push({ id: LEDGE_ID, kind: 'ledge', seed: ledgeSaySeed });
  for (const s of sessions) {
    const live = sayKindOf(s);
    if (live) sayCandidates.push({ id: s.id, kind: live, seed: `${s.id}:${live}:${s.pending?.text ?? s.state}` });
    else if (finishedUnread[s.id]) sayCandidates.push({ id: s.id, kind: 'finished', seed: finishedUnread[s.id]! });
  }
  const speaker = pickSpeaker(sayCandidates);
  const sayText = speaker ? pickSay(t.say[speaker.kind], speaker.seed) : '';
  // A balloon speaks for 5 s once it is actually seen on the handle, then fades; a new situation (new ask, new finish)
  // speaks again. Leaving the handle before the 5 s are up restarts them on return. The unread state stays either way.
  const speakerKey = speaker ? `${speaker.id}|${speaker.seed}` : null;
  const sayOnHandle = shows.say && st.mode === 'handle' && speakerKey !== null;
  const [sayExpired, setSayExpired] = useState<string | null>(null);
  useEffect(() => {
    if (!sayOnHandle || speakerKey === sayExpired) return;
    const timer = setTimeout(() => setSayExpired(speakerKey), SAY_LINGER_MS);
    return () => clearTimeout(timer);
  }, [sayOnHandle, speakerKey, sayExpired]);
  const sayShown = sayOnHandle && speakerKey !== sayExpired;
  // The strip shows under a covering window once the island has been folded and left alone for 500 ms; a say
  // still hanging under its speaker keeps the island compact, the strip has no companion to hang it from.
  const strip = useDelayed(discreet && covered && st.mode === 'handle' && !st.hot && !st.hovering && bandPointer === null && !sayShown, STRIP_BACK_MS);
  // The resting filet wakes into the compact island and its robots while the pointer is over it or near it, or the keyboard is in it.
  const awake = st.mode === 'handle' && !strip && (st.hovering || st.hot || st.focusWithin || bandPointer !== null);
  const geo = scaledLayout({ bots: sessions.map(s => ({ id: s.id, pending: isPending(s), machine: s.machineId })), line: handleSizes.line, trailing: handleSizes.trailing, mode: st.mode, screenH, screenW, position: islandPosition, strip, awake, pip: !!updatePip, dnd, readerExpanded: st.documentExpanded, bubbleH: st.mode === 'peek' ? (peekH ? peekH + SURFACE_CHROME_Y : undefined) : bubbleH ? bubbleH + SURFACE_CHROME_Y : undefined, sessionH, helperH, detailH: st.mode === 'chat' ? chatBody : detailBody ? DETAIL_HEADER_H + detailBody + SURFACE_CHROME_Y : undefined, askH: ASK_H, reading: st.reading, groups: groups.length, listExtraH: (focused && isYesNo(focused) ? EXPANDED_ROW_H - SIZES.rowH : 0) + noticeExtraH + (disconnected.length ? 28 : 0) }, { handle: hs, panel: ps });
  geoRef.current = geo;
  // The shell watches the top band over the island's span (its depth and overhang are the shell's own constants).
  const hot = visible ? { left: Math.round(geo.handle.left), w: Math.round(geo.handle.w) } : HIDDEN_HOT;
  useEffect(() => { setHotZone(hot.left, hot.w); }, [hot.left, hot.w]);

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
  const detail = st.mode === 'session' || st.mode === 'helper' || st.mode === 'settings' || st.mode === 'help' || st.mode === 'launch' || st.mode === 'chat' || st.mode === 'reader';
  const openDocument = (ref: DocumentReference, origin: DocumentOrigin) => { documentSourceFocus.current = document.activeElement as HTMLElement; reader.open(ref, origin); dispatch({ type: 'documentOpen', origin }); };
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
  const turnReady = (qid: string) => !client.fleet || !!client.fleet.turnMachine(qid)?.ready;
  const onMessage = useCallback((fn: Parameters<DaemonClient['onMessage']>[0]) => client.onMessage(fn), [client]);
  const actionCards = useActionCards({ send, chat, errors, turnReady, onMessage });
  // The thread is not in the snapshot: ask for it when a session opens (or after a reconnection emptied the threads).
  const threadWanted = st.mode === 'session' || st.mode === 'helper' ? st.selectedId : null;
  // A boolean, not the Map: the store rebuilds `threads` on every update, which would re-send the request while the reply is pending.
  const threadLoaded = threadWanted != null && threads.has(threadWanted);
  useEffect(() => {
    if (threadWanted && !threadLoaded && status === 'open') send({ type: 'session.thread', id: threadWanted });
  }, [threadWanted, threadLoaded, status]);
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
  const extras: Box[] = [];
  // The status line hangs centred under the island (its scale); the unread say hangs under its speaker, the coachmark under the panel, both at the windows' size.
  const statusW = sizes.status.w || STATUS_BOX.w * hs, statusH = sizes.status.h || STATUS_BOX.h * hs;
  const statusLeft = geo.left + geo.w / 2 - statusW / 2, statusTop = geo.h + 6 * hs;
  // Every balloon hangs under Ledge: the notch has no bot row to hang a session's from.
  const speakerX = geo.left + (FILET.pad + FILET.ledge / 2) * hs;
  const sayLeft = speakerX - SAY_TAIL_X * ps, sayTop = geo.h + 4 * ps;
  if (sayShown) extras.push({ left: sayLeft, top: sayTop, w: sizes.say.w || UNREAD_SAY_BOX.w * ps, h: sizes.say.h || UNREAD_SAY_BOX.h * ps });
  if (unreachable) extras.push({ left: statusLeft, top: statusTop, w: statusW, h: statusH });
  if (coachShown) extras.push({ left: coachLeft, top: coachTop, w: 300 * ps, h: COACHMARK_H * ps });
  // The fillets either side of the surface, where it leaves the top edge.
  // Each fillet's box keeps the largest fillet's width (Shoulders), whatever the notch; the window holds the fillet drawn.
  const sr = shoulderR(geo.w, st.mode === 'handle' && !awake);
  if (sr > 0) extras.push({ left: geo.left - SHOULDER_R, top: 0, w: geo.w + 2 * SHOULDER_R, h: sr });
  const frame = frameOf(geo, extras, { w: screenW, h: screenH });
  useNativeFrame(visible ? frame : HIDDEN_FRAME, parseFloat(ms(SETTLE_MS)));
  useEffect(() => { setOutsideWatch(panel && visible); }, [panel, visible]);
  // « Voir l'onglet du terminal »: Ledge shows the session with its terminal pane, read-only and offline ones too; only session.focus needs the daemon.
  const focusTab = (id: string) => { const s = byId.get(id); if (!s) return; if (!unreachable) send({ type: 'session.focus', id }); openInLedge({ kind: 'terminal', id }); };
  const chooseOption = (n: number) => {
    if (blockedFor(selected) !== null) return;
    const radios = surfaceRef.current?.querySelectorAll<HTMLInputElement>('[data-layer="session"] [data-ask] input[type="radio"]:not([data-other])');
    const r = radios?.[n - 1]; if (!r) return;
    r.click(); r.focus();
  };
  const openRow = (id: string) => dispatch({ type: 'rowClick', id });
  /** Writes to Ledge (`ledge.say`, lot 4): the message and Ledge's answer come back in its thread, which the open notch shows. */
  const ask = (text: string) => {
    sayToLedge(client, text);
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
    onToggleDnd, onHelp: () => dispatch({ type: st.mode === 'help' ? 'back' : 'help' }), onTerminal: focusTab, onChooseOption: chooseOption,
    onToggleReading: () => dispatch({ type: 'reading', on: !st.reading })
  });
  const motion = growing ? MOTION.grow : MOTION.shrink;
  const delay = growing ? 0 : MOTION.shrink.delayMs;
  // The entering view follows the shape once it has nearly settled: later on a shrink (back from a session) than on a grow.
  const enter = enterDelay(growing);

  const radius = st.mode === 'handle' ? (awake ? 19 : 5) : 22;
  const surfaceTransition = ['left', 'width', 'height', 'border-radius'].map(p => `${p} ${ms(motion.ms)} ${motion.ease} ${ms(delay)}`).join(', ') + `, opacity ${ms(150)} ease-out`;
  const content = (
    <>
      <div ref={surfaceRef} data-surface data-mode={st.mode} data-strip={strip || undefined} data-awake={awake || undefined}
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
          <Handle updatePip={updatePip} updateVersion={updateVersion} onUpdate={() => openInLedge({ kind: 'update' })} sessions={sessions.length} line={line} onMeasure={onHandleMeasure} visible={st.mode === 'handle'} strip={strip} awake={awake} onOpenHome={() => dispatch({ type: ledgeUnread ? 'chat' : 'homeClick' })} left={geo.left} scale={hs} pointer={st.mode === 'handle' ? residentPointer : null} residentSignal={residentSignal} unread={ledgeUnread} shortcut={shortcut} dnd={dnd} theme={theme} frozen={unreachable} reducedMotion={reducedMotion} />
        </div>
        <div data-zoom="panel" style={{ position: 'absolute', left: 0, top: 0, zoom: ps }}>
        <Bubble ref={bubbleRef} kind={st.bubbleKind} elapsedMs={st.bubbleId ? elapsed[st.bubbleId] : undefined} preview={st.bubbleId === LEDGE_ID ? ledgePreview : offlineMachine ? offlineMachine.label : undefined} session={bubbleSession} moreCount={Math.max(0, st.queue.length - 1)} visible={st.mode === 'bubble'} paused={bubblePaused} remainingMs={ctl.bubbleRemaining() ?? undefined}
          quick={quick} ack={bubbleAck} deciding={!!st.bubbleId && asks.inFlight.has(st.bubbleId)} failure={st.bubbleId ? asks.failures[st.bubbleId] : undefined} blocked={bubbleSession ? blockedFor(bubbleSession) : null} frozen={unreachable} reducedMotion={reducedMotion}
          onOpen={() => { if (st.bubbleId === LEDGE_ID) dispatch({ type: 'bubbleClick' }); else if (st.bubbleId?.startsWith('machine:')) openInLedge({ kind: 'machines' }); else if (st.bubbleId) openInLedge({ kind: 'session', id: st.bubbleId }); }}
          onDismiss={() => dispatch({ type: st.bubbleKind === 'ask' ? 'defer' : 'close' })}
          onDecide={d => { if (st.bubbleId && !ctl.state().ack && decide(st.bubbleId, d)) dispatch({ type: 'decidedInBubble' }); }}
          onReply={text => {
            const id = st.bubbleId; if (!id || ctl.state().ack || blockedFor(byId.get(id)) !== null || !asks.begin(id)) return;
            send({ type: 'session.reply', id, text }); sounds.user('accept'); dispatch({ type: 'decidedInBubble' });
          }} theme={theme} />
        {st.mode === 'peek' && peekSession && <PeekCard ref={peekRef} session={peekSession} visible theme={theme} frozen={unreachable} reducedMotion={reducedMotion} onClose={() => dispatch({ type: 'close' })} onOpen={() => openInLedge({ kind: 'session', id: peekSession.id })} />}
        </div>
        <div data-panel style={{ position: 'absolute', inset: 0, zoom: ps, opacity: panel && st.mode !== 'peek' ? 1 : 0, pointerEvents: panel && st.mode !== 'peek' ? 'auto' : 'none', transition: transition([['opacity', panel && st.mode !== 'peek' ? 'fadeIn' : 'fadeOut', panel && st.mode !== 'peek' ? 120 : 0]]) }}>
          <div aria-hidden={st.mode !== 'list' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'list' ? 'auto' : 'none', transform: `translateX(${detail ? -12 : 0}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            <SessionList shortcut={shortcut} sessions={sessions} visible={st.mode === 'list'} enterDelay={enter} selectedId={st.selectedId} focusedId={st.mode === 'list' ? focused?.id ?? null : null} dnd={dnd} onToggleDnd={onToggleDnd} onOpen={openRow} onDecide={decide} canDecide={canDecide}
              disconnected={disconnected}
              onDismiss={id => { if (!unreachable) send({ type: 'session.dismiss', id }); }} offline={unreachable}
              onClose={() => dispatch({ type: 'close' })} onSettings={() => dispatch({ type: 'settings' })} onHelp={() => dispatch({ type: 'help' })} onLaunch={() => dispatch({ type: 'launch' })} notice={notice} noticeRef={noticeRef}
              theme={theme} frozen={unreachable} reducedMotion={reducedMotion}
              onAsk={ask} onOpenChat={() => dispatch({ type: 'chat' })} onTyping={on => dispatch({ type: 'typing', on })} askDisabled={chatOffline !== null} />
          </div>
          <div aria-hidden={st.mode !== 'chat' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'chat' ? 'auto' : 'none', transform: `translateX(${st.mode === 'chat' ? 0 : 12}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            <LedgeFeed client={client} contentRef={chatRef} sessions={sessions} visible={st.mode === 'chat'} enterDelay={enter} offline={chatOffline}
              headerExtra={<IslandMenu open={menuOpen && st.mode === 'chat'} dnd={dnd} onToggle={() => setMenuOpen(o => !o)} onClose={() => setMenuOpen(false)} onSettings={() => { setMenuOpen(false); openInLedge({ kind: 'settings' }); }} onDnd={onToggleDnd} onQuit={() => { setMenuOpen(false); void quitApp(); }} />}
              onSettings={() => openInLedge({ kind: 'settings' })} onClose={() => { setMenuOpen(false); dispatch({ type: 'close' }); }} onOpenSession={id => openInLedge({ kind: 'session', id })}
              onDocument={ref => openInLedge({ kind: 'document', path: ref.path })} theme={theme} frozen={unreachable} reducedMotion={reducedMotion}
              cards={{ sessions, offline: chatOffline, turnAvailable: turnReady, onOpenSession: id => openInLedge({ kind: 'session', id }), onTerminal: id => openInLedge({ kind: 'terminal', id }),
                launchingQid: chatLaunching, launchingRows: chatLaunching ? launchedFrom.current.map(x => x.row) : null, onLaunchProposal: launchProposal,
                closingQid: chatClosing, closingRows: chatClosing ? closedFrom.current.map(x => x.row) : null, onCloseSessions: closeSessions,
                onAct: actionCards.act, actingQid: actionCards.actingQid, actingRows: actionCards.actingRows, onIgnoreCards: actionCards.ignore, onDenyAction: actionCards.deny,
                relayingQid: relaying, onRelay: qid => relayCard('session.relay', qid), onRelayCancel: qid => relayCard('session.relay.cancel', qid),
                theme, reducedMotion }} />
          </div>
          <div aria-hidden={st.mode !== 'launch' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'launch' ? 'auto' : 'none', transform: `translateX(${st.mode === 'launch' ? 0 : 12}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            <LaunchView key={`${launchOpen}-${launchMachine ?? ''}`} contentRef={launchRef} visible={st.mode === 'launch'} enterDelay={enter} recents={recents} sessions={sessions.filter(s => !launchMachine || s.machineId === launchMachine)} offline={unreachable || (chosenMachine && !chosenMachine.ready) ? t.offline : null} busy={!!launching} failure={launchFailure}
              machines={machines} machineId={launchMachine} onMachine={id => { setLaunchFailure(null); client.fleet?.select(id); }}
              listing={lastListing} onFolders={m => send(m)}
              onLaunch={launch} onBack={() => dispatch({ type: 'back' })} onClose={() => dispatch({ type: 'close' })} theme={theme} frozen={unreachable} reducedMotion={reducedMotion} />
          </div>
          <div aria-hidden={st.mode !== 'settings' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'settings' ? 'auto' : 'none', transform: `translateX(${st.mode === 'settings' ? 0 : 12}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            <SettingsView contentRef={settingsRef} visible={st.mode === 'settings'} enterDelay={enter} theme={theme} dnd={dnd} reduced={motionPrefs.app} osReduced={osReduced} finished={prefs.finished} onFinished={prefs.setFinished} sounds={prefs.sounds} onSounds={prefs.setSounds} onTestSound={sounds.test} scales={scales} autoScales={autoScales} onScale={onScale}
              machines={client.fleet ? machines : undefined} onMachines={client.fleet?.configure} onProbe={client.fleet?.probe} onRetry={client.fleet?.retry}
              monitors={monitors} monitor={monitor} onMonitor={onMonitor}
              defaultTool={defaultTool} onDefaultTool={chooseDefaultTool} accent={accent} onAccent={onAccent}
              islandPosition={islandPosition} onIslandPosition={onIslandPosition} discreet={discreet} onDiscreet={onDiscreet}
              onToggleTheme={onToggleTheme} onToggleDnd={onToggleDnd} onReduced={motionPrefs.setReduced} onBack={() => dispatch({ type: 'back' })} onClose={() => dispatch({ type: 'close' })} />
          </div>
          <div aria-hidden={st.mode !== 'help' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'help' ? 'auto' : 'none', transform: `translateX(${st.mode === 'help' ? 0 : 12}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            <HelpView shortcut={shortcut} contentRef={helpRef} visible={st.mode === 'help'} enterDelay={enter} onBack={() => dispatch({ type: 'back' })} onClose={() => dispatch({ type: 'close' })} />
          </div>
          <div aria-hidden={st.mode !== 'session' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'session' ? 'auto' : 'none', transform: `translateX(${st.mode === 'session' ? 0 : 12}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            {shown && <SessionView client={client} helpers={shows.helpers} contentRef={sessionContentRef} replyRef={sessionReplyRef} session={shown} preview={shownPreview} visible={st.mode === 'session'} enterDelay={enter} reading={st.reading} draft={drafts[shown.id] ?? ''} thread={threads.get(shown.id)} onOpenHelper={id => dispatch({ type: 'openHelper', id })}
              blocked={blockedFor(shown)} deciding={asks.inFlight.has(shown.id)} failure={asks.failures[shown.id]} frozen={unreachable} reducedMotion={reducedMotion}
              onDraft={t => { setDrafts(x => ({ ...x, [shown.id]: t })); dispatch({ type: 'typing', on: t.length > 0 }); }}
              onBack={() => dispatch({ type: 'back' })} onClose={() => dispatch({ type: 'close' })} onDecide={d => decide(shown.id, d)} onReply={t => reply(shown.id, t)}
              onInterrupt={() => send({ type: 'session.interrupt', id: shown.id })} onKill={() => send({ type: 'session.kill', id: shown.id })}
              onDismiss={() => { if (!unreachable) send({ type: 'session.dismiss', id: shown.id }); }} dismissOff={unreachable}
              onFocus={() => focusTab(shown.id)} onToggleReading={() => dispatch({ type: 'reading', on: !st.reading })} onRename={shown.state !== 'exited' ? topic => send({ type: 'session.rename', id: shown.id, topic }) : undefined} onDocument={ref => openDocument(ref, { kind: 'session', sessionId: shown.id })} theme={theme} />}
          </div>
          {shown && st.helperId && <HelperView contentRef={helperRef} session={shown} helperId={st.helperId} items={threads.get(shown.id) ?? []} visible={st.mode === 'helper'} enterDelay={enter} theme={theme} paused={st.mode !== 'helper'} frozen={unreachable} reducedMotion={reducedMotion}
            onBack={() => dispatch({ type: 'back' })} onClose={() => dispatch({ type: 'close' })} />}
          {st.mode === 'reader' && activeReading && documentState && <DocumentView state={documentState} reading={activeReading} onReading={reader.setReading} originName={st.documentOrigin?.kind === 'session' ? byId.get(st.documentOrigin.sessionId)?.name ?? st.documentOrigin.sessionId : 'Ledge'} theme={theme} expanded={st.documentExpanded} onBack={readerBack} onClose={readerClose} onExpand={() => dispatch({ type: 'documentExpanded', on: !st.documentExpanded })} onReload={reader.reload} onDocument={reader.follow} />}
        </div>
      </div>

      {/* Drawn after the surface: each overlaps its edge by a pixel, so no seam shows where they meet. */}
      <Shoulders left={geo.left} w={geo.w} strip={st.mode === 'handle' && !awake} opacity={unreachable ? 0.6 : 1} transition={surfaceTransition} pathTransition={`d ${ms(motion.ms)} ${motion.ease} ${ms(delay)}`} />

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
        {unreachable && <div ref={statusRef} role="status" style={{ position: 'absolute', left: statusLeft / hs, top: statusTop / hs, fontSize: 12, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>{daemonOutdated ? t.daemonOutdated : t.unreachable}</div>}
      </div>
      <div aria-live="polite" role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{handoff}</div>
    </>
  );
  // Under Tauri the window covers the work area, so the page draws in work-area coordinates, like the browser preview.
  // Hidden from Desktop: nothing at all.
  return visible ? content : null;
}

/** The gear in the chat header: settings go to Desktop, Do not disturb stays here, Quit closes the island. */
function IslandMenu({ open, dnd, onToggle, onClose, onSettings, onDnd, onQuit }: {
  open: boolean; dnd: boolean; onToggle: () => void; onClose: () => void; onSettings: () => void; onDnd: () => void; onQuit: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) ref.current?.querySelector('button')?.focus(); }, [open]);
  return (
    <span style={{ position: 'relative' }}>
      <button type="button" aria-label={t.menu.gear} aria-haspopup="true" aria-expanded={open} onClick={onToggle}
        style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, padding: 0, border: 0, borderRadius: 8, background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
        <Icon size={16} {...ICONS.gear} />
      </button>
      {open && <div ref={ref} role="group" aria-label={t.menu.label} style={{ position: 'absolute', top: 36, right: 0, zIndex: 3, width: 280, padding: 6, borderRadius: 10, background: 'var(--popover, var(--card))', border: '1px solid var(--sidebar-border)', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <button type="button" onClick={onSettings} style={{ display: 'flex', gap: 8, textAlign: 'left', padding: 8, border: 0, borderRadius: 8, background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
          <span><strong>{t.menu.settings}</strong><small style={{ display: 'block', color: 'var(--muted-foreground)' }}>{t.menu.settingsHint}</small></span>
        </button>
        <button type="button" role="switch" aria-checked={dnd} onClick={onDnd} style={{ display: 'flex', gap: 8, textAlign: 'left', padding: 8, border: 0, borderRadius: 8, background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
          <span><strong>{t.menu.dnd}</strong><small style={{ display: 'block', color: 'var(--muted-foreground)' }}>{t.menu.dndHint}</small></span>
        </button>
        <button type="button" onClick={onQuit} style={{ display: 'flex', gap: 8, textAlign: 'left', padding: 8, border: 0, borderRadius: 8, background: 'transparent', color: 'inherit', cursor: 'pointer' }}>{t.menu.quit}</button>
        <button type="button" onClick={onClose} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}> </button>
      </div>}
    </span>
  );
}
