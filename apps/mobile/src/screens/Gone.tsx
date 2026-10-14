import { copy } from '../copy';
import type { InboxItem } from '../model/requests';
import { href } from '../router';
import { BackHeader } from '../ui/Header';
import { Result } from './Result';

/**
 * A request that no longer waits. Only `handledElsewhere` may say "already handled on the PC":
 * when the link is down the phone knows nothing newer than its last state (`stale`).
 */
export function Gone({ stale = false, item }: { stale?: boolean; item?: InboxItem | undefined }) {
  if (!stale) return <Result header={copy.gone.header} title={copy.gone.title} body={copy.gone.body} item={item} />;
  const back = href({ name: 'inbox' });
  return (
    <>
      <BackHeader title={copy.gone.header} backTo={back} label={copy.detail.back} />
      <main className="min-h-0 flex-1 overflow-y-auto px-side pt-7">
        <h1 className="text-[25px] leading-[1.25] font-semibold tracking-[-1px]">{copy.gone.staleTitle}</h1>
        <p className="mt-2.5 text-[13px] text-muted">{copy.gone.staleBody}</p>
        <a href={back} className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-control bg-fg px-4 py-2.5 text-[13px] font-medium text-[#121415]">{copy.gone.back}</a>
      </main>
    </>
  );
}
