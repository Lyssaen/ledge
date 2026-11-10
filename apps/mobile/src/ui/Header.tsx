import { copy } from '../copy';
import { backTarget, goBack, href, type Route } from '../router';
import type { MobileState } from '../state/store';
import { iconButtonClass } from './Button';
import { Icon } from './icons';

/** What the header says of the link: whether the state shown is the PC's now, and the PC's name. */
export interface LinkView { fresh: boolean; pc: string | null }
export const linkView = (s: Pick<MobileState, 'fresh' | 'daemon'>): LinkView => ({ fresh: s.fresh, pc: s.daemon?.name ?? null });


/** The PC and the link, with the way to the connection screen. */
export function LinkStatus({ link }: { link: LinkView }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-meta whitespace-nowrap text-muted">
      <i className={`inline-block size-1.5 flex-none rounded-full ${link.fresh ? 'bg-ok' : 'bg-muted'}`} />
      <span className="truncate">{link.pc ? `${link.pc} · ` : ''}{link.fresh ? copy.link.online : copy.link.offline}</span>
    </div>
  );
}

/**
 * « Retour »: to the screen the user came from in the app, named after it; opened from outside (a shared link, a
 * notification), to `fallback`, named by `label`.
 */
export function BackLink({ fallback, label }: { fallback: Route; label: string }) {
  const to = backTarget(fallback);
  const name = !to.inApp ? label : to.known ? copy.nav.backTo[to.route.name] ?? copy.nav.back : copy.nav.back;
  return (
    <a href={href(to.route)} data-back={fallback.name} aria-label={name} title={name} onClick={e => { e.preventDefault(); goBack(fallback); }} className={iconButtonClass({ className: '-ml-2' })}>
      <Icon name="back" />
    </a>
  );
}

/** Back header of the detail screens. */
export function BackHeader({ title, fallback, label, link }: { title: string; fallback: Route; label: string; link: LinkView }) {
  return (
    <header className="flex-none border-b border-line pt-2 pb-3">
      <div className="flex items-center gap-2.5">
        <BackLink fallback={fallback} label={label} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <LinkStatus link={link} />
      </div>
    </header>
  );
}
