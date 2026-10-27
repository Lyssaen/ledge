import type { ReactNode } from 'react';
import { copy } from '../copy';
import { headline, type InboxItem } from '../model/requests';
import { href } from '../router';
import { useMobile, type MobileStore } from '../state/store';
import { BackHeader, linkView } from '../ui/Header';
import { MobileBot } from '../ui/MobileBot';
import { Notice } from '../ui/Notice';
import { buttonClass } from '../ui/Button';
import { Icon } from '../ui/icons';

/**
 * The closing screen of a request (board « Demande traitée »): what the phone can honestly say, with the request it
 * concerns. `final` says a decision sent from here cannot be taken back; a request handled elsewhere has none.
 */
export function Result({ store, title, body, item, final = false, children }: {
  store: MobileStore; title: string; body: string; item?: InboxItem | undefined; final?: boolean; children?: ReactNode;
}) {
  const link = linkView(useMobile(store));
  const back = href({ name: 'inbox' });
  return (
    <>
      <BackHeader title={copy.result.header} backTo={back} label={copy.detail.back} link={link} />
      <main className="min-h-0 flex-1 overflow-y-auto pb-[22px]">
        <div className="flex flex-col items-start gap-4 pt-7">
          <div className="grid size-14 place-items-center rounded-full border border-ok/20 bg-ok/10 text-ok">
            <Icon name="check" className="size-[26px]" />
          </div>
          {item && (
            <span className="flex items-center gap-2 text-[11px] font-medium tracking-[0.4px] text-muted">
              <MobileBot tool={item.tool} seed={item.sessionId} state="idle" />
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
          <a href={back} className={buttonClass({ variant: 'primary', block: true })}>{copy.result.back}</a>
          {item && <a href={href({ name: 'thread', sessionId: item.sessionId })} className={buttonClass({ block: true })}>{copy.result.thread(item.botName)}</a>}
        </div>
      </main>
    </>
  );
}
