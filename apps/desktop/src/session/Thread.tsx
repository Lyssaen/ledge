import { Fragment, memo, type JSX, type ReactNode } from 'react';
import type { Helper, HelperItem, Session, ThreadItem } from '@ledge/protocol';
import { ThreadMarkdown } from '@ledge/ui/documents/markdown';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { helperState } from '../atelier/layout';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { HelperBot, SessionBot, StateBadge } from '../shell/SessionBot';
import { ActionGroup } from './ActionGroup';
import { helperOf, timeMark, type Exchange, type Segment } from './thread';

const CHIP_MARK = { accept: '✓', always: '✓', deny: '✕', unknown: '·' } as const;

export interface ThreadProps {
  session: Session; helper: Helper | null; items: readonly ThreadItem[]; xs: readonly Exchange[];
  /** The clock; offline, the instant the thread froze (its times stand still). */
  now: number;
  /** The first item new since the last visit, frozen for the life of the page; null: nothing new. */
  unread: string | null;
  /** « Session terminée · il y a 2 h », « Plus aucune nouvelle… · il y a 2 h » : `whenOf(…).text`. */
  since: string;
  dispatch(a: NavAction): void;
}

/** What the agent said: parsed again only when its text changes, never on the page's clock. */
const Say = memo(function Say({ kind, text }: { kind: 'message' | 'reply'; text: string }): JSX.Element {
  return <div className={`agent-message ${kind}`}><div className="msg-body"><ThreadMarkdown text={text} /></div></div>;
});

/** The flat thread (session.tsx renderTurn / renderItem): one section per exchange, its time, the prompt as a bubble, the
 *  agent named once, then what it said, decided and did; the frozen or ended note after the last one. */
export function Thread({ session, helper, items, xs, now, unread, since, dispatch }: ThreadProps): JSX.Element {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const offline = session.offline === true;
  const marker = (id: string): ReactNode => id === unread
    ? <div className="unread-marker" role="separator" aria-label={th.unread}><span>{th.unread}</span></div>
    : null;
  const author = helper
    ? <><HelperBot helper={helper} parent={session} size={20} /><strong>{helper.kind}</strong></>
    : <><SessionBot session={session} size={20} /><strong>{session.name}</strong></>;

  const helperCard = (item: HelperItem) => {
    const h = helperOf(session, items, item.id)!;
    return (
      <button type="button" className="helper-card" data-helper={item.id} aria-label={th.openHelper(h.kind, item.task)} onClick={() => dispatch({ type: 'open', id: session.id, helper: item.id })}>
        <span className="helper-icon"><Icon d={SHELL_ICONS.subagents} size={12} />{th.helperLaunched}</span>
        <HelperBot helper={h} parent={session} size={26} />
        <span className="helper-copy"><strong>{h.kind}</strong><small>{item.task}</small></span>
        <StateBadge state={helperState(h)} offline={offline} />
        <Icon d={ICONS.chevronRight.d} size={14} />
      </button>
    );
  };

  const segment = (s: Segment): ReactNode => {
    if (s.kind === 'tools') {
      const first = s.tools.find(x => x.id === unread);
      return <ActionGroup key={s.key} tools={s.tools} now={now} live={!offline} marker={first ? marker(first.id) : null} />;
    }
    const { item } = s;
    let node: ReactNode;
    if (s.kind === 'say') node = <Say kind={s.item.kind} text={s.item.text} />;
    else if (s.kind === 'decision') {
      const d = s.item.decision!;
      node = <div className={`decision-chip ${d}`}><span className="chip-mark">{CHIP_MARK[d]}</span><span>{th.decided[d]}</span><code>{s.item.text}</code></div>;
    } else node = helperCard(s.item);
    return <Fragment key={item.id}>{marker(item.id)}{node}</Fragment>;
  };

  return <>{xs.map((x, i) => {
    const last = i === xs.length - 1;
    const at = timeMark(x.at, now, lang);
    const running = !offline && x.segments.some(s => s.kind === 'tools' && s.tools.some(tool => tool.status === 'running'));
    return (
      <section key={x.key} className={cls('turn open', last && 'current')} aria-label={th.exchange(at)}>
        {x.prompt && marker(x.prompt.id)}
        <div className="turn-time" aria-hidden="true"><span className="mono">{at}</span>{running && <span className="turn-live"><i />{th.live}</span>}</div>
        {x.prompt && (
          <div className={cls('prompt-block', x.prompt.from === 'parent' && 'from-agent')}>
            <div className="prompt-author">{x.prompt.from === 'parent' ? <><SessionBot session={session} size={16} />{th.fromParent(session.name)}</> : th.you}</div>
            <p>{x.prompt.text}</p>
          </div>
        )}
        {x.segments.length > 0 && <div className="turn-author">{author}</div>}
        {x.segments.map(segment)}
        {last && offline && <div className="frozen-end"><Icon d={SHELL_ICONS.offline} size={13} />{th.frozenEnd(since)}</div>}
        {last && !offline && session.state === 'exited' && <div className="turn-end">{th.ended(since)}</div>}
      </section>
    );
  })}</>;
}
