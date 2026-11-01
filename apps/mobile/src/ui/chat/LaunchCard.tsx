import { useState } from 'react';
import type { PhoneChatProposal } from '@ledge/protocol';
import { copy } from '../../copy';
import { href } from '../../router';
import { isApple } from '../../screens/device';
import type { MobileStore } from '../../state/store';
import { CARD, GHOST, PRIMARY } from './RelayCard';
import { threadLink } from './Answer';
import { IgnoredNote } from './IgnoredNote';

type Note = 'failed' | 'cancelled' | 'expired';

function Row({ store, qid, row, proposal, canConfirm, known, ignored }: { store: MobileStore; qid: string; row: number; proposal: PhoneChatProposal; canConfirm: boolean; known: boolean; ignored: boolean }) {
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  // Applied: the PC's updated turn is on its way; until it lands the row must not offer a second launch.
  const [applied, setApplied] = useState(false);
  const done = proposal.launchedId !== undefined;
  // A turn set aside shows its launched rows only; the others are the card's « Revoir » (LaunchCards).
  if (ignored && !done) return null;
  const go = () => {
    setBusy(true); setNote(null);
    // Cancelled or expired leaves the card proposed: the next tap asks again.
    void store.launch(qid, [row]).then(r => { if (r.status === 'applied') setApplied(true); else if (r.status === 'cancelled' || r.status === 'expired') setNote(r.status); else if (r.status === 'failed' || r.status === 'rejected') setNote('failed'); }, () => setNote('failed')).finally(() => setBusy(false));
  };
  const shown: Note | null = proposal.failed ? 'failed' : note;
  return (
    <section aria-label={copy.chat.launchLabel} className={CARD}>
      <h3 className="text-body font-semibold">{copy.chat.launchHead(copy.tools[proposal.tool], proposal.project)}</h3>
      {proposal.prompt && <p className="whitespace-pre-wrap break-words text-body text-fg/80">{proposal.prompt}</p>}
      {done && <p role="status" className="text-body text-ok">{copy.chat.launchedTo}{known ? threadLink(proposal.launchedId!, copy.chat.seeThread) : copy.chat.seeThread}</p>}
      {!done && shown && <p role="status" className={`text-body ${shown === 'failed' ? 'text-danger-fg' : 'text-muted'}`}>{shown === 'failed' ? copy.chat.notLaunched : copy.confirm[shown]}</p>}
      {!done && !canConfirm && (
        <p className="text-body text-attention">{copy.chat.launchSetup} <a href={href({ name: 'connection' })} className="text-info underline underline-offset-2">{copy.connection.title}</a></p>
      )}
      {!done && (
        <div className="flex gap-2">
          {!applied && <button type="button" className={GHOST} disabled={busy} onClick={() => { void store.ignoreTurn(qid); }}>{copy.chat.ignore}</button>}
          <button type="button" className={PRIMARY} disabled={busy || applied || !canConfirm} onClick={go}>{isApple() ? copy.confirm.goApple : copy.confirm.go}</button>
        </div>
      )}
    </section>
  );
}

/** What Ledge proposes to start, one card per proposal: the device's own check confirms it (the store asks for it). « Ignorer » sets
 *  the turn's cards aside on every device, as the PC's; a turn set aside keeps its launched rows and offers « Revoir » for the rest. */
export function LaunchCards({ store, qid, proposals, canConfirm, sessionIds, ignoredAt }: { store: MobileStore; qid: string; proposals: PhoneChatProposal[]; canConfirm: boolean; sessionIds: ReadonlySet<string>; ignoredAt?: string | undefined }) {
  const ignored = ignoredAt !== undefined;
  return <>
    {proposals.map((p, i) => <Row key={i} store={store} qid={qid} row={i} proposal={p} canConfirm={canConfirm} known={sessionIds.has(p.launchedId ?? '')} ignored={ignored} />)}
    {ignored && proposals.some(p => p.launchedId === undefined) && <IgnoredNote store={store} qid={qid} at={ignoredAt} rest={proposals.some(p => p.launchedId !== undefined)} />}
  </>;
}
