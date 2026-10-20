import { useState } from 'react';
import type { PhoneChatRelay } from '@ledge/protocol';
import { copy } from '../../copy';
import type { MobileStore } from '../../state/store';
import { threadLink } from './Answer';

export const CARD = 'flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-3.5';
export const GHOST = 'inline-flex h-11 items-center rounded-control border border-white/15 px-4 text-[13px] font-medium';
export const PRIMARY = 'inline-flex h-11 items-center rounded-control bg-white px-4 text-[13px] font-semibold text-black disabled:opacity-40';

/** The instruction Ledge proposes to send to a session: « Envoyer » does it, « Ignorer » only hides the card on this phone. */
export function RelayCard({ store, qid, relay, repo, known }: { store: MobileStore; qid: string; relay: PhoneChatRelay; repo?: string; known: boolean }) {
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const done = relay.status !== undefined;
  if (hidden && !done) return null;
  const go = () => {
    setBusy(true); setFailed(false);
    void store.relay(qid).then(r => { if (r.status === 'failed' || r.status === 'rejected') setFailed(true); }, () => setFailed(true)).finally(() => setBusy(false));
  };
  const outcome = relay.status === 'sent'
    ? <p role="status" className="text-[13px] text-ok">{copy.chat.sentTo(relay.name)}{known ? threadLink(relay.id, copy.chat.seeThread) : copy.chat.seeThread}</p>
    : relay.status === 'queued' ? <p role="status" className="text-[13px] text-attention">{copy.chat.queued(relay.name)}</p>
    : relay.failed || failed ? <p role="status" className="text-[13px] text-danger-fg">{copy.chat.notSent}</p> : null;
  return (
    <section aria-label={copy.chat.relayLabel} className={CARD}>
      <h3 className="text-[13px] font-semibold">{copy.chat.relayHead(relay.name)}{repo ? ` · ${repo}` : ''}</h3>
      <p className="whitespace-pre-wrap break-words text-[13px] text-[#c8cbce]">{relay.text}</p>
      {outcome}
      {!done && (
        <div className="flex gap-2">
          <button type="button" className={GHOST} onClick={() => setHidden(true)}>{copy.chat.ignore}</button>
          <button type="button" className={PRIMARY} disabled={busy} onClick={go}>{copy.chat.relayGo}</button>
        </div>
      )}
    </section>
  );
}
