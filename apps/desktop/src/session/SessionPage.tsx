import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Helper, Session, ThreadItem } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { Decisions } from '../fleet/decisions';
import { whenOf, type Wait } from '../list/time';
import { repoOf } from '../list/model';
import { machineOf } from '../nav/agents';
import type { NavAction, NavState } from '../nav/state';
import { useScreenKeys, type ScreenKeyHandler } from '../nav/screenKeys';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { changedFiles, findFile } from './changes';
import { Changes } from './Changes';
import { memoKey, type SessionMemory } from './memory';
import { clampSplit } from './prefs';
import { Reply } from './Reply';
import { SidePane, tabId, type PanePlan, type PaneTab } from './SidePane';
import { Thread } from './Thread';
import { TodoBar } from './TodoBar';
import { latestTodos } from './todos';
import { atEnd, displayIds, exchanges, helperOf, pendingPlan, unreadFrom, type PlanDoc } from './thread';

export interface SessionPageProps {
  /** The parent on a subagent's page. */
  session: Session;
  helper: Helper | null;
  /** useThread, called by Workspace. */
  items: ThreadItem[] | undefined;
  nav: NavState; dispatch(a: NavAction): void;
  decisions: Decisions; waits: ReadonlyMap<string, Wait>;
  memory: SessionMemory; notify(text: string): void;
  /** « N sous-agents »: show this agent's subagents in the rail. */
  onShowKids(): void;
  /** O: show or hide the terminal. */
  onTerminal(): void;
  /** The side pane's share of the page (desktop.session, written by the Workspace's owner). */
  split: number; onSplit(v: number): void;
  /** The documents beside the thread are read through it. */
  client: DaemonClient;
}

/** After the last scroll, the reading position is written down this late (and when the page closes). */
const SETTLE_MS = 250;
/** The « Nouveau » marker opens this far below the top of the thread. */
const MARKER_OFFSET = 120;
/** An action reached from the Changes view stays lit this long (session.css: session-flash). */
const FLASH_MS = 1800;

type View = 'thread' | 'changes';
const VIEWS: ReadonlyArray<{ view: View; icon: readonly string[] }> = [{ view: 'thread', icon: SHELL_ICONS.thread }, { view: 'changes', icon: SHELL_ICONS.diff }];

/** A session's page, or one of its subagents' (session.tsx SessionPage): the heading and its Thread / Changes switch, the flat
 *  thread or the changed files, the pinned request and the reply, and beside the thread the side pane's documents and
 *  changes, and on top of the thread the agent's work plan. Mounted again for each agent (Workspace's key), so what belongs
 *  to a page (unfolded actions, the view, the file shown, the pane's tabs, the work plan unfolded) starts over. */
