import { copy } from '../copy';
import { useBusy } from '../useBusy';
import { Board, Fill, H1, ICON, OUTLINE } from '../ui/Board';
import { buttonClass } from '../ui/Button';

/**
 * Board Offline: the PC is not on the relay. Shown at the top of the last known inbox; « Réessayer » tries the link
 * again at once (a hello, or a new socket) instead of waiting for the next backoff.
 */
export function Offline({ pcName, since, onRetry }: { pcName: string | null; since: string; onRetry: () => void }) {
  const [busy, setBusy] = useBusy();
  return (
    <section role="status" className="rounded-control border border-attention/15 bg-attention/[0.045] p-4 text-[13px] leading-[1.6]">
      <div className="mb-1.5 flex items-center gap-2.5">
        <svg className={`${ICON} text-attention`} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h.01" /><path d="M8.5 16.43a5 5 0 0 1 7 0" /><path d="M5 12.86a10 10 0 0 1 5.17-2.69" /><path d="M19 12.86a10 10 0 0 0-1.86-1.29" /><path d="M2 8.82a15 15 0 0 1 4.18-2.66" /><path d="M22 8.82a15 15 0 0 0-11.29-3.76" /><path d="m2 2 20 20" /></svg>
        <strong className="text-[15px]">{copy.offline.title(pcName)}</strong>
      </div>
      <p className="text-muted">{since ? copy.offline.body(since) : copy.offline.bodyUnknown}</p>
      <button type="button" disabled={busy} onClick={() => { setBusy(true); onRetry(); }} className={buttonClass({ block: true, className: 'mt-3' })}>
        <svg className={`${ICON} size-4`} viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></svg>
        {copy.offline.retry}
      </button>
    </section>
  );
}

/** Another tab of this phone took the relay's socket: this one stays quiet until asked to take it back. */
export function Replaced({ onHere }: { onHere: () => void }) {
  return (
    <Board top="pt-40">
      <div className="flex flex-col gap-2 text-center">
        <h1 className={H1}>{copy.replaced.title}</h1>
        <p className="text-muted">{copy.replaced.body}</p>
      </div>
      <Fill />
      <button type="button" onClick={onHere} className={OUTLINE}>{copy.replaced.here}</button>
    </Board>
  );
}
