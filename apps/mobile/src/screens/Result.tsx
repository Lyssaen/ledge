import type { ReactNode } from 'react';
import { copy } from '../copy';
import { headline, type InboxItem } from '../model/requests';
import { href } from '../router';
import { BackHeader } from '../ui/Header';
import { MobileBot } from '../ui/MobileBot';
import { Notice } from '../ui/Notice';

/** The closing screen of a request: what the phone can honestly say, with the request it concerns. */
export function Result({ header, title, body, item, final = false, children }: { header: string; title: string; body: string; item?: InboxItem | undefined; final?: boolean; children?: ReactNode }) {
  const back = href({ name: 'inbox' });
  return (
    <>
      <BackHeader title={header} backTo={back} label={copy.detail.back} />
      <main className="min-h-0 flex-1 overflow-y-auto px-side pb-[22px]">
        <div className="flex flex-col items-start gap-4 pt-7">
          <div className="grid size-14 place-items-center rounded-full border border-ok/20 bg-ok/[0.045] text-ok">
            <svg className="size-[26px] fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          </div>
          {item && (
            <span className="flex items-center gap-2 text-[11px] font-medium tracking-[0.4px] text-muted">
              <MobileBot tool={item.tool} seed={item.botName} />
              <span className="[overflow-wrap:anywhere]">{item.botName} · {item.task}</span>
            </span>
          )}
          <h1 className="text-[25px] leading-[1.25] font-semibold tracking-[-1px] [overflow-wrap:anywhere]">{title}</h1>
          <p className="text-[13px] text-muted">{body}</p>
          {item && (
            <div className="w-full">
              <Notice title={headline(item)}>
                <p className="text-muted [overflow-wrap:anywhere]">{item.repo}{item.branch && <> · <code className="font-mono text-[.9em]">{item.branch}</code></>}</p>
              </Notice>
            </div>
          )}
          {final && <p className="text-[13px] text-muted">{copy.result.final}</p>}
          {children}
          <a href={back} className="inline-flex min-h-12 w-full items-center justify-center rounded-control bg-fg px-4 py-2.5 text-[13px] font-medium text-[#121415]">{copy.result.back}</a>
        </div>
      </main>
    </>
  );
}