export function SessionPage(p: SessionPageProps): JSX.Element {
  const { session, helper, items, memory } = p;
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const offline = session.offline === true;
  const key = memoKey(session.id, helper?.id);
  // What the last visit left, read once.
  const [memo] = useState(() => memory.get(key));
  const xs = useMemo(() => (items ? exchanges(items, helper?.id) : []), [items, helper?.id]);
  const ids = useMemo(() => displayIds(xs), [xs]);
  // « Nouveau depuis votre dernière visite » : decided when the thread is first there, then frozen for the life of the page.
  const unread = useRef<string | null | undefined>(undefined);
  if (unread.current === undefined && items !== undefined) unread.current = unreadFrom(ids, memo.seen);

  // The clock: every second while an action runs (online), every 30 s otherwise (« il y a » keeps up). The spinner turns on
  // its own (Spinner), so neither tick renders more than the times.
  const running = !offline && xs.some(x => x.segments.some(s => s.kind === 'tools' && s.tools.some(tool => tool.status === 'running')));
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

  /* Thread / Changes. The thread stays mounted under the Changes view (hidden), its folds as the reader left them. */
  const [view, setView] = useState<View>('thread');
  const [file, setFile] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const files = useMemo(() => (items ? changedFiles(items, session.cwd, helper?.id) : []), [items, session.cwd, helper?.id]);
  // The file asked for (findFile), else the first.
  const current = useMemo(() => (file === null ? undefined : findFile(files, file, session.cwd)) ?? files[0], [files, file, session.cwd]);
  // Back on the thread: where the reader left it, or (from « tour 2 ») the action, which the flash brings into view.
  const returning = useRef<'restore' | 'aim' | null>(null);
  const switchView = (v: View) => {
    if (v === view) return;
    if (v === 'thread') returning.current = 'restore';
    setListOpen(false);
    setView(v);
  };
  // Stable: the pane's « Toutes les modifications » (and the thread before it).
  const showChanges = useCallback((path: string) => { setFile(path); setView('changes'); }, []);
  const showInThread = useCallback((toolId: string) => {
    returning.current = 'aim';
    setListOpen(false);
    setFlash(toolId);
    setView('thread');
  }, []);
  const stepFile = (d: 1 | -1) => {
    if (!current) return;
    setFile(files[(files.indexOf(current) + d + files.length) % files.length]!.path);
  };

  /* The work plan: the shown thread's latest list (a subagent's own), folded until the reader unfolds it. */
  const todos = useMemo(() => (items ? latestTodos(items, helper?.id) : null), [items, helper?.id]);
  const [todoOpen, setTodoOpen] = useState(false);
  // The bar gone (an emptied list), a list that comes back later shows folded.
  if (todos === null && todoOpen) setTodoOpen(false);
  const toggleTodos = useCallback(() => setTodoOpen(o => !o), []);
  const todoShown = todoOpen && todos !== null && view === 'thread';

  /* The side pane: a tab per document or change opened from the thread (or from Changes, which gives way to the thread). */
  const [tabs, setTabs] = useState<readonly PaneTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const viewNow = useRef(view);
  viewNow.current = view;
  // Stable: the thread is memoised on what opens a tab.
  const openTab = useCallback((tab: PaneTab) => {
    const id = tabId(tab);
    setTabs(ts => (ts.some(x => tabId(x) === id) ? ts : [...ts, tab]));
    setActiveTab(id);
    if (viewNow.current !== 'thread') { returning.current = 'restore'; setListOpen(false); setView('thread'); }
  }, []);
  const openDoc = useCallback((path: string) => openTab({ kind: 'doc', path }), [openTab]);
  const openDiff = useCallback((path: string) => openTab({ kind: 'diff', path }), [openTab]);
  const openPlan = useCallback((key: string) => openTab({ kind: 'plan', key }), [openTab]);
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
  const paneShown = active !== undefined && view === 'thread';
  const planOpen = active?.kind === 'plan' ? active.key : null;

  /* Plans: a card per ExitPlanMode action in the thread, and the pinned request's own ('pending': Codex and Cursor have no
     such action). The pinned plan is read from the card whose action waits, else from the request. */
  const askerId = session.pending?.helperId;
  const asker = askerId === undefined ? session.name : helperOf(session, items, askerId, t.session.subagent)?.kind ?? session.name;
  // As Reply shows it: none offline; on a subagent's page, only its own.
  const shown = offline ? undefined : session.pending;
  const request = shown?.kind === 'plan' && (helper ? shown.helperId === helper.id : true) ? shown : undefined;
  const canAnswer = request !== undefined && session.source !== 'hook_only' && !helper;
  // The waiting card: only the thread's last plan can still be proposed (exchanges revises those it supersedes).
  const requestKey = useMemo(() => {
    let key = 'pending';
    for (const x of xs) for (const s of x.segments) if (s.kind === 'plan' && s.plan.status === 'proposed') key = s.plan.key;
    return key;
  }, [xs]);
  const requestPlan = useMemo(() => (request ? pendingPlan(request) : null), [request]);
  // Once answered, the request's plan stays readable in its tab, its fate untold.
  const [lastRequest, setLastRequest] = useState<{ plan: PlanDoc; by: string } | null>(null);
  if (requestPlan && (lastRequest?.plan.markdown !== requestPlan.markdown || lastRequest.by !== asker)) setLastRequest({ plan: requestPlan, by: asker });
  const author = helper?.kind ?? session.name;
  const plans = useMemo(() => {
    const m = new Map<string, PanePlan>();
    for (const x of xs) for (const s of x.segments) {
      if (s.kind === 'plan') m.set(s.plan.key, { plan: s.plan, by: author, known: true, answer: canAnswer && s.plan.key === requestKey });
    }
    // The request's own tab is the request, whether or not its card has come since.
    if (requestPlan) m.set('pending', { plan: requestPlan, by: asker, known: true, answer: canAnswer });
    else if (lastRequest) m.set('pending', { ...lastRequest, known: false, answer: false });
    return m;
  }, [xs, author, asker, canAnswer, requestKey, requestPlan, lastRequest]);
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
    if (!el || !loaded || view !== 'thread') return;
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
  }, [items, loaded, memo.scroll, view]);
  // From a file back to the action that changed it: its fold opens (ActionGroup), it comes to the middle and lights up.
  useEffect(() => {
    if (flash === null || view !== 'thread') return;
    const frame = requestAnimationFrame(() => {
      const row = [...(scroller.current?.querySelectorAll<HTMLElement>('[data-tool]') ?? [])].find(e => e.dataset.tool === flash);
      row?.scrollIntoView?.({ block: 'center' });
    });
    const off = setTimeout(() => setFlash(null), FLASH_MS);
    return () => { cancelAnimationFrame(frame); clearTimeout(off); };
  }, [flash, view]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el || view !== 'thread') return;
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
  // (else navigation goes back); the reply area takes R, Y / N and 1…9; O shows or hides the terminal; J / K walk the
  // changed files, or the pane's change on the thread (never while typing: useKeys; a held key moves one file).
  const replyKeys = useRef<ScreenKeyHandler | null>(null);
  useScreenKeys(e => {
    if (e.key === 'Escape' && view === 'changes' && listOpen) { setListOpen(false); return true; }
    if (e.key === 'Escape' && todoShown) { setTodoOpen(false); return true; }
    if (e.key === 'Escape' && paneShown) { closeTab(activeTab!); return true; }
    if (replyKeys.current?.(e)) return true;
    if (e.key === 'o' || e.key === 'O') { p.onTerminal(); return true; }
    const k = e.key.toLowerCase();
    if (k !== 'j' && k !== 'k') return false;
    const walk = view === 'changes' ? files.length > 0 : paneShown && active.kind === 'diff' && files.length > 0;
    if (!walk) return false;
    if (e.repeat) return false;
    (view === 'changes' ? stepFile : stepPane)(k === 'j' ? 1 : -1);
    return true;
  });
  // ← / → on a tab: the other view, and the focus with it.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next: View = view === 'thread' ? 'changes' : 'thread';
    switchView(next);
    document.getElementById(`session-tab-${next}`)?.focus();
  };

  const machine = machineOf(session);
  const since = whenOf(session, undefined, now, t.list.when).text;
  const waitedFor = whenOf(session, p.waits.get(session.id)?.since, now, t.list.when).text;
  const place = p.nav.place;
  const kids = helper === null ? session.helpers ?? [] : [];
  return (
    <section className="conversation session-page" data-session={session.id} data-helper={helper?.id}>
      <div className="pane-heading">
        <div className="view-switch" role="tablist" aria-label={t.session.views.label}>
          {VIEWS.map(({ view: v, icon }) => (
            <button key={v} type="button" role="tab" id={`session-tab-${v}`} aria-selected={view === v} tabIndex={view === v ? 0 : -1}
              onClick={() => switchView(v)} onKeyDown={onTabKey}>
              <Icon d={icon} size={13} />{t.session.views[v]}{v === 'changes' && loaded && <span className="tab-count mono">{files.length}</span>}
            </button>
          ))}
        </div>
        <span className="pane-meta mono" title={t.session.meta}>{machine} · {repoOf(session)}</span>
        {kids.length > 0 && <><span className="spacer" /><button type="button" className="kids-pill" title={t.session.kidsPillTitle} onClick={p.onShowKids}><Icon d={SHELL_ICONS.subagents} size={13} />{t.session.kidsPill(kids.length)}</button></>}
      </div>
      <div className={cls('session-split', paneShown && 'has-pane')} style={{ '--split': `${p.split * 100}%`, '--reply-h': `${replyH}px` } as CSSProperties}>
        <div className="session-main" ref={main}>
          {/* On the thread, the panel keeps its lot 6a name (« Fil de la session »); on the changes, the tab names it. */}
          <div className="session-body" role="tabpanel" tabIndex={-1} {...(view === 'thread' ? { 'aria-label': th.label } : { 'aria-labelledby': 'session-tab-changes' })}>
            <div className="messages session-thread" ref={scroller} onScroll={onScroll} hidden={view !== 'thread'}>
              {todos && <TodoBar todos={todos} open={todoOpen} onToggle={toggleTodos} live={!offline} />}
              {offline && (
                <div className="frozen-banner" role="status">
                  <Icon d={SHELL_ICONS.offline} size={15} />
                  <span><strong>{th.lost(machine)}</strong> · {since}. {th.lostBody}</span>
                </div>
              )}
              {items === undefined ? <p className="muted">{offline ? th.notLoaded : th.loading}</p>
                : xs.length === 0 ? <p className="muted">{th.empty}</p>
                : <Thread session={session} helper={helper} items={items} xs={xs} now={times} unread={unread.current ?? null} since={since} dispatch={p.dispatch}
                    flash={flash} onChange={openDiff} onDocument={openDoc} planOpen={planOpen} onPlan={openPlan} />}
            </div>
            {/* Before the thread is there, the files are not known: the thread's own note, never « Aucun fichier modifié ». */}
            {view === 'changes' && !loaded && <div className="changes-empty"><p className="muted">{offline ? th.notLoaded : th.loading}</p></div>}
            {view === 'changes' && loaded && (
              <Changes files={files} current={current?.path ?? null} onFile={setFile} onTouch={showInThread} listOpen={listOpen} onListOpen={setListOpen}
                session={session} name={helper?.kind ?? session.name} notify={p.notify} />
            )}
            {view === 'thread' && !atBottom && <button type="button" className="to-latest" onClick={toLatest}><Icon d={SHELL_ICONS.arrowDown} size={13} />{th.latest}</button>}
          </div>
          <Reply session={session} helper={helper} asker={asker} since={waitedFor} decisions={p.decisions} memory={memory} memoKey={key}
            notify={p.notify} dispatch={p.dispatch} focusOnArrival={place.kind === 'session' && place.focus === 'reply'} keys={replyKeys} onReadPlan={readPlan} />
        </div>
        {paneShown && (
          <SidePane tabs={tabs} active={activeTab!} onActive={setActiveTab} onClose={closeTab} split={p.split} onSplit={onSplit}
            onAllChanges={showChanges} onDocument={openDoc} session={session} files={files} client={p.client} plans={plans} />
        )}
      </div>
    </section>
  );
}
