import { useRef } from 'react';
import type { HumanAsk } from '@ledge/protocol';
import { copy } from '../../copy';
import { askEndOf } from '../../model/atoi';
import { goBack } from '../../router';
import { useMobile, type MobileStore } from '../../state/store';
import { BackHeader, linkView } from '../../ui/Header';
import { usePlatform } from '../device';
import { AskCard } from './AskCard';
import { Receipt } from './Receipt';

/**
 * An OpenRig ask in full (m1-a-toi.html §2 « Un appui sur la carte ouvre la demande en entier », §12 portrait): its whole text,
 * its source and « Détails », and the same answers as its card. Once answered, its receipt shows, then `onDone` (the phone goes
 * back to « À toi »; a wide screen opens the next request).
 */
export function AskDetail({ store, id, onDone }: { store: MobileStore; id: string; onDone?: () => void }) {
  const state = useMobile(store);
  const platform = usePlatform();
  const ask = state.asks?.find(a => a.id === id);
  // The ask may leave OpenRig's list while its answer settles: the last version seen still says what it was.
  const last = useRef<HumanAsk | undefined>(undefined);
  if (ask) last.current = ask;
  const shown = ask ?? last.current;
  const done = onDone ?? (() => goBack({ name: 'atoi' }));
  const canConfirm = state.device?.confirm === true && platform;
  const enroll = platform && state.device?.confirm !== true;

  const body = (() => {
    if (shown) {
      return <AskCard store={store} ask={shown} end={askEndOf(id, state.ops)} fresh={state.fresh} ghost={!ask} canConfirm={canConfirm} enroll={enroll} onGone={done} full />;
    }
    // Never say « settled » before OpenRig's list was heard from, nor from a state that is not the PC's now.
    if (state.asks === null || !state.fresh) return <p role="status" className="text-body text-muted">{copy.loading}</p>;
    return <Receipt tone="gone" title={copy.asks.already} />;
  })();

  return (
    <>
      <BackHeader title={copy.atoi.kindName.rig} fallback={{ name: 'atoi' }} label={copy.detail.back} link={linkView(state)} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-4 pb-[22px]">{body}</main>
    </>
  );
}
