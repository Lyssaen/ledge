import { useCallback, useEffect, useRef, useState } from 'react';
import { startAuthentication as realStartAuthentication } from '@simplewebauthn/browser';
import { copy } from '../copy';
import { confirmWithDevice, fetchChallenge, VerifyFailure, type HeldChallenge } from '../connection/verify';
import { consequenceFor, parsePushTarget } from '../model/consequence';
import type { InboxItem } from '../model/requests';
import { mobileStore, type MobileStore } from '../state/store';
import { Command } from '../ui/Command';
import { Notice } from '../ui/Notice';

type Phase = { s: 'loading' } | { s: 'ready'; challenge: HeldChallenge } | { s: 'asking'; challenge: HeldChallenge } | { s: 'error'; message: string };

const full = 'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border px-4 py-2.5 text-[13px] font-medium disabled:opacity-45';

const failureText = (r: VerifyFailure['reason']): string => {
  switch (r) {
    case 'assertion_expired': return copy.confirm.expired;
    case 'offline': return copy.confirm.offline;
    case 'forbidden': return copy.decide.forbidden;
    case 'stale': case 'changed': return copy.decide.changed;
    default: return copy.confirm.prepareFailed;
  }
};

/**
 * Confirmation of a high-impact accept. Opening it asks the PC for a challenge, so that the confirming tap can call the
 * browser's device check at once (iOS needs the tap's user activation). Closing it sends nothing.
 */
export function RiskConfirm({ item, onClose, store = mobileStore, startAuthentication = realStartAuthentication }: {
  item: InboxItem; onClose: () => void; store?: MobileStore; startAuthentication?: typeof realStartAuthentication;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<Phase>({ s: 'loading' });
  const [note, setNote] = useState<string | null>(null);
  const round = useRef(0);
  // The detail rebuilds `item` on every render: the challenge is tied to the request's identity, not to the object.
  const latest = useRef(item);
  latest.current = item;
  const { sessionId, pendingId, pendingVersion } = item;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }, []);

  const load = useCallback(() => {
    const mine = ++round.current;
    setPhase({ s: 'loading' });
    fetchChallenge(latest.current, { send: m => store.send(m), listen: f => store.listen(f) }).then(
      challenge => { if (mine === round.current) setPhase({ s: 'ready', challenge }); },
      (e: unknown) => { if (mine === round.current) setPhase({ s: 'error', message: failureText(e instanceof VerifyFailure ? e.reason : 'invalid') }); }
    );
  }, [sessionId, pendingId, pendingVersion, store]);
  useEffect(() => { load(); return () => { round.current++; }; }, [load]);

  const confirm = () => {
    if (phase.s !== 'ready') return;
    const { challenge } = phase;
    // First call of the tap, before any await: the device check keeps the tap's user activation.
    const result = confirmWithDevice(item, challenge, { startAuthentication, submit: (op, msg) => store.submit(op, msg),
      stillCurrent: () => mounted.current && latest.current.sessionId === sessionId && latest.current.pendingId === pendingId && latest.current.pendingVersion === pendingVersion });
    setNote(null);
    setPhase({ s: 'asking', challenge });
    result.then(
      r => {
        if ('cancelled' in r) { setNote(copy.confirm.cancelled); setPhase({ s: 'ready', challenge }); } else onClose();
      },
      (e: unknown) => {
        const reason = e instanceof VerifyFailure ? e.reason : 'webauthn_failed';
        if (reason === 'assertion_expired') { setNote(copy.confirm.expired); load(); }
        else if (reason === 'webauthn_failed') { setNote(copy.confirm.failed); setPhase({ s: 'ready', challenge }); }
        else setPhase({ s: 'error', message: failureText(reason) });
      }
    );
  };

  const c = consequenceFor(item);
  const forced = item.riskReason === 'pushes' && parsePushTarget(item.text)?.force === true;
  const title = forced ? copy.confirm.titleForce : copy.confirm.title;
  const busy = phase.s !== 'ready';
  return (
    <dialog ref={ref} aria-label={copy.confirm.label(c?.title ?? title)} onCancel={e => { e.preventDefault(); if (phase.s !== 'asking') onClose(); }}
      className="fixed inset-x-0 top-auto bottom-0 m-0 mx-auto max-h-[92dvh] w-[min(100%,480px)] max-w-none overflow-auto rounded-t-[22px] border border-b-0 border-white/[0.125] bg-surface px-[18px] pt-5 pb-[calc(20px+env(safe-area-inset-bottom))] text-fg backdrop:bg-black/70">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[20px] text-balance leading-[1.25] font-semibold tracking-[-0.5px]">{title}</h2>
        <button type="button" onClick={onClose} disabled={phase.s === 'asking'} aria-label={copy.confirm.close} className="inline-flex size-12 flex-none items-center justify-center rounded-control text-muted disabled:opacity-45">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <p className="text-[11px] [overflow-wrap:anywhere] text-muted">{copy.confirm.context(item.botName, item.task, item.repo)}</p>
      {c && <div className="my-3.5"><Notice title={c.title} tone="danger"><p>{c.body}</p></Notice></div>}
      <Command text={item.text} />
      <p className="my-2.5 text-[11px] text-muted">{copy.confirm.note}</p>
      <div aria-live="polite" className="empty:hidden">
        {phase.s === 'loading' && <p className="mb-2 text-xs text-muted">{copy.confirm.preparing}</p>}
        {phase.s === 'asking' && <p className="mb-2 text-xs text-muted">{copy.confirm.asking}</p>}
        {note && phase.s !== 'asking' && <div className="mb-2"><Notice title={note} tone="warning" role="alert" /></div>}
        {phase.s === 'error' && <div className="mb-2"><Notice title={phase.message} tone="warning" role="alert" /></div>}
      </div>
      {phase.s === 'error'
        ? <button type="button" onClick={load} className={`${full} border-transparent bg-fg text-[#121415]`}>{copy.confirm.retry}</button>
        : <button type="button" disabled={busy} onClick={confirm} className={`${full} border-[#b34b52] bg-danger-btn text-white`}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z" /></svg>
            {copy.confirm.go}
          </button>}
      <button type="button" onClick={onClose} disabled={phase.s === 'asking'} className={`${full} mt-2 border-transparent text-muted`}>{copy.confirm.back}</button>
    </dialog>
  );
}
