import { useState } from 'react';
import type { PhoneChatClose } from '@ledge/protocol';
import { copy } from '../../copy';
import { href } from '../../router';
import { isLive } from '../../state/operations';
import { useMobile, type MobileStore } from '../../state/store';
import { CARD, GHOST, PRIMARY } from './RelayCard';

type State = 'closed' | 'killed' | 'ended' | 'closing' | 'failed' | 'open';

/** The row's state, in the order the PC's own card reads them: done, gone, under way, failed, proposed. */
function stateOf(row: PhoneChatClose, index: number, gone: boolean, liveRows: ReadonlySet<number> | 'all' | null, retryFailed: boolean): State {
  if (row.closedAt !== undefined) return row.how === 'killed' ? 'killed' : 'closed';
  if (gone) return 'ended';
  if (liveRows === 'all' || liveRows?.has(index)) return 'closing';
  if (row.failed || retryFailed) return 'failed';
  return 'open';
}

/**
 * The sessions Ledge proposes to close, one row each, with « Fermer tout » when two or more are open. The device's
 * own check confirms it (the store asks for it). A row whose session is gone from the phone's list, or exited there,
 * reads « Terminée » with no button.
 */
export function CloseCards({ store, qid, closes, canConfirm, sessions }: { store: MobileStore; qid: string; closes: PhoneChatClose[]; canConfirm: boolean; sessions: { id: string; exited?: boolean }[] }) {
  const { ops } = useMobile(store);
  const [failed, setFailed] = useState<ReadonlySet<number>>(new Set());
  const [tapped, setTapped] = useState(false);
  const live = Object.values(ops).filter(o => isLive(o.phase)).map(o => o.message).filter(m => m.type === 'chat.relay' || m.type === 'chat.launch' || m.type === 'chat.close').filter(m => m.qid === qid);
  // A close under way names its rows, or none for all of them.
  const liveRows: ReadonlySet<number> | 'all' | null = (() => {
    const closing = live.filter((m): m is Extract<typeof m, { type: 'chat.close' }> => m.type === 'chat.close');
    if (closing.length === 0) return null;
    if (closing.some(m => !m.rows)) return 'all';
    return new Set(closing.flatMap(m => m.rows ?? []));
  })();
  const held = tapped || live.length > 0;
  const rows = closes.map((row, i) => {
    const s = sessions.find(x => x.id === row.id);
    return { row, i, state: stateOf(row, i, !s || !!s.exited, liveRows, failed.has(i)) };
  });
  const open = rows.filter(r => r.state === 'open' || r.state === 'failed');
  const go = (indexes: number[]) => {
    setTapped(true);
    setFailed(f => new Set([...f].filter(i => !indexes.includes(i))));
    // Cancelled or expired leaves the rows as they were: the next tap asks again.
    void store.closeSessions(qid, indexes).then(r => { if (r.status === 'failed' || r.status === 'rejected') setFailed(f => new Set([...f, ...indexes])); }, () => setFailed(f => new Set([...f, ...indexes]))).finally(() => setTapped(false));
  };
  const text: Record<State, string> = { closed: copy.chat.closed, killed: copy.chat.killed, ended: copy.chat.ended, closing: copy.chat.closing, failed: copy.chat.closeFailed, open: '' };
  return (
    <section aria-label={copy.chat.closeLabel} className={CARD}>
      <ul className="flex flex-col gap-2">
        {rows.map(({ row, i, state }) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{row.name} <span className="font-normal text-muted">· {copy.tools[row.tool]}</span></span>
            {state !== 'open' && <span role="status" className={`text-[13px] ${state === 'failed' ? 'text-danger-fg' : state === 'closing' ? 'text-attention' : 'text-ok'}`}>{text[state]}</span>}
            {(state === 'open' || state === 'failed') && <button type="button" className={GHOST} disabled={held || !canConfirm} onClick={() => go([i])}>{copy.chat.closeRow}</button>}
          </li>
        ))}
      </ul>
      {open.length > 0 && !canConfirm && (
        <p className="text-[13px] text-attention">{copy.chat.closeSetup} <a href={href({ name: 'connection' })} className="text-info underline underline-offset-2">{copy.connection.title}</a></p>
      )}
      {open.length >= 2 && (
        <div className="flex gap-2">
          <button type="button" className={PRIMARY} disabled={held || !canConfirm} onClick={() => go(open.map(r => r.i))}>{copy.chat.closeAll(open.length)}</button>
        </div>
      )}
    </section>
  );
}
