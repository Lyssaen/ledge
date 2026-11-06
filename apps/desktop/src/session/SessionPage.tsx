import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent, type MutableRefObject } from 'react';
import { useContextNear, type DaemonClient } from '@ledge/fleet';
import { SessionMeta } from '../usage/SessionMeta';
import { isArchived, isOmpSeat, type Helper, type Session, type ThreadItem, taskClosed, latestTodos } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { Decisions } from '../fleet/decisions';
import { whenOf, type Wait } from '../list/time';
import { repoOf } from '../list/model';
import { machineOf } from '../nav/agents';
import type { NavAction, NavState } from '../nav/state';
import { useScreenKeys, type ScreenKeyHandler } from '../nav/screenKeys';
import { useTabPlace } from '../workspace/tabPlace';
import { sortOf } from './PendingCard';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { findFile, type ChangedFile } from './changedFiles';
import { focusThread } from '../nav/useKeys';
import { TermStoreContext } from '../term/useTerms';
import { AgentView, useAgent } from './AgentView';
import { focusAgentView } from './agentFocus';
import { openSessionTerminal } from './terminal';
import { Button } from '@ledge/ui/ui/Button';
import { memoKey, type SessionMemory } from './memory';
import { aboutLine } from './RigItems';
import { clampSplit, type SessionView } from './prefs';
import { ArchivedBanner } from '../manage/ArchivedBanner';
import type { SessionActions } from '../manage/useSessionActions';
import { Reply } from './Reply';
import type { CaptureFocus } from './BrowserTab';
import { capturesOf } from './captures';
import { isLocal, kindOf, pillOf, useBrowser } from './browserLive';
import { SidePane, tabId, type PanePlan, type PaneTab } from './SidePane';
import { Tags, Thread } from './Thread';
import { marksOf } from './markers';
import { TodoBar } from './TodoBar';
import type { TasksApi } from '../tasks/useTasksApi';
import { useConversations } from './useConversations';
import { atEnd, displayIds, exchanges, helperOf, pendingPlan, unreadFrom, type PlanDoc, type Segment } from './exchanges';

export interface SessionPageProps {
  /** Ledge's tasks (atelier rooms spec §3.5): the task pinned above the reply. */
  tasksApi?: TasksApi;
  /** The parent on a subagent's page. */
  session: Session;
  helper: Helper | null;
  /** useThread, called by Workspace. */
  items: ThreadItem[] | undefined;
  nav: NavState; dispatch(a: NavAction): void;
  decisions: Decisions; waits: ReadonlyMap<string, Wait>;
  /** An archived session's banner: Reprendre, Remettre à la table, Supprimer…. */
  actions: SessionActions;
  memory: SessionMemory; notify(text: string): void;
  /** « N sous-agents »: show this agent's subagents in the sidebar tree. */
  onShowKids(): void;
  /** O: show or hide the right panel (Modifications and shells). */
  onPanel(): void;
  /** The left view, the thread or the agent's screen (Fil | Terminal v3): the same for every session (desktop.session). */
  view: SessionView; onView(v: SessionView): void;
  /** The files the shown agent changed (Workspace, which shows them in the panel). */
  files: readonly ChangedFile[];
  /** The panel's « ± Modifications » tab: shown (J / K walk it), its narrow list open (Escape closes it first). */
  changes: { shown: boolean; listOpen: boolean; closeList(): void; step(d: 1 | -1): void };
  /** « Toutes les modifications » on the side pane's change: the panel's Modifications, on that file. */
  onAllChanges(path: string): void;
  /** What the panel asks of the page: « Edit · tour 2 » lights the action in the thread. */
  api: MutableRefObject<PageApi | null>;
  /** OMP's « Ouvrir un shell », from the Terminal view: a shell in the right panel. */
  onOpenShell(): void;
  /** The side pane's share of the page (desktop.session, written by the Workspace's owner). */
  split: number; onSplit(v: number): void;
  /** The documents beside the thread are read through it. */
  client: DaemonClient;
  /** In an IDE tab (R4): no Fil | Terminal switch nor meta in the heading (the tab says them), no right panel (O is not taken). */
  ide?: boolean;
}

/** After the last scroll, the reading position is written down this late (and when the page closes). */
const SETTLE_MS = 250;
/** The « Nouveau » marker opens this far below the top of the thread. */
const MARKER_OFFSET = 120;
/** An action reached from the Modifications tab stays lit this long (session.css: session-flash). */
const FLASH_MS = 1800;

export interface PageApi { showInThread(toolId: string): void }

const VIEWS: ReadonlyArray<{ view: SessionView; icon: readonly string[] }> = [{ view: 'thread', icon: SHELL_ICONS.thread }, { view: 'terminal', icon: SHELL_ICONS.terminal }];

