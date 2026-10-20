import { useState } from 'react';
import type { PhoneChatProposal } from '@ledge/protocol';
import { copy } from '../../copy';
import { href } from '../../router';
import { isApple } from '../../screens/device';
import type { MobileStore } from '../../state/store';
import { CARD, GHOST, PRIMARY } from './RelayCard';
import { threadLink } from './Answer';

type Note = 'failed' | 'cancelled' | 'expired';

function Row({ store, qid, row, proposal, canConfirm, known }: { store: MobileStore; qid: string; row: number; proposal: PhoneChatProposal; canConfirm: boolean; known: boolean }) {
  const [hidden, setHidden] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const done = proposal.launchedId !== undefined;
  if (hidden && !done) return null;
  const go = () => {
    setBusy(true); setNote(null);
    // Cancelled or expired leaves the card proposed: the next tap asks again.
    void store.launch(qid, [row]).then(r => { if (r.status === 'cancelled' || r.status === 'expired') setNote(r.status); else if (r.status === 'failed' || r.status === 'rejected') setNote('failed'); }, () => setNote('failed')).finally(() => setBusy(false));
  };
  const shown: Note | null = proposal.failed ? 'failed' : note;
  return (
    <section aria-label={copy.chat.launchLabel} className={CARD}>
      <h3 className="text-[13px] font-semibold">{copy.chat.launchHead(copy.tools[proposal.tool], proposal.project)}</h3>
      {proposal.prompt && <p className="whitespace-pre-wrap break-words text-[13px] text-[#c8cbce]">{proposal.prompt}</p>}
      {done && <p role="status" className="text-[13px] text-ok">{copy.chat.launchedTo}{known ? threadLink(proposal.launchedId!, copy.chat.seeThread) : copy.chat.seeThread}</p>}
      {!done && shown && <p role="status" className="text-[13px] text-danger-fg">{shown === 'failed' ? copy.chat.notLaunched : copy.confirm[shown]}</p>}
      {!done && !canConfirm && (
        <p className="text-[13px] text-attention">{copy.chat.launchSetup} <a href={href({ name: 'connection' })} className="text-info underline underline-offset-2">{copy.connection.title}</a></p>
      )}
      {!done && (
        <div className="flex gap-2">
          <button type="button" className={GHOST} onClick={() => setHidden(true)}>{copy.chat.ignore}</button>
          <button type="button" className={PRIMARY} disabled={busy || !canConfirm} onClick={go}>{isApple() ? copy.confirm.goApple : copy.confirm.go}</button>
        </div>
      )}
    </section>
  );
}

/** What Ledge proposes to start, one card per proposal: the device's own check confirms it (the store asks for it). */
export function LaunchCards({ store, qid, proposals, canConfirm, sessionIds }: { store: MobileStore; qid: string; proposals: PhoneChatProposal[]; canConfirm: boolean; sessionIds: ReadonlySet<string> }) {
  return <>{proposals.map((p, i) => <Row key={i} store={store} qid={qid} row={i} proposal={p} canConfirm={canConfirm} known={sessionIds.has(p.launchedId ?? '')} />)}</>;
}
