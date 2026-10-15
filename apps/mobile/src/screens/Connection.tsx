import { useState } from 'react';
import { copy } from '../copy';
import { href } from '../router';
import { useMobile } from '../state/store';
import { BackHeader } from '../ui/Header';
import { useEnableNotifications } from '../push/useEnable';
import { Notice } from '../ui/Notice';

const btn = 'inline-flex min-h-12 w-full items-center justify-center rounded-control border border-line px-4 py-2.5 text-[13px] font-medium';

/** What this phone is connected to; re-pairing is a deliberate, confirmed step. */
export function Connection({ onRepair }: { onRepair: () => void }) {
  const { pcName, device, link } = useMobile();
  const [confirming, setConfirming] = useState(false);
  const t = copy.connection;
  const push = useEnableNotifications();
  const on = push.state === 'granted' || (push.state === 'idle' && typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const pt = copy.notifications;
  return (
    <>
      <BackHeader title={t.title} backTo={href({ name: 'inbox' })} label={t.back} />
      <main className="min-h-0 flex-1 overflow-y-auto px-side pt-5 pb-[22px]">
        <h1 className="sr-only">{t.title}</h1>
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-3 text-[13px]">
          <dt className="text-muted">{t.pc}</dt><dd className="m-0 [overflow-wrap:anywhere]">{pcName ?? t.unknown}</dd>
          <dt className="text-muted">{t.device}</dt><dd className="m-0 [overflow-wrap:anywhere]">{device?.name ?? t.unknown}</dd>
          <dt className="text-muted">{t.status}</dt><dd className="m-0">{t.status_[link]}</dd>
          <dt className="text-muted">{pt.row}</dt><dd className="m-0">{on ? pt.on : pt.off}</dd>
        </dl>
        {!on && (
          <div className="mt-6">
            <button type="button" className={btn} disabled={!push.ready || push.state === 'working'} onClick={() => { void push.start(); }}>{push.state === 'working' ? pt.working : pt.enable}</button>
            <div role="alert" className="min-h-0">
              {push.message && <p className="mt-2.5 rounded-control bg-danger-bg px-3 py-2 text-xs text-danger-fg">{push.message}</p>}
            </div>
          </div>
        )}
        <div className="mt-8">
          {confirming ? (
            <Notice title={t.repairTitle} role="alert">
              <p>{t.repairBody}</p>
              <div className="mt-3 flex flex-col gap-2">
                <button type="button" className={`${btn} border-transparent bg-fg text-[#121415]`} onClick={onRepair}>{t.repairConfirm}</button>
                <button type="button" className={btn} onClick={() => setConfirming(false)}>{t.repairCancel}</button>
              </div>
            </Notice>
          ) : (
            <button type="button" className={btn} onClick={() => setConfirming(true)}>{t.repair}</button>
          )}
        </div>
      </main>
    </>
  );
}
