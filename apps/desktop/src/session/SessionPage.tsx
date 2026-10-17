import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import type { Helper, Session, ThreadItem } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { Decisions } from '../fleet/decisions';
import { whenOf, type Wait } from '../list/time';
import { repoOf } from '../list/model';
import { machineOf } from '../nav/agents';
import type { NavAction, NavState } from '../nav/state';
import { useScreenKeys, type ScreenKeyHandler } from '../nav/screenKeys';
import { SHELL_ICONS } from '../shell/icons';
import { changedFiles, relativeTo } from './changes';
import { Changes } from './Changes';
import { memoKey, type SessionMemory } from './memory';
import { Reply } from './Reply';
import { Thread } from './Thread';
import { atEnd, displayIds, exchanges, helperOf, unreadFrom } from './thread';

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
 *  thread or the changed files, the pinned request and the reply. Mounted again for each agent (Workspace's key), so what
 *  belongs to a page (unfolded actions, the view, the file shown) starts over. */
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
  // The file asked for: by its path, else by its path below the cwd (an absolute path for an entry kept relative), else by an
  // older path of it (an action before a rename); else the first.
  const current = useMemo(() => {
    if (file === null) return files[0];
    const shown = relativeTo(file, session.cwd);
    return files.find(f => f.path === file) ?? files.find(f => f.shown === shown)
      ?? files.find(f => f.from === shown || f.touches.some(x => x.from === shown)) ?? files[0];
  }, [files, file, session.cwd]);
  // Back on the thread: where the reader left it, or (from « tour 2 ») the action, which the flash brings into view.
  const returning = useRef<'restore' | 'aim' | null>(null);
  const switchView = (v: View) => {
    if (v === view) return;
    if (v === 'thread') returning.current = 'restore';
    setListOpen(false);
    setView(v);
  };
  // Stable: the thread is memoised on it.
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

  // The page's keys: Escape closes the narrow file list first; the reply area takes R, Y / N and 1…9; O shows or hides the
  // terminal; J / K walk the changed files (never while typing: useKeys; a held key moves one file).
  const replyKeys = useRef<ScreenKeyHandler | null>(null);
  useScreenKeys(e => {
    if (e.key === 'Escape' && view === 'changes' && listOpen) { setListOpen(false); return true; }
    if (replyKeys.current?.(e)) return true;
    if (e.key === 'o' || e.key === 'O') { p.onTerminal(); return true; }
    const k = e.key.toLowerCase();
    if (view === 'changes' && files.length > 0 && (k === 'j' || k === 'k')) {
      if (e.repeat) return false;
      stepFile(k === 'j' ? 1 : -1);
      return true;
    }
    return false;
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
  const askerId = session.pending?.helperId;
  const asker = askerId === undefined ? session.name : helperOf(session, items, askerId)?.kind ?? session.name;
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
      <div className="session-split">
        <div className="session-main">
          {/* On the thread, the panel keeps its lot 6a name (« Fil de la session »); on the changes, the tab names it. */}
          <div className="session-body" role="tabpanel" {...(view === 'thread' ? { 'aria-label': th.label } : { 'aria-labelledby': 'session-tab-changes' })}>
            <div className="messages session-thread" ref={scroller} onScroll={onScroll} hidden={view !== 'thread'}>
              {offline && (
                <div className="frozen-banner" role="status">
                  <Icon d={SHELL_ICONS.offline} size={15} />
                  <span><strong>{th.lost(machine)}</strong> · {since}. {th.lostBody}</span>
                </div>
              )}
              {items === undefined ? <p className="muted">{offline ? th.notLoaded : th.loading}</p>
                : xs.length === 0 ? <p className="muted">{th.empty}</p>
                : <Thread session={session} helper={helper} items={items} xs={xs} now={times} unread={unread.current ?? null} since={since} dispatch={p.dispatch}
                    flash={flash} onChange={showChanges} />}
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
            notify={p.notify} dispatch={p.dispatch} focusOnArrival={place.kind === 'session' && place.focus === 'reply'} keys={replyKeys} />
        </div>
      </div>
    </section>
  );
}
