import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
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

/** A session's page, or one of its subagents' (session.tsx SessionPage): the heading, the flat thread, the pinned request and the reply.
 *  Mounted again for each agent (Workspace's key), so what belongs to a page (unfolded actions) starts over. */
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

  /* Scrolling: open on the marker, else where the reader left, else at the end; then follow the end only while the reader is there. */
  const scroller = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const follow = useRef(true);
  const pos = useRef<number | null>(memo.scroll);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [atBottom, setAtBottom] = useState(true);
  const loaded = items !== undefined;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !loaded) return;
    if (!opened.current) {
      opened.current = true;
      const mark = el.querySelector<HTMLElement>('.unread-marker');
      if (mark) el.scrollTop = Math.max(0, el.scrollTop + mark.getBoundingClientRect().top - el.getBoundingClientRect().top - MARKER_OFFSET);
      else if (memo.scroll !== null) el.scrollTop = memo.scroll;
      else el.scrollTop = el.scrollHeight;
    } else if (follow.current) el.scrollTop = el.scrollHeight;
    follow.current = atEnd(el);
    pos.current = follow.current ? null : el.scrollTop;
    setAtBottom(follow.current);
  }, [items, loaded, memo.scroll]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
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

  // The page's keys: the reply area takes R, Y / N and 1…9; O shows or hides the terminal (later lots add theirs here).
  const replyKeys = useRef<ScreenKeyHandler | null>(null);
  useScreenKeys(e => {
    if (replyKeys.current?.(e)) return true;
    if (e.key === 'o' || e.key === 'O') { p.onTerminal(); return true; }
    return false;
  });

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
        <span className="pane-meta mono" title={t.session.meta}>{machine} · {repoOf(session)}</span>
        {kids.length > 0 && <><span className="spacer" /><button type="button" className="kids-pill" title={t.session.kidsPillTitle} onClick={p.onShowKids}><Icon d={SHELL_ICONS.subagents} size={13} />{t.session.kidsPill(kids.length)}</button></>}
      </div>
      <div className="session-split">
        <div className="session-main">
          <div className="session-body" role="region" aria-label={th.label}>
            <div className="messages session-thread" ref={scroller} onScroll={onScroll}>
              {offline && (
                <div className="frozen-banner" role="status">
                  <Icon d={SHELL_ICONS.offline} size={15} />
                  <span><strong>{th.lost(machine)}</strong> · {since}. {th.lostBody}</span>
                </div>
              )}
              {items === undefined ? <p className="muted">{offline ? th.notLoaded : th.loading}</p>
                : xs.length === 0 ? <p className="muted">{th.empty}</p>
                : <Thread session={session} helper={helper} items={items} xs={xs} now={times} unread={unread.current ?? null} since={since} dispatch={p.dispatch} />}
            </div>
            {!atBottom && <button type="button" className="to-latest" onClick={toLatest}><Icon d={SHELL_ICONS.arrowDown} size={13} />{th.latest}</button>}
          </div>
          <Reply session={session} helper={helper} asker={asker} since={waitedFor} decisions={p.decisions} memory={memory} memoKey={key}
            notify={p.notify} dispatch={p.dispatch} focusOnArrival={place.kind === 'session' && place.focus === 'reply'} keys={replyKeys} />
        </div>
      </div>
    </section>
  );
}
