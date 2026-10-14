import { copy } from '../copy';
import { href } from '../router';
import { useMobile } from '../state/store';

/** The PC and the link, with the way to the pairing screen. */
export function LinkStatus() {
  const { link, pcName } = useMobile();
  const off = link === 'offline';
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] whitespace-nowrap text-muted">
      <i className={`inline-block size-1.5 flex-none rounded-full ${off ? 'bg-muted' : 'bg-ok'}`} />
      <span className="truncate">{pcName ? `${pcName} · ` : ''}{off ? copy.link.offline : copy.link.online}</span>
    </div>
  );
}

export function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="flex-none px-side pt-3 pb-[18px]">
      <div className="flex items-center justify-between gap-2.5">
        <LinkStatus />
        <a href={href({ name: 'pair' })} aria-label={copy.link.settings} className="inline-flex h-11 min-w-11 flex-none items-center justify-center rounded-control border border-line">
          <svg className="size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
        </a>
      </div>
      <h1 className="mt-3 text-[29px] leading-[1.15] font-semibold tracking-[-1px]">{title}</h1>
      <p className="mt-2 text-[13px] text-muted">{subtitle}</p>
    </header>
  );
}

/** Back header of the detail screens. */
export function BackHeader({ title, backTo, label }: { title: string; backTo: string; label: string }) {
  return (
    <header className="flex-none border-b border-line px-side pt-2 pb-3">
      <div className="flex items-center gap-2.5">
        <a href={backTo} aria-label={label} className="-ml-2 inline-flex size-11 flex-none items-center justify-center rounded-control">
          <svg className="size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        </a>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <LinkStatus />
      </div>
    </header>
  );
}