/** A session's page, or one of its subagents' (session.tsx SessionPage): the heading and its Fil | Terminal switch, then the
 *  flat thread, the pinned request and the reply, beside the thread the side pane's documents and changes, and on top of it
 *  the agent's work plan; or, on Terminal, the agent's own screen alone. Mounted again for each agent (Workspace's key), so
 *  what belongs to a page (unfolded actions, the pane's tabs, the work plan unfolded) starts over; the view does not. */
export function SessionPage(p: SessionPageProps): JSX.Element {
  const { session, helper, items, memory } = p;
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const offline = session.offline === true;
  const archived = isArchived(session);
  // An OMP seat of OpenRig (docs/mockups/ledge-openrig-omp.html, mapped onto « Fil | Terminal » by design-ux on 2026-11-03):
  // no thread nor reply, « Fil » says why and its Terminal view shows its screen; stopped, « Fil » says its terminal is gone and
  // points at its rig, « Terminal » disabled.
  const seat = isOmpSeat(session) ? (archived || session.state === 'exited' ? 'stopped' : 'live') : null;
  const key = memoKey(session.id, helper?.id);
  // What the last visit left, read once.
  const [memo] = useState(() => memory.get(key));
  const xs = useMemo(() => (items ? exchanges(items, helper?.id) : []), [items, helper?.id]);
  const ids = useMemo(() => displayIds(xs), [xs]);
  // « Nouveau depuis votre dernière visite » : decided when the thread is first there, then frozen for the life of the page.
  const unread = useRef<string | null | undefined>(undefined);
  if (unread.current === undefined && items !== undefined) unread.current = unreadFrom(ids, memo.seen);

  // The clock: every second while an action runs or the agent works (online: the waiting line counts), every 30 s otherwise
  // (« il y a » keeps up). The spinner turns on its own (Spinner), so neither tick renders more than the times.
  const running = !offline && ((helper ?? session).state === 'working'
    || xs.some(x => x.segments.some(s => s.kind === 'tools' && s.tools.some(tool => tool.status === 'running'))));
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), running ? 1000 : 30_000);
    return () => clearInterval(clock);
  }, [running]);
  // A frozen thread's times stand still: offline, the actions count up to the last instant shown before the machine fell.
  const [frozenAt, setFrozenAt] = useState<number | null>(offline ? now : null);
  if (offline && frozenAt === null) setFrozenAt(now);
  else if (!offline && frozenAt !== null) setFrozenAt(null);
  const times = offline ? frozenAt ?? now : now;

  /* Fil | Terminal. The thread stays mounted under the Terminal view (hidden), its folds and its place as the reader left them. */
  const { view, onView, files } = p;
  const store = useContext(TermStoreContext);
  const agent = useAgent(session, helper);
  // A new object each time: the same row lit again (« dans le fil » twice) comes into view again.
  const [flash, setFlash] = useState<{ id: string } | null>(null);
  // Back on the thread: where the reader left it, or (from « tour 2 ») the action, which the flash brings into view.
  const returning = useRef<'restore' | 'aim' | null>(null);
  // In an IDE tab, the page stays mounted while hidden (dockview detaches its DOM, which loses its scroll): shown again,
  // the thread comes back where it was left (R6). Outside the IDE, always shown.
  const tabPlace = useTabPlace();
  const visible = tabPlace?.visible ?? true;
  const wasVisible = useRef(visible);
  if (visible && !wasVisible.current && returning.current === null) returning.current = 'restore';
  wasVisible.current = visible;
  const viewNow = useRef(view);
  viewNow.current = view;
  const seatNow = useRef(seat !== null);
  seatNow.current = seat !== null;
  // A view changed from here: the thread comes back where it was left. `focus`: the keyboard follows (a click; the arrows
  // keep it on the switch): into the agent's screen, or back to the thread.
  const switchView = (v: SessionView, focus: boolean) => {
    if (v === view) return;
    if (v === 'thread') returning.current = 'restore';
    onView(v);
    if (focus) requestAnimationFrame(() => (v === 'terminal' ? focusAgentView(store, session.id) : focusThread()));
  };
  const showInThread = useCallback((toolId: string) => {
    returning.current = 'aim';
    // Aimed at an action, the reader no longer follows the end: the thread growing around it must not take the view away.
    follow.current = false;
    setFlash({ id: toolId });
    onView('thread');
  }, [onView]);
  p.api.current = { showInThread };

  /* The work plan: the shown thread's latest list (a subagent's own), folded until the reader unfolds it. */
  const todos = useMemo(() => (items ? latestTodos(items, helper?.id) : null), [items, helper?.id]);
  const [todoOpen, setTodoOpen] = useState(false);
  // The bar gone (an emptied list), a list that comes back later shows folded.
  if (todos === null && todoOpen) setTodoOpen(false);
  const toggleTodos = useCallback(() => setTodoOpen(o => !o), []);
  const todoShown = todoOpen && todos !== null && view === 'thread';

  /* The side pane: a tab per document or change opened from the thread. */
  const [tabs, setTabs] = useState<readonly PaneTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  // Stable: the thread is memoised on what opens a tab.
  const openTab = useCallback((tab: PaneTab) => {
    const id = tabId(tab);
    setTabs(ts => (ts.some(x => tabId(x) === id) ? ts : [...ts, tab]));
    setActiveTab(id);
    // An OMP seat's browser shows beside its Terminal (docs/mockups/ledge-browser-live.html, view 2): the view stays.
    if (tab.kind === 'browser' && seatNow.current) return;
    if (viewNow.current !== 'thread') { returning.current = 'restore'; onView('thread'); }
  }, [onView]);
  const openDoc = useCallback((path: string) => openTab({ kind: 'doc', path }), [openTab]);
  // Arriving with a file to show (« À toi »'s source, docs/mockups/ledge-human-operator-ab-lot1.html): each arrival opens it once.
  const arrivedDoc = p.nav.place.kind === 'session' ? p.nav.place.doc : undefined;
  useEffect(() => { if (arrivedDoc) openDoc(arrivedDoc); }, [p.nav.place, arrivedDoc, openDoc]);
  const openDiff = useCallback((path: string) => openTab({ kind: 'diff', path }), [openTab]);
  const openPlan = useCallback((key: string) => openTab({ kind: 'plan', key }), [openTab]);
    // « Répondre à Bix » on an OpenRig message (decision 1): Bix's composer, prefixed « À propos de : « … » », a blank line,
  // the cursor under it; what was already typed there stays after it. The user writes as themselves, never as this seat.
  const replyTo = useCallback((peer: Session, about: string) => {
    const k = memoKey(peer.id);
    const was = memory.get(k).draft;
    const prefix = `${t.session.rig.about(aboutLine(about))}\n\n`;
    memory.set(k, { draft: was ? `${prefix}${was}` : prefix });
    p.dispatch({ type: 'open', id: peer.id, focus: 'reply' });
  }, [memory, p.dispatch, t]); // eslint-disable-line react-hooks/exhaustive-deps
