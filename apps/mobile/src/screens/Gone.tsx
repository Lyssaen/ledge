import { copy } from '../copy';
import type { InboxItem } from '../model/requests';
import { href } from '../router';
import { useMobile, type MobileStore } from '../state/store';
import { BackHeader, linkView } from '../ui/Header';
import { Result } from './Result';
import { buttonClass } from '../ui/Button';

const PRIMARY = buttonClass({ variant: 'primary', block: true });

/**
 * A request that no longer waits. Only a fresh state may say « already handled on the PC » (the board's Result,
 * without a decision of this phone's): offline (`stale`), the phone knows nothing newer than its last state, and says
 * only that the request is no longer in it.
 */
export function Gone({ store, stale = false, item }: { store: MobileStore; stale?: boolean; item?: InboxItem | undefined }) {
  const link = linkView(useMobile(store));
  const back = href({ name: 'inbox' });
  if (stale) {
    return (
      <>
        <BackHeader title={copy.gone.header} backTo={back} label={copy.detail.back} link={link} />
        <main className="min-h-0 flex-1 overflow-y-auto pt-7">
          <h1 className="text-display leading-[1.25] font-semibold tracking-[-1px]">{copy.gone.staleTitle}</h1>
          <p className="mt-2.5 text-body text-muted">{copy.gone.staleBody}</p>
          <a href={back} className={`mt-6 ${PRIMARY}`}>{copy.gone.back}</a>
        </main>
      </>
    );
  }
  return <Result store={store} title={copy.gone.title} body={copy.gone.body} item={item} />;
}
