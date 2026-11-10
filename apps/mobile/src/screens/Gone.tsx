import { useEffect, type ReactNode } from 'react';
import { copy } from '../copy';
import { decidedFrom } from '../model/thread';
import { clock } from './Inbox';
import type { InboxItem } from '../model/requests';
import { href } from '../router';
import { useMobile, type MobileStore } from '../state/store';
import { BackHeader, linkView } from '../ui/Header';
import { Result } from './Result';
import { buttonClass } from '../ui/Button';

const PRIMARY = buttonClass({ variant: 'primary', block: true });

/**
 * What is no longer there: a request that no longer waits, said handled where the thread says it was (the PC, this device,
 * another one by its name), « ailleurs » when it does not say.
 * Only a fresh state may say it is handled (the board's Result, without a decision of this device's):
 * offline (`stale`), the phone knows nothing newer than its last state, and says only that it is no longer in it.
 */
/** `panel`: in the Atelier's panel, its own head, and the way back to the thread instead of the requests. */
export function Gone({ store, stale = false, item, panel }: { store: MobileStore; stale?: boolean; item?: InboxItem | undefined; panel?: { header: ReactNode; back: { href: string; label: string } } }) {
  const state = useMobile(store);
  const link = linkView(state);
  const sessionId = item?.sessionId;
  const known = sessionId !== undefined && state.threads.has(sessionId);
  // The PC's own record of who answered this very request (its key), for a permission or a question alike.
  const last = item ? state.sessions.get(item.sessionId)?.lastAnswer : undefined;
  const recorded = !!item && !!last && last.key === item.key;
  // An older PC says it only in the thread, for a permission: asked when it is not here yet.
  useEffect(() => { if (!stale && !recorded && sessionId !== undefined && !known) store.openThread(sessionId); }, [stale, recorded, sessionId, known, store]);
  const back = href({ name: 'atoi' });
  const backRoute = { name: 'atoi' } as const;
  if (stale) {
    return (
      <>
        {panel ? panel.header : <BackHeader title={copy.gone.header} fallback={backRoute} label={copy.detail.back} link={link} />}
        <main className="min-h-0 flex-1 overflow-y-auto pt-7">
          <h1 className="text-display leading-[1.25] font-semibold tracking-[-1px]">{copy.gone.staleTitle}</h1>
          <p className="mt-2.5 text-body text-muted">{copy.gone.staleBody}</p>
          <a href={panel?.back.href ?? back} className={`mt-6 ${PRIMARY}`}>{panel?.back.label ?? copy.gone.back}</a>
        </main>
      </>
    );
  }
  if (item && last && recorded) {
    const where = last.by.kind === 'pc' ? copy.thread.event.fromPc : last.by.id === state.device?.id ? copy.thread.event.fromHere : copy.thread.event.fromDevice(last.by.name);
    return <Result store={store} title={copy.gone.titleOn(where)} body={last.decision ? copy.gone.decided(last.decision, clock(last.at)) : copy.gone.answered(clock(last.at))} item={item} />;
  }
  // An older PC: its thread, for a permission.
  const answered = item && item.kind === 'permission' ? [...(state.threads.get(item.sessionId)?.items ?? [])].reverse()
    .find((i): i is Extract<typeof i, { kind: 'permission' }> => i.kind === 'permission' && i.text === item.text && i.decision !== undefined && i.decision !== 'unknown') : undefined;
  if (!answered || answered.decision === undefined || answered.decision === 'unknown') return <Result store={store} title={copy.gone.titleElsewhere} body={copy.gone.body} item={item} />;
  const where = decidedFrom(answered, item!.sessionId, state.ops, state.device?.id ?? null);
  return <Result store={store} title={copy.gone.titleOn(where)} body={copy.gone.decided(answered.decision, clock(answered.at))} item={item} />;
}
