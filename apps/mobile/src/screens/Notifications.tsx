import { useState } from 'react';
import { copy } from '../copy';
import { disablePush, enablePush, pushSupport, type EnableResult } from '../push/subscribe';
import { href, navigate } from '../router';
import { useMobile, type MobileStore } from '../state/store';
import { Notice } from '../ui/Notice';
import { OUTLINE, PRIMARY } from '../ui/Board';

const N = copy.notifications;

const failure = (r: EnableResult): string | null =>
  r === 'denied' ? N.denied : r === 'unsupported' ? N.unsupported : r === 'unavailable' ? N.noPush : r === 'failed' ? N.failed : null;

/** Turning notifications on or off, and what went wrong. Nothing for a PC that does not say (`device.push` absent). */
function useNotifications(store: MobileStore, fetchImpl?: typeof fetch) {
  const push = useMobile(store).device?.push;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The permission is asked inside the tap: `enablePush` calls it before anything is awaited.
  const enable = async (): Promise<EnableResult> => {
    if (busy) return 'failed';
    setBusy(true);
    setProblem(null);
    const r = await enablePush(store, fetchImpl);
    setBusy(false);
    setProblem(failure(r));
    return r;
  };
  const disable = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    await disablePush(store);
    setBusy(false);
  };
  return { push, busy, problem, enable, disable };
}

/** The row of Connection: « Notifications », « Activées » or « Désactivées », with a switch. */
export function NotificationsRow({ store, fetchImpl }: { store: MobileStore; fetchImpl?: typeof fetch }) {
  const n = useNotifications(store, fetchImpl);
  if (!n.push) return null;
  const on = n.push === 'on';
  return (
    <div className="flex flex-col gap-2 border-b border-line px-4 py-3 text-body last:border-b-0">
      <div className="flex items-center justify-between gap-4">
        <dt className="flex-none text-muted">{N.row}</dt>
        <dd className="flex min-w-0 items-center gap-3 text-right">
          {n.push === 'unavailable' ? <span>{N.noPush}</span> : (
            <>
              <span>{on ? N.on : N.off}</span>
              <button
                type="button" role="switch" aria-checked={on} aria-label={N.row} disabled={n.busy}
                onClick={() => { void (on ? n.disable() : n.enable()); }}
                className={`relative h-6 w-10 flex-none rounded-full border border-line transition-colors disabled:opacity-45 ${on ? 'border-transparent bg-ok' : 'bg-raised'}`}
              >
                <span className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow-sm transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} aria-hidden="true" />
              </button>
            </>
          )}
        </dd>
      </div>
      {n.push === 'stale' && (
        <div className="flex flex-col items-end gap-2">
          <p className="text-muted">{N.stale}</p>
          <button type="button" disabled={n.busy} onClick={() => { void n.enable(); }} className="inline-flex min-h-10 items-center justify-center rounded-control border border-line px-3 font-medium disabled:opacity-45">{N.enable}</button>
        </div>
      )}
      {n.problem && <Notice title={n.problem} tone="warning" role="alert" />}
    </div>
  );
}

/** Whether the step is worth showing: the PC can push, nothing is on yet, and this browser can. */
export const offersNotifications = (push: 'on' | 'off' | 'stale' | 'unavailable' | undefined): boolean =>
  (push === 'off' || push === 'stale') && pushSupport() !== 'unsupported';

/** The step after « Protéger les accords »: « Être prévenu quand un agent attend », then the way to the inbox. */
export function NotifyStep({ store, onDone, fetchImpl }: { store: MobileStore; onDone: () => void; fetchImpl?: typeof fetch }) {
  const n = useNotifications(store, fetchImpl);
  const fresh = useMobile(store).fresh;
  const go = () => {
    void n.enable().then(r => { if (r === 'on') { navigate({ name: 'inbox' }); onDone(); } });
  };
  return (
    <>
      <section aria-labelledby="notify-title" className="flex flex-col gap-3 rounded-control border border-line bg-surface p-4">
        <h2 id="notify-title" className="text-title leading-[1.35] font-semibold">{N.title}</h2>
        <p className="text-body leading-[1.6] text-muted">{N.body}</p>
        {n.problem && <Notice title={n.problem} tone="warning" role="alert" />}
        <button type="button" disabled={n.busy || !fresh} onClick={go} className={PRIMARY}>{n.busy ? N.working : fresh ? N.enable : N.waiting}</button>
      </section>
      <a href={href({ name: 'inbox' })} onClick={onDone} className={OUTLINE}>{N.later}</a>
    </>
  );
}
