import { useState } from 'react';
import type { PhoneChatRelay, PhoneSession } from '@ledge/protocol';
import { relayPill } from '@ledge/ui/chat/relayPill';
import { copy } from '../../copy';
import type { MobileStore } from '../../state/store';
import { threadLink } from './Answer';
import { buttonClass } from '../Button';
import { IgnoredNote } from './IgnoredNote';

export const CARD = 'flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-3.5';
export const GHOST = buttonClass({ size: 'sm' });
export const PRIMARY = buttonClass({ variant: 'primary', size: 'sm' });

/**
 * The instruction Ledge proposes to send to a session, as the PC's card: « Envoyer » does it (now if the session is free, else
 * queued), « Annuler » takes a queued one back, a failure says why and offers « Réessayer ». « Ignorer » sets the turn's cards
 * aside on every device, as the PC's. Until it is sent, a pill says what the target is doing, as the PC's.
 */
export function RelayCard({ store, qid, relay, target, known, ignoredAt }: { store: MobileStore; qid: string; relay: PhoneChatRelay; target?: { repo?: string; state?: PhoneSession['state']; helpers?: PhoneSession['helpers'] } | undefined; known: boolean; ignoredAt?: string | undefined }) {
  const repo = target?.repo;
  // The reason of a send this phone saw refused before the PC's turn could say it (a card ignored meanwhile).
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Applied: the PC's updated turn is on its way; until it lands the card must not offer a second send (or cancel).
  const [applied, setApplied] = useState<'send' | 'cancel' | null>(null);
  const sent = relay.status === 'sent';
  const pill = relayPill(target?.state ? { state: target.state, helpers: target.helpers ?? [] } : undefined);
  const queued = relay.status === 'queued';
  // The PC's turn moved on since the tap: its state is the card's again.
  if ((applied === 'send' && (sent || queued)) || (applied === 'cancel' && !queued)) setApplied(null);
  if (ignoredAt !== undefined && !sent && !queued) return <IgnoredNote store={store} qid={qid} at={ignoredAt} />;
  const run = (kind: 'send' | 'cancel') => {
    setBusy(true); setFailed(null);
    const p = kind === 'send' ? store.relay(qid) : store.cancelRelay(qid);
    void p.then(r => { if (r.status === 'applied') setApplied(kind); else if (kind === 'send') setFailed(r.status === 'rejected' ? r.reason ?? '' : ''); }, () => { if (kind === 'send') setFailed(''); })
      .finally(() => setBusy(false));
  };
  // This phone's own refusal first (it may say more than the PC's turn), else the PC's code.
  const failure = failed ? failed : relay.failed ? relay.code ?? '' : failed;
  const outcome = sent
    ? <p role="status" className="text-body text-ok">{copy.chat.sentTo(relay.name)}{known ? threadLink(relay.id, copy.chat.seeThread) : copy.chat.seeThread}</p>
    : queued ? <p role="status" className="text-body text-attention">{copy.chat.queued(relay.name)}</p>
    : failure !== null ? <p role="alert" className="text-body text-danger-fg">{copy.chat.relayFailed(failure || undefined)}</p> : null;
  return (
    <section aria-label={copy.chat.relayLabel} className={CARD}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-body font-semibold">{copy.chat.relayHead(relay.name)}{repo ? ` · ${repo}` : ''}</h3>
        {!sent && <span data-pill={pill} className="shrink-0 rounded-full border border-line px-2 text-small text-muted">{copy.chat.relayPill[pill]}</span>}
      </div>
      <p className="whitespace-pre-wrap break-words text-body text-fg/80">{relay.text}</p>
      {outcome}
      {queued && (
        <div className="flex gap-2">
          <button type="button" className={GHOST} disabled={busy || applied !== null} onClick={() => run('cancel')}>{copy.chat.relayCancel}</button>
        </div>
      )}
      {!sent && !queued && (
        <div className="flex gap-2">
          {applied === null && <button type="button" className={GHOST} disabled={busy} onClick={() => { void store.ignoreTurn(qid); }}>{copy.chat.ignore}</button>}
          <button type="button" className={PRIMARY} disabled={busy || applied !== null} onClick={() => run('send')}>{failure !== null ? copy.chat.relayRetry : copy.chat.relayGo}</button>
        </div>
      )}
    </section>
  );
}
