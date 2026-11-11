// « Conversations » (m3-chat.html §6, Q33): the clock's sheet, the current conversation on top then the ones the PC keeps by
// day; on a PC that keeps none (fallback B), the current conversation's questions, as Desktop's history.
import { useId, type ReactNode } from 'react';
import type { ChatConversationSummary, PhoneChatTurn } from '@ledge/protocol';
import { copy, locale } from '../../copy';
import type { Conversations } from '../../state/chat';
import { Sheet } from '../Dialog';
import { Icon } from '../icons';
import { kitButtonClass } from '../kit/Controls';

const H = () => copy.chat.history;
/** « 9:12 », « 14:20 »: 24 h without a leading zero, in English too (m3-chat.html §6, design-ux 3ccd3da3). */
export const clockOf = (iso: string) => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
/** « Aujourd'hui », « Hier », then « lun. 8 nov. », as the sheet's groups. */
export function dayOf(iso: string, now: Date): string {
  const d = new Date(iso);
  if (dayKey(d) === dayKey(now)) return H().today;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return H().yesterday;
  return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
}
/** A past conversation's title: the day and time of its first question (« Hier, 11:30 »). */
export const titleOf = (c: ChatConversationSummary, now: Date) => `${dayOf(c.startedAt, now)}, ${clockOf(c.startedAt)}`;

const ROW = 'flex min-h-12 w-full items-center gap-3 border-b border-line px-3.5 py-2 text-left last:border-b-0';
const SEC = 'px-1 pt-1.5 text-[12px] font-medium text-muted';

function Row({ first, sub, current = false, onClick }: { first: string; sub: string; current?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={current || undefined} className={`${ROW} ${current ? 'bg-raised' : ''}`}>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-[14.5px] font-medium">{H().quote(first)}</b>
        <small className="truncate text-[12px] text-muted">{sub}</small>
      </span>
      {!current && <Icon name="chevron" className="size-4 text-muted" />}
    </button>
  );
}

function List({ children }: { children: ReactNode }) {
  return <div className="flex max-h-[55vh] flex-col overflow-y-auto rounded-[10px] border border-line">{children}</div>;
}

/**
 * The sheet. `list` null: the PC keeps no conversations (fallback B), the thread's own questions are listed and a tap
 * scrolls to one. Otherwise the PC's list, `null` while it loads (the head alone).
 */
export function ConversationsSheet({ conversations, kept, turns, running, now, onClose, onReset, onOpen, onScrollTo }: {
  conversations: Conversations; kept: boolean; turns: PhoneChatTurn[]; running: boolean; now: Date;
  onClose: () => void; onReset: () => void; onOpen: (c: ChatConversationSummary) => void; onScrollTo: (qid: string) => void;
}) {
  const title = useId();
  if (!kept) {
    const asked = turns.filter(t => t.question);
    return (
      <Sheet labelledBy={title} onClose={onClose}>
        <h2 id={title} className="text-base font-semibold">{H().today}</h2>
        {asked.length === 0
          ? <p className="text-body text-muted">{H().none}</p>
          : <List>{asked.map(t => <Row key={t.qid} first={t.question} sub={clockOf(t.askedAt)} onClick={() => onScrollTo(t.qid)} />)}</List>}
      </Sheet>
    );
  }
  const list = conversations.list;
  const groups: { day: string; items: ChatConversationSummary[] }[] = [];
  for (const c of list?.past ?? []) {
    const day = dayOf(c.startedAt, now);
    const g = groups.at(-1);
    if (g?.day === day) g.items.push(c); else groups.push({ day, items: [c] });
  }
  return (
    <Sheet labelledBy={title} onClose={onClose}>
      <div className="flex items-center gap-2">
        <h2 id={title} className="flex-1 text-base font-semibold">{H().title}</h2>
        <button type="button" disabled={running} onClick={onReset} className={kitButtonClass({ size: 'sm' })}><Icon name="edit" className="size-4" />{copy.chat.reset}</button>
      </div>
      {list && (list.current || groups.length > 0) && (
        <>
          <div className="flex flex-col gap-1">
            {list.current && (
              <List><Row current first={list.current.first} onClick={onClose}
                sub={[H().current, H().count(list.current.count), H().since(clockOf(list.current.startedAt))].join(' · ')} /></List>
            )}
            {groups.map(g => (
              <section key={g.day} aria-label={g.day} className="flex flex-col gap-1">
                <h3 className={SEC}>{g.day}</h3>
                <List>{g.items.map(c => <Row key={c.id} first={c.first} sub={`${H().count(c.count)} · ${clockOf(c.startedAt)}`} onClick={() => onOpen(c)} />)}</List>
              </section>
            ))}
          </div>
          <p className="text-small text-muted">{H().kept}</p>
        </>
      )}
    </Sheet>
  );
}
