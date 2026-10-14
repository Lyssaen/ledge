import { tildePath } from '@ledge/client';
import { copy } from '../copy';
import { ageLabel, headline, requestsOf } from '../model/requests';
import { href } from '../router';
import { useMobile } from '../state/store';
import { Badge } from '../ui/Badge';
import { Command } from '../ui/Command';
import { BackHeader } from '../ui/Header';
import { MobileBot } from '../ui/MobileBot';
import { LostBanner } from '../ui/Notice';
import { Gone } from './Gone';
import { useNow } from '../useNow';

const btn = 'inline-flex min-h-12 flex-1 items-center justify-center rounded-control border border-line px-4 py-2.5 text-[13px] leading-[1.4] font-medium disabled:opacity-45';

/** One request, read only: decisions from the phone arrive with lot 2. */
export function RequestDetail({ sessionId, pendingId, onReconnect }: { sessionId: string; pendingId: string; onReconnect: () => void }) {
  const { sessions, previews, link, syncedAt } = useMobile();
  const now = useNow();
  const item = requestsOf(sessions).find(i => i.sessionId === sessionId && i.pendingId === pendingId);
  if (!item) {
    // Nothing synced yet: the first snapshot is still on its way, so say nothing about the request.
    if (syncedAt === null && link !== 'offline') {
      return (
        <>
          <BackHeader title={copy.gone.header} backTo={href({ name: 'inbox' })} label={copy.detail.back} />
          <main className="min-h-0 flex-1 px-side pt-7 text-[13px] text-muted" role="status">{copy.loading}</main>
        </>
      );
    }
    return <Gone stale={link === 'offline'} />;
  }
  const session = sessions.find(s => s.id === sessionId)!;
  const lines = (previews[sessionId] ?? []).slice(-12);
  const offline = link === 'offline';
  return (
    <>
      <BackHeader title={copy.detail.heading[item.kind]} backTo={href({ name: 'inbox' })} label={copy.detail.back} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-side pb-[22px]">
        <div className="mt-4 flex items-start gap-3 rounded-[14px] border border-line bg-surface p-3.5">
          <MobileBot tool={item.tool} seed={item.botName} />
          <div className="min-w-0 flex-1">
            <strong className="block text-[13px] [overflow-wrap:anywhere]">{item.task}</strong>
            <p className="mt-0.5 text-[11px] text-muted">{item.botName} · {copy.tools[item.tool]}</p>
            <p className="mt-0.5 text-[11px] [overflow-wrap:anywhere] text-muted">{item.repo}{item.branch && <> · <code className={`font-mono text-[.9em] ${item.worktree ? 'underline decoration-dotted underline-offset-2' : ''}`}>{item.branch}</code></>}</p>
          </div>
        </div>
        <div className="mt-[22px] mb-3">
          <Badge kind={item.kind} />
          <h1 className="mt-2.5 text-[25px] leading-[1.25] font-semibold tracking-[-1px] [overflow-wrap:anywhere]">{item.kind === 'permission' ? copy.detail.commandTitle : headline(item)}</h1>
          {item.reason && <p className="mt-2.5 text-[13px] text-muted">{item.reason}</p>}
        </div>
        {item.kind !== 'question' && item.text && <Command text={item.text} />}
        {item.options && item.options.length > 0 && (
          <ul aria-label={copy.detail.options} className="my-3.5 flex list-none flex-col gap-2 p-0">
            {item.options.map(o => <li key={o} className="rounded-control border border-line bg-surface px-3 py-3 text-[13px] [overflow-wrap:anywhere]">{o}</li>)}
          </ul>
        )}
        <dl className="my-[18px] grid grid-cols-[74px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-xs">
          <dt className="text-muted">{copy.detail.folder}</dt><dd className="m-0 [overflow-wrap:anywhere]"><code className="font-mono text-[.9em]">{tildePath(session.cwd)}</code></dd>
          {item.branch && <><dt className="text-muted">{copy.detail.branch}</dt><dd className="m-0 [overflow-wrap:anywhere]"><code className="font-mono text-[.9em]">{item.branch}</code></dd></>}
          <dt className="text-muted">{copy.detail.asked}</dt><dd className="m-0">{copy.detail.ago(ageLabel(item.since, now))}</dd>
        </dl>
        {lines.length > 0 && (
          <details className="group mt-[18px] border-t border-line">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-xs [&::-webkit-details-marker]:hidden">{copy.detail.context}</summary>
            <pre className="pt-2 pb-4 font-mono text-xs leading-[1.7] break-words whitespace-pre-wrap text-muted [overflow-wrap:anywhere]">{lines.join('\n')}</pre>
          </details>
        )}
        {offline && <div className="mt-4"><LostBanner detail={copy.link.lostDetail} onReconnect={onReconnect} /></div>}
      </main>
      <footer className="flex flex-none flex-col gap-2.5 border-t border-line bg-bg px-side pt-3 pb-4">
        <div className="flex gap-2.5">
          <button type="button" disabled className={btn}>{copy.detail.deny}</button>
          <button type="button" disabled className={`${btn} border-transparent bg-fg text-[#121415]`}>{copy.detail.allow}</button>
        </div>
        <p className="text-center text-[10px] text-muted">{copy.detail.notYet}</p>
      </footer>
    </>
  );
}
