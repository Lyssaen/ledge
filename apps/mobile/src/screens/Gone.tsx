import { copy } from '../copy';
import { href } from '../router';
import { BackHeader } from '../ui/Header';

/** A link to a request that no longer waits (decided on the PC, or an old notification). */
export function Gone({ stale = false }: { stale?: boolean }) {
  const back = href({ name: 'inbox' });
  return (
    <>
      <BackHeader title={copy.gone.header} backTo={back} label={copy.detail.back} />
      <main className="min-h-0 flex-1 overflow-y-auto px-side pt-7">
        <h1 className="text-[25px] leading-[1.25] font-semibold tracking-[-1px]">{stale ? copy.gone.staleTitle : copy.gone.title}</h1>
        <p className="mt-2.5 text-[13px] text-muted">{stale ? copy.gone.staleBody : copy.gone.body}</p>
        <a href={back} className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-control bg-fg px-4 py-2.5 text-[13px] font-medium text-[#121415]">{copy.gone.back}</a>
      </main>
    </>
  );
}
