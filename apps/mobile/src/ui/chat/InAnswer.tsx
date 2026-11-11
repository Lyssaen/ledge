// A request waiting in a session the answer read (m3-chat.html §2, Q30): « À toi »'s own card under the latest answer,
// decided there with the same receipt; a line under an older answer once the request is gone.
import type { PhoneChatStep } from '@ledge/protocol';
import { copy } from '../../copy';
import { cardMode } from '../../model/atoi';
import { outcomeFor } from '../../model/requestOutcome';
import type { InboxItem } from '../../model/requests';
import { href } from '../../router';
import { usePlatform } from '../../screens/device';
import { useSticky } from '../../screens/atoi/Receipt';
import { SessionCard } from '../../screens/atoi/SessionCard';
import { useMobile, type MobileStore } from '../../state/store';
import { IN_ANSWER } from './TurnView';

/** Three cards at most under an answer; the others are in « À toi ». */
export const IN_ANSWER_MAX = 3;
export const requestId = (i: Pick<InboxItem, 'sessionId' | 'key'>) => `${i.sessionId}/${i.key}`;

/** The ids of the sessions an answer read (its « Sources »): the step's own session id, or else its name when no two sessions share it. */
export function sourceIds(steps: readonly PhoneChatStep[], ids: ReadonlyMap<string, string>): Set<string> {
  return new Set(steps.filter(s => s.kind === 'pane' || s.kind === 'reply').flatMap(s => {
    const id = s.id ?? (s.name ? ids.get(s.name) : undefined);
    return id ? [id] : [];
  }));
}

/** The latest answer's cards: the requests waiting now in its sources, each kept as its receipt once decided here. */
export function AnswerRequests({ store, items, onGo }: { store: MobileStore; items: InboxItem[]; onGo?: (() => void) | undefined }) {
  const cards = useSticky(items.slice(0, IN_ANSWER_MAX).map(i => ({ id: requestId(i), value: i })));
  const more = items.length - IN_ANSWER_MAX;
  if (cards.entries.length === 0) return null;
  return (
    <div className={IN_ANSWER}>
      {cards.entries.map(e => <Card key={e.id} store={store} item={e.value} ghost={e.ghost} onGone={() => cards.dismiss(e.id)} onGo={onGo} />)}
      {more > 0 && <a href={href({ name: 'atoi' })} className="text-small text-info underline underline-offset-2">{copy.chat.inAnswer.more(more)}</a>}
    </div>
  );
}

function Card({ store, item, ghost, onGone, onGo }: { store: MobileStore; item: InboxItem; ghost: boolean; onGone: () => void; onGo?: (() => void) | undefined }) {
  const state = useMobile(store);
  const platform = usePlatform();
  const session = state.sessions.get(item.sessionId);
  return (
    <div className="flex flex-col gap-1.5">
      {!ghost && <span className="text-[11.5px] text-muted">{copy.chat.inAnswer.request(item.botName)}</span>}
      <SessionCard
        store={store} item={item} session={session}
        mode={cardMode(item, state.capabilities?.[item.tool], session?.readOnly === true)}
        outcome={outcomeFor(item, [...state.sessions.values()], state.ops)} fresh={state.fresh} ghost={ghost}
        changed={false} onReread={() => {}} canConfirm={state.device?.confirm === true && platform} enroll={platform && state.device?.confirm !== true}
        onGone={onGone} onCheck={onGo}
      />
    </div>
  );
}

/** Under an older answer: the requests shown under it that are gone since, by the session's name. */
export function SettledLines({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className={IN_ANSWER}>
      {names.map(n => <span key={n} className="text-[11.5px] text-muted">{copy.chat.inAnswer.settled} · {n}</span>)}
    </div>
  );
}