const openConversation = useCallback((peer: string) => openTab({ kind: 'conv', peer }), [openTab]);
  /* The « Navigateur » tab: every image the thread's tool rows hold, opened on one (a thumbnail) or on the latest (null: the head's button). */
  const captures = useMemo(() => capturesOf(items ?? []), [items]);
  // The agent's own browser, live or as it last showed (docs/mockups/ledge-browser-live.html).
  const browser = useBrowser(session);
  const [captureFocus, setCaptureFocus] = useState<CaptureFocus>({ key: null });
  const openCapture = useCallback((key: string | null) => { setCaptureFocus({ key }); openTab({ kind: 'browser' }); }, [openTab]);
  const onCapture = useCallback((toolId: string, index: number) => openCapture(`${toolId}:${index}`), [openCapture]);
  const helperName = useCallback((id: string) => helperOf(session, items, id, t.session.subagent)?.kind, [session, items, t]);
  // Its neighbour takes over: the next one, else the one before. A focus in the pane (or already lost) follows: to the tab
  // now active, else the pane, else (the pane closed) the thread; a focus elsewhere stays where it is.
  const refocus = useRef(false);
  const closeTab = (id: string) => {
    const now = document.activeElement;
    refocus.current = now === null || now === document.body || now.closest('.side-pane') !== null;
    const at = tabs.findIndex(x => tabId(x) === id);
    const next = tabs.filter(x => tabId(x) !== id);
    setTabs(next);
    if (activeTab === id) setActiveTab(next.length > 0 ? tabId(next[Math.min(at, next.length - 1)]!) : null);
  };
  const active = tabs.find(x => tabId(x) === activeTab);
  // On Terminal only an OMP seat's browser shows beside its screen; any other tab is the thread's.
  const paneShown = active !== undefined && (view === 'thread' || (seat !== null && active.kind === 'browser'));
  const planOpen = active?.kind === 'plan' ? active.key : null;
  const convOpen = active?.kind === 'conv' ? active.peer : null;
  // The open Conversation tabs, active or not: each one's peer thread is asked and its bubbles merged here (SidePane mounts
  // only the active tab).
  const convKeys = useMemo(() => tabs.flatMap(x => (x.kind === 'conv' ? [x.peer] : [])), [tabs]);
  const convs = useConversations(p.client, session, items, convKeys, paneShown ? convOpen : null);

  /* Plans: a card per ExitPlanMode action in the thread, and the pinned request's own ('pending': Codex and Cursor have no
     such action). The pinned plan is read from the card whose action waits, else from the request. */
  const askerId = session.pending?.helperId;
  const asker = askerId === undefined ? session.name : helperOf(session, items, askerId, t.session.subagent)?.kind ?? session.name;
  // As Reply shows it: none offline; on a subagent's page, only its own.
  const shown = offline ? undefined : session.pending;
  const request = shown?.kind === 'plan' && (helper ? shown.helperId === helper.id : true) ? shown : undefined;
  const canAnswer = request !== undefined && session.source !== 'hook_only' && !helper;
  const requestPlan = useMemo(() => (request ? pendingPlan(request) : null), [request]);
  // The waiting card: a proposed card of the thread the request belongs to (main, or the subagent that asks) holding the
  // request's plan — the same text, else the same title; none: the request's own tab ('pending').
  const requestFrom = request?.helperId;
  const requestKey = useMemo(() => {
    if (!requestPlan || requestFrom !== helper?.id) return 'pending';
    let byText: string | undefined, byTitle: string | undefined;
    for (const x of xs) for (const s of x.segments) {
      if (s.kind !== 'plan' || s.plan.status !== 'proposed') continue;
      if (s.plan.markdown === requestPlan.markdown) byText = s.plan.key;
      else if (s.plan.title === requestPlan.title) byTitle = s.plan.key;
    }
    return byText ?? byTitle ?? 'pending';
  }, [xs, requestPlan, requestFrom, helper?.id]);
  // Online, a card still proposed that the request does not hold (a deny with a note before the next plan, a plan the
  // request has moved past) waits for nothing the page can answer: « Proposé », never approved nor revised from this alone.
  // Offline, the thread stays frozen as lot 6a left it. The other exchanges keep their identity (Turn is memoised).
  const shownXs = useMemo(() => {
    if (offline) return xs;
    const stale = (s: Segment) => s.kind === 'plan' && s.plan.status === 'proposed' && s.plan.key !== requestKey;
    if (!xs.some(x => x.segments.some(stale))) return xs;
    return xs.map(x => (x.segments.some(stale)
      ? { ...x, segments: x.segments.map(s => (s.kind === 'plan' && stale(s) ? { ...s, plan: { ...s.plan, status: 'open' as const } } : s)) }
      : x));
  }, [xs, offline, requestKey]);
  // The Story / Objectif the shown thread's markers leave, in the heading; the pinned request, as the thread's last row says it.
  const tags = useMemo(() => marksOf(shownXs).latest, [shownXs]);
  const waitKind = shown && (!helper || shown.helperId === helper.id) ? shown.kind : null;
  const waiting = useMemo(() => (waitKind ? { kind: waitKind, asker } : null), [waitKind, asker]);
  // Once answered, the request's plan stays readable in its tab, its fate untold.
  const [lastRequest, setLastRequest] = useState<{ plan: PlanDoc; by: string } | null>(null);
  if (requestPlan && (lastRequest?.plan.markdown !== requestPlan.markdown || lastRequest.by !== asker)) setLastRequest({ plan: requestPlan, by: asker });
  const author = helper?.kind ?? session.name;
  const plans = useMemo(() => {
    const m = new Map<string, PanePlan>();
    for (const x of shownXs) for (const s of x.segments) {
      if (s.kind === 'plan') m.set(s.plan.key, { plan: s.plan, by: author, known: true, answer: canAnswer && s.plan.key === requestKey });
    }
    // The request's own tab is the request, whether or not its card has come since.
    if (requestPlan) m.set('pending', { plan: requestPlan, by: asker, known: true, answer: canAnswer });
    else if (lastRequest) m.set('pending', { ...lastRequest, known: false, answer: false });
    return m;
  }, [shownXs, author, asker, canAnswer, requestKey, requestPlan, lastRequest]);
  const readPlan = useCallback(() => openPlan(requestKey), [openPlan, requestKey]);
  // J / K on a change: the tab moves to the next or previous changed file, in place (onto that file's tab if it has one).
  const stepPane = (d: 1 | -1) => {
    if (active?.kind !== 'diff' || files.length === 0) return;
    const found = findFile(files, active.path, session.cwd);
    const at = found ? files.indexOf(found) : -1;
    const next: PaneTab = { kind: 'diff', path: files[at < 0 ? (d === 1 ? 0 : files.length - 1) : (at + d + files.length) % files.length]!.path };
    setTabs(ts => {
      const moved = ts.map(x => (tabId(x) === activeTab ? next : x));
      return moved.filter((x, i) => moved.findIndex(y => tabId(y) === tabId(x)) === i);
    });
    setActiveTab(tabId(next));
  };
  // Compared with the split as last written (a drag's moves come between renders).
  const splitNow = useRef(p.split);
  splitNow.current = p.split;
  const onSplit = (v: number) => {
    const x = clampSplit(v);
    if (x !== null && x !== splitNow.current) { splitNow.current = x; p.onSplit(x); }
  };
  // Narrow, the pane lies over the thread and stops above the reply (session.css: --reply-h).
  const main = useRef<HTMLDivElement>(null);
  const [replyH, setReplyH] = useState(0);
  useLayoutEffect(() => {
    const el = main.current?.querySelector<HTMLElement>('.session-reply');
    if (!el) return;
    const ro = new ResizeObserver(() => setReplyH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const pane = main.current?.parentElement?.querySelector<HTMLElement>('.side-pane');
    const to = pane?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? pane ?? main.current?.querySelector<HTMLElement>('.session-body');
    to?.focus({ preventScroll: true });
  }, [tabs, activeTab]);

  /* Scrolling: open on the marker, else where the reader left, else at the end; then follow the end only while the reader is there. */
  const scroller = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const follow = useRef(true);
  const pos = useRef<number | null>(memo.scroll);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [atBottom, setAtBottom] = useState(true);
  const loaded = items !== undefined;
  // Hidden under the Changes view, the thread is left where it is; back on it, the reader finds it there again.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !loaded || view !== 'thread' || !visible) return;
    const back = returning.current;
    returning.current = null;
    if (!opened.current) {
      opened.current = true;
      const mark = el.querySelector<HTMLElement>('.unread-marker');
      if (mark) el.scrollTop = Math.max(0, el.scrollTop + mark.getBoundingClientRect().top - el.getBoundingClientRect().top - MARKER_OFFSET);
      else if (memo.scroll !== null) el.scrollTop = memo.scroll;
      else el.scrollTop = el.scrollHeight;
    } else if (back === 'aim') return;
    else if (follow.current) el.scrollTop = el.scrollHeight;
    else if (back === 'restore' && pos.current !== null) el.scrollTop = pos.current;
    follow.current = atEnd(el);
    pos.current = follow.current ? null : el.scrollTop;
    setAtBottom(follow.current);
  }, [items, loaded, memo.scroll, view, visible]);
  // The column or what is in it changed size without a scroll (a new item, the pinned card, the pane narrowing the column):
  // a reader at the end keeps the end in view (lot 6a's rule); higher up, the view never moves and the end, now below it,
  // is said by « Aller au plus récent ».
  const resized = useRef<ResizeObserver | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!opened.current || el.hidden || el.clientHeight === 0) return;
      if (follow.current) el.scrollTop = el.scrollHeight;
      setAtBottom(atEnd(el));
    });
    resized.current = ro;
    ro.observe(el);
    return () => { ro.disconnect(); resized.current = null; };
  }, []);
  // After each render, what the column holds is watched too (observing twice is a no-op).
  useLayoutEffect(() => {
    const el = scroller.current; const ro = resized.current;
    if (el && ro) for (const child of el.children) ro.observe(child);
  });
  // From a file back to the action that changed it: its fold opens (ActionGroup), it comes to the middle and lights up.
  useEffect(() => {
    if (flash === null || view !== 'thread') return;
    const frame = requestAnimationFrame(() => {
      const row = [...(scroller.current?.querySelectorAll<HTMLElement>('[data-tool],[data-message]') ?? [])].find(e => (e.dataset.tool ?? e.dataset.message) === flash.id);
      row?.scrollIntoView?.({ block: 'center' });
    });
    const off = setTimeout(() => setFlash(null), FLASH_MS);
    return () => { cancelAnimationFrame(frame); clearTimeout(off); };
  }, [flash, view]);
  // Opened from « Voir dans le fil de X »: the message paired with the one clicked is brought into view and lit, once the thread is
  // there (a message that is not in it is left alone). The reader no longer follows the end.
  const aimed = useRef(p.nav.place.kind === 'session' ? p.nav.place.item : undefined);
  useEffect(() => {
    const id = aimed.current;
    if (id === undefined || !items?.some(i => i.id === id)) return;
    aimed.current = undefined;
    follow.current = false;
    setFlash({ id });
  }, [items]);
  // From the Conversation tab, « dans le fil » lights the message in place, as above; the narrow pane, lying over the thread,
  // closes its tab first.
  const lightMessage = (id: string, covered: boolean) => {
    if (covered && activeTab !== null) closeTab(activeTab);
    follow.current = false;
    setFlash({ id });
  };
  // « dans le fil » on a capture: its tool row lit, as from the Changes view; the narrow pane closes its tab first.
  const showCapture = (toolId: string, covered: boolean) => {
    if (covered && activeTab !== null) closeTab(activeTab);
    showInThread(toolId);
  };
  const onScroll = () => {
    const el = scroller.current;
    if (!el || view !== 'thread' || !visible) return;
    follow.current = atEnd(el);
    pos.current = follow.current ? null : el.scrollTop;
    setAtBottom(follow.current);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => memory.set(key, { scroll: pos.current }), SETTLE_MS);
  };
  const toLatest = () => {
    const el = scroller.current;
    if (!el) return;
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
  };

  // Leaving the page: the last item shown is seen, the reading position kept (only once the thread was there).
  const leaving = useRef({ last: null as string | null, loaded: false });
  useEffect(() => { leaving.current = { last: ids.at(-1) ?? null, loaded }; }, [ids, loaded]);
  useEffect(() => () => {
    clearTimeout(settle.current);
    const { last, loaded: shown } = leaving.current;
    if (shown) memory.set(key, { scroll: pos.current, ...(last !== null && { seen: last }) });
  }, [memory, key]);

  // The page's keys: Escape closes the narrow file list first, then folds the work plan, then closes the pane's active tab
  // (else navigation goes back); a held Escape closes the one layer its first press did, no more, and never leaves the page
  // (its repeats are taken and do nothing, as Y / N's are); the reply area takes R, Y / N and 1…9; O shows or hides the
  // terminal; J / K walk the changed files, or the pane's change on the thread (never while typing: useKeys; a held key
  // moves one file).
  const replyKeys = useRef<ScreenKeyHandler | null>(null);
  useScreenKeys(e => {
    // Taken (true): a false would hand it to navigation, which goes back.
    if (e.key === 'Escape' && e.repeat) return true;
    if (e.key === 'Escape' && p.changes.listOpen) { p.changes.closeList(); return true; }
    if (e.key === 'Escape' && todoShown) { setTodoOpen(false); return true; }
    if (e.key === 'Escape' && paneShown) { closeTab(activeTab!); return true; }
    if (replyKeys.current?.(e)) return true;
    // In an IDE tab on Terminal, the reply is not there: Y / N still answer a permission the page's own agent waits on.
    if (p.ide && view === 'terminal' && termDecides(e)) return true;
    if (!p.ide && (e.key === 'o' || e.key === 'O')) { p.onPanel(); return true; }
    const k = e.key.toLowerCase();
    if (k !== 'j' && k !== 'k') return false;
    // The panel's Modifications first, else the side pane's change beside the thread.
    const walk = p.changes.shown ? files.length > 0 : paneShown && active.kind === 'diff' && files.length > 0;
    if (!walk) return false;
    if (e.repeat) return false;
    (p.changes.shown ? p.changes.step : stepPane)(k === 'j' ? 1 : -1);
    return true;
  });
  function termDecides(e: globalThis.KeyboardEvent): boolean {
    const k = e.key.toLowerCase();
    if ((k !== 'y' && k !== 'n') || helper || !shown || sortOf(shown) !== 'approval' || session.source === 'hook_only') return false;
    if (!e.repeat) p.decisions.decide(session, k === 'y' ? 'accept' : 'deny');
    return true;
  }
  // ← / → on a tab: the other view, and the focus to its tab.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    // Alt ← / → is the previous / next session (useKeys), not this switch.
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const next: SessionView = view === 'thread' ? 'terminal' : 'thread';
    if (next === 'terminal' && seat === 'stopped') return;
    switchView(next, false);
    document.getElementById(`session-tab-${next}`)?.focus();
  };

  const external = () => { void openSessionTerminal(p.client, session).then(ok => { if (!ok) p.notify(t.session.terminal.openFailed(session.name)); }); };
  const machine = machineOf(session);
  // The session's current task (§3.5): the one it holds, taken first, the latest.
  const held = helper === null ? (p.tasksApi?.tasks ?? []).filter(x => x.owner === session.id && !taskClosed(x)).sort((a, b) => Number(b.state === 'taken') - Number(a.state === 'taken') || b.updatedAt.localeCompare(a.updatedAt))[0] : undefined;
  const since = whenOf(session, undefined, now, t.list.when).text;
  const waitedFor = whenOf(session, p.waits.get(session.id)?.since, now, t.list.when).text;
  const place = p.nav.place;
  const near = useContextNear(p.client);
  const kids = helper === null ? session.helpers ?? [] : [];
  const tb = t.session.browser;
  const pill = pillOf(kindOf(browser, isLocal(session)), captures.length);
  const termChip = view === 'terminal' && agent.mode.kind !== 'native';
  const termExternal = view === 'terminal' && agent.mode.kind !== 'browser' && agent.mode.kind !== 'offline' && agent.mode.kind !== 'native';
  // In an IDE tab the heading holds only what the tab does not say (R5), and is not drawn when that is nothing.
  const heading = !p.ide || termChip || termExternal || !!session.handover || !!session.relieves || !!tags || kids.length > 0 || pill !== null;
  return (
    <section className="conversation session-page" data-session={session.id} data-helper={helper?.id}>
      {heading && <div className="pane-heading">
        {!p.ide && <div className="view-switch" role="tablist" aria-label={t.session.views.label}>
          {VIEWS.map(({ view: v, icon }) => { const gone = v === 'terminal' && seat === 'stopped'; return (
            <button key={v} type="button" role="tab" id={`session-tab-${v}`} aria-selected={view === v} tabIndex={view === v ? 0 : -1}
              {...(gone ? { 'aria-disabled': true, title: t.top.terminalGone } : {})} onClick={() => { if (!gone) switchView(v, true); }} onKeyDown={onTabKey}>
              <Icon d={icon} size={13} />{t.session.views[v]}
              {/* The agent waits for an answer while its screen is shown: the thread, where it is answered, says so. */}
              {v === 'thread' && view === 'terminal' && waitKind && <span className="view-badge">1</span>}
              {v === 'terminal' && <span className={cls('view-dot', agent.dot)} aria-hidden="true" />}
            </button>
          ); })}
        </div>}
        {!p.ide && <SessionMeta session={session} place={[machine, repoOf(session)].filter((x): x is string => !!x)} near={near} />}
        {/* On Terminal, where the agent's screen runs, and « ouvrir dans un terminal externe ». */}
        {termChip && <span className="term-chip mono">{agent.remote ? t.session.terminal.remote(agent.host) : t.session.terminal.local}</span>}
        {termExternal && (
          <Button variant="ghost" size="icon" className="term-icon" onClick={external} aria-label={t.session.terminal.external} title={t.session.terminal.external}><Icon d={ICONS.external.d} size={14} /></Button>
        )}
        {/* Its relief (context handover spec §3.3): under way, done (the relief opens), or the one it relieves. */}
        {session.handover && (session.handover.state === 'done' && session.handover.to
          ? <button type="button" className="kids-pill" onClick={() => p.dispatch({ type: 'open', id: session.handover!.to! })}>{t.handover.relievedBy(session.handover.toName ?? '')}</button>
          : <span className={cls('pane-relief', session.handover.state === 'failed' && 'failed')} role="status">{t.handover.state[session.handover.state]}{session.handover.auto ? ` · ${t.handover.auto}` : ''}{session.handover.reason ? ` : ${session.handover.reason}` : ''}</span>)}
        {session.relieves && <button type="button" className="kids-pill" onClick={() => p.dispatch({ type: 'open', id: session.relieves!.id })}>{t.handover.relieves(session.relieves.name)}</button>}
        {(tags || kids.length > 0 || pill !== null) && <span className="spacer" />}
        {tags && <Tags tags={tags} />}
        {kids.length > 0 && <><button type="button" className="kids-pill" title={t.session.kidsPillTitle} onClick={p.onShowKids}><Icon d={SHELL_ICONS.subagents} size={13} />{t.session.kidsPill(kids.length)}</button></>}
        {pill !== null && (
          <button type="button" className={cls('kids-pill browser-pill', pill !== 'captures' && `browser-pill-${pill}`)} onClick={() => openCapture(null)}
            {...(pill === 'captures' && captures.length > 0 ? { 'aria-label': tb.pill(captures.length), title: tb.pill(captures.length) } : { title: tb.pillTitle(session.name, pill === 'captures' ? null : pill, captures.length) })}>
            {pill === 'live' ? <i className="live-dot" aria-hidden="true" /> : <Icon d={SHELL_ICONS.browser} size={13} />}
            {tb.tab}{pill !== 'captures' && <span className="browser-pill-state">· {tb.pillState[pill]}</span>}
            {captures.length > 0 && <span className="tab-count mono">{captures.length}</span>}
          </button>
        )}
      </div>}
      {archived && <ArchivedBanner session={session} actions={p.actions} now={now} />}
      <div className={cls('session-split', paneShown && 'has-pane')} style={{ '--split': `${p.split * 100}%`, '--reply-h': `${replyH}px` } as CSSProperties}>
        <div className="session-main" ref={main}>
          {/* On the thread, the panel keeps its lot 6a name (« Fil de la session »); on the changes, the tab names it. */}
          <div className="session-body" role="tabpanel" tabIndex={-1} {...(view === 'thread' ? { 'aria-label': th.label } : p.ide ? { 'aria-label': t.session.views.terminal } : { 'aria-labelledby': 'session-tab-terminal' })}>
            <div className="messages session-thread" ref={scroller} data-thread-focus tabIndex={-1} onScroll={onScroll} hidden={view !== 'thread'}>
              {seat !== null ? <SeatNote stopped={seat === 'stopped'} onOpenRig={() => p.dispatch({ type: 'openrig', section: 'rigs', machine: session.machineId ?? 'local' })} /> : <>
              {todos && <TodoBar todos={todos} open={todoOpen} onToggle={toggleTodos} live={!offline} />}
              {offline && (
                <div className="frozen-banner" role="status">
                  <Icon d={SHELL_ICONS.offline} size={15} />
                  <span><strong>{th.lost(machine)}</strong> · {since}. {th.lostBody}</span>
                </div>
              )}
              {items === undefined ? <p className="thread-note muted">{offline ? th.notLoaded : th.loading}</p>
                : xs.length === 0 ? <p className="thread-note muted">{th.empty}</p>
                : <Thread client={p.client} session={session} helper={helper} items={items} xs={shownXs} now={times} unread={unread.current ?? null} since={since} dispatch={p.dispatch}
                    flash={flash?.id ?? null} onChange={openDiff} onCapture={onCapture} onDocument={openDoc} planOpen={planOpen} onPlan={openPlan}
                    convOpen={convOpen} onConversation={helper ? undefined : openConversation} waiting={waiting} onReplyTo={replyTo} />}
              </>}
            </div>
            {view === 'terminal' && (
              <AgentView client={p.client} session={session} helper={helper ? { id: helper.id, name: helper.kind } : null} agent={agent} notify={p.notify}
                onGoParent={() => p.dispatch({ type: 'open', id: session.id })} onOpenShell={p.onOpenShell} />
            )}
            {view === 'thread' && seat === null && !atBottom && <button type="button" className="to-latest" onClick={toLatest}><Icon d={SHELL_ICONS.arrowDown} size={13} />{th.latest}</button>}
          </div>
          {/* On Terminal the agent's screen is alone: the pinned task and the reply come back with the thread (one types in the screen). */}
          {view === 'thread' && !archived && held && (
            <div className="pinned-task" role="note" aria-label={t.session.heldTask.pinned} data-task={held.id}>
              <span className="kicker mono">{t.session.notice.task}</span>
              <span className="pinned-text">{t.session.heldTask.task(held.id, held.title, held.giverName, t.chat.task.state[held.state])}</span>
              <button type="button" className="message-link" onClick={() => p.dispatch({ type: 'ledge', tab: 'tasks', task: held.id })}>{t.session.heldTask.seeTasks}</button>
            </div>
          )}
          {view === 'thread' && !archived && seat === null && <Reply session={session} helper={helper} asker={asker} since={waitedFor} decisions={p.decisions} memory={memory} memoKey={key}
            notify={p.notify} dispatch={p.dispatch} focusOnArrival={place.kind === 'session' && place.focus === 'reply'} keys={replyKeys} onReadPlan={readPlan} client={p.client} />}
        </div>
        {paneShown && (
          <SidePane tabs={tabs} active={activeTab!} onActive={setActiveTab} onClose={closeTab} split={p.split} onSplit={onSplit}
            onAllChanges={p.onAllChanges} onDocument={openDoc} session={session} files={files} client={p.client} plans={plans} convs={convs}
            onLight={lightMessage} captures={captures} captureFocus={captureFocus} items={items} seat={seat !== null} helperName={helperName} onShowInThread={showCapture} onOpenPeer={(peer, item) => p.dispatch({ type: 'open', id: peer.id, ...(item !== undefined && { item }) })} />
        )}
      </div>
    </section>
  );
}

/** In an OMP seat's thread place: why there is no thread (its Terminal view shows its screen), or, stopped, that its terminal is gone and
 *  where its rig is (docs/mockups/ledge-openrig-omp.html, view 1). */
function SeatNote({ stopped, onOpenRig }: { stopped: boolean; onOpenRig(): void }): JSX.Element {
  const { t } = useI18n();
  const x = stopped ? t.session.rigStopped : t.session.rigTerminalOnly;
  return (
    <div className="seat-note" role="status">
      <Icon d={stopped ? ICONS.stop.d : ICONS.text.d} size={18} />
      <div>
        <p><strong>{x.title}</strong> {x.body}</p>
        {stopped && <button type="button" className="message-link" onClick={onOpenRig}>{t.side.empty.openPage}</button>}
      </div>
    </div>
  );
}
