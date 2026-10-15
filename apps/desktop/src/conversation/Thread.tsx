import { useMemo, type SyntheticEvent } from 'react';
import type { Session, ThreadItem } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { toggled } from '../state/threadPrefs';
import { threadBlocks, type Block } from './blocks';
import { RequestBlock } from './Request';
import { useReadingPosition } from './useReadingPosition';
import type { Conversations } from './useConversations';

function BlockView({ block: b, name, open, onToggle }: { block: Block; name: string; open: boolean; onToggle: (e: SyntheticEvent<HTMLDetailsElement>) => void }) {
  const { t } = useI18n();
  const c = t.conversation.thread;
  switch (b.kind) {
    case 'user': return <article className="thread-message user"><div className="message-author">{c.you}</div><p>{b.text}</p></article>;
    case 'agent': return <article className="thread-message agent"><div className="message-author">{name}</div><p>{b.text}</p></article>;
    case 'actions': return (
      <details className="thread-actions" data-fold={b.id} open={open} onToggle={onToggle}>
        <summary>{c.actions(b.lines.length)}</summary>
        <ul>{b.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </details>
    );
    case 'permission': return <p className="thread-notice">{c.permission(b.tool, b.accepted)}</p>;
    case 'helper': return <p className="thread-notice">{c.helper(b.task, b.done)}</p>;
  }
}

/** The full thread (spec §9.1), mounted per session (`key`). Folds and reading position live in `desktop.thread` (spec §7):
 *  the position comes back once the thread is loaded, is saved 250 ms after scrolling stops and on leaving; at the end of the
 *  thread, new items and the pending request stay in view. */
export function Thread({ session, items, api }: { session: Session; items: ThreadItem[] | undefined; api: Conversations }) {
  const { t, lang } = useI18n();
  const c = t.conversation.thread;
  const blocks = useMemo(() => (items ? threadBlocks(items) : []), [items]);
  const open = api.pref(session.id).open;
  const loaded = items !== undefined;
  const tail = `${blocks.length}|${items?.at(-1)?.id ?? ''}|${session.pending?.text ?? ''}|${session.lastReply?.at ?? ''}`;
  const { ref: scroller, onScroll } = useReadingPosition(session.id, api, loaded, tail);
  const onToggle = (fold: string) => (e: SyntheticEvent<HTMLDetailsElement>) =>
    api.setPref(session.id, { open: toggled(open, fold, e.currentTarget.open) });
  const started = new Date(session.startedAt).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <section ref={scroller} className="thread-scroll" tabIndex={0} aria-label={c.label(session.name)} onScroll={onScroll}>
      <div className="thread-content">
        <p className="thread-start">{loaded ? c.start(started) : c.partial}</p>
        {blocks.map(b => <BlockView key={b.id} block={b} name={session.name} open={open.includes(b.id)} onToggle={onToggle(b.id)} />)}
        {!loaded && session.lastReply && (
          <article className="thread-message agent"><div className="message-author">{session.name}</div><p>{session.lastReply.text}</p></article>
        )}
        <RequestBlock session={session} api={api} />
      </div>
    </section>
  );
}
