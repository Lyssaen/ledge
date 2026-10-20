import { copy } from '../copy';
import type { PinnedPc } from '../link/keys';
import { groupFingerprint } from '../model/fingerprint';
import { Board, Fill, H1, ICON, OUTLINE, PRIMARY } from '../ui/Board';

const K = copy.keyChanged;
/** « 16 oct. », the day the PC was pinned. */
const pinnedOn = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? copy.connection.unknown : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

/** Board KeyChanged: the PC answered with another key. Nothing is sent or shown until the phone is linked again. */
export function KeyChanged({ pcName, known, received, onRelink, onSignOut }: {
  pcName: string | null; known: PinnedPc | null; received: string | null; onRelink: () => void; onSignOut: () => void;
}) {
  return (
    <Board>
      <div className="flex flex-col gap-3.5">
        <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-full bg-danger-bg text-danger-fg">
          <svg className={ICON} viewBox="0 0 24 24"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>
        </span>
        <h1 className={H1}>{K.title(pcName ?? copy.yourPc)}</h1>
        <p className="text-muted">{K.body}</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 rounded-control border border-line bg-surface p-4 text-[13px]">
        <dt className="text-muted">{K.known}</dt>
        <dd className="font-mono">{known ? K.knownDetail(groupFingerprint(known.fingerprint, 2), pinnedOn(known.pinnedAt)) : copy.connection.unknown}</dd>
        <dt className="text-muted">{K.received}</dt>
        <dd className="font-mono">{received ? K.receivedDetail(groupFingerprint(received, 2)) : copy.connection.unknown}</dd>
      </dl>
      <div className="flex flex-col gap-3 text-[13px] leading-[1.6] text-muted">
        <p><strong className="text-fg">{K.reinstalledTitle}</strong> {K.reinstalledBody}</p>
        <p><strong className="text-fg">{K.otherwise}</strong> {K.warning}</p>
      </div>
      <Fill />
      <div className="flex flex-col gap-3">
        <button type="button" onClick={onRelink} className={PRIMARY}>{K.relink}</button>
        <button type="button" onClick={onSignOut} className={OUTLINE}>{K.signOut}</button>
      </div>
    </Board>
  );
}
