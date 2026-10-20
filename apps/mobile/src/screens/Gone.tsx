import { copy } from '../copy';
import { headline, type InboxItem } from '../model/requests';
import { href } from '../router';
import { useMobile, type MobileStore } from '../state/store';
import { BackHeader, linkView } from '../ui/Header';
import { MobileBot } from '../ui/MobileBot';
import { Notice } from '../ui/Notice';

const PRIMARY = 'inline-flex min-h-12 w-full items-center justify-center rounded-control bg-fg px-4 py-2.5 text-[13px] font-medium text-[#121415]';

/**
 * A request that no longer waits. Only a fresh state may say « already handled on the PC »: offline (`stale`), the
 * phone knows nothing newer than its last state, and says only that the request is no longer in it.
 */
export function Gone({ store, stale = false, item }: { store: MobileStore; stale?: boolean; item?: InboxItem | undefined }) {
  const link = linkView(useMobile(store));
  const back = href({ name: 'inbox' });
  if (stale) {
    return (
      <>
        <BackHeader title={copy.gone.header} backTo={back} label={copy.detail.back} link={link} />
        <main className="min-h-0 flex-1 overflow-y-auto px-side pt-7">
          <h1 className="text-[25px] leading-[1.25] font-semibold tracking-[-1px]">{copy.gone.staleTitle}</h1>
          <p className="mt-2.5 text-[13px] text-muted">{copy.gone.staleBody}</p>
          <a href={back} className={`mt-6 ${PRIMARY}`}>{copy.gone.back}</a>
        </main>
      </>
    );
  }
  return (
    <>
      <BackHeader title={copy.gone.header} backTo={back} label={copy.detail.back} link={link} />
      <main className="min-h-0 flex-1 overflow-y-auto px-side pb-[22px]">
        <div className="flex flex-col items-start gap-4 pt-7">
          {item && (
            <span className="flex items-center gap-2 text-[11px] font-medium tracking-[0.4px] text-muted">
              <MobileBot tool={item.tool} seed={item.sessionId} state="idle" />
              <span className="[overflow-wrap:anywhere]">{item.botName} · {item.task}</span>
            </span>
          )}
          <h1 className="text-[25px] leading-[1.25] font-semibold tracking-[-1px] [overflow-wrap:anywhere]">{copy.gone.title}</h1>
          <p className="text-[13px] text-muted">{copy.gone.body}</p>
          {item && (
            <div className="w-full">
              <Notice title={headline(item)}>
                <p className="text-muted [overflow-wrap:anywhere]">{item.repo}{item.branch && <> · <code className="font-mono text-[.9em]">{item.branch}</code></>}</p>
              </Notice>
            </div>
          )}
          <a href={back} className={PRIMARY}>{copy.gone.back}</a>
          {item && <a href={href({ name: 'thread', sessionId: item.sessionId })} className="inline-flex min-h-12 w-full items-center justify-center rounded-control border border-line px-4 py-2.5 text-[13px] font-medium">{copy.result.thread(item.botName)}</a>}
        </div>
      </main>
    </>
  );
}
