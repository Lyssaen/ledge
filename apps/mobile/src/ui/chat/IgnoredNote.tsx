import { copy } from '../../copy';
import type { MobileStore } from '../../state/store';
import { GHOST } from './RelayCard';

const clock = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** A card of a turn set aside (« Ignorer », on this phone or any other device, or on the PC): nothing of it applies until « Revoir ». */
/** `rest`: rows of the card already went (a launched session), the note speaks of the others. */
export function IgnoredNote({ store, qid, at, rest }: { store: MobileStore; qid: string; at: string; rest?: boolean }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 px-1 text-small text-muted">
      {rest ? copy.chat.ignoredRest(clock(at)) : copy.chat.action.ignored(1, clock(at), { done: 0, denied: 0, failed: 0 })}
      <button type="button" className={GHOST} onClick={() => { void store.ignoreTurn(qid, true); }}>{copy.chat.review}</button>
    </p>
  );
}
