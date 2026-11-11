import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import { copy } from '../copy';
import type { Reach } from '../link/link';
import { href, navigate, type Route } from '../router';
import { useBusy } from '../useBusy';
import { Icon, type IconName } from '../ui/icons';
import { useWide } from '../ui/layout';
import { kitButtonClass } from '../ui/kit/Controls';
import { PHONE_TABS, isRoot, rootOf, tabHref, type Tab } from './tabs';

/*
 * The app's shell (docs/mockups/ledge-mobile-refonte/m0-socle.html): on a phone, the header of the five tabs and the tab bar;
 * on a wide screen, the rail and each list's head; everywhere, the banner of a PC that does not answer and the loading state.
 */

/** How the PC looks from here: `online`, the state shown is the PC's now; `reconnecting`, the last known one while the link
 *  comes back; `offline`, the PC or the relay does not answer; `loading`, nothing known yet. */
export type Look = 'online' | 'reconnecting' | 'offline' | 'loading';

export interface ShellLink {
  /** The PC's name, as the pill shows it; null when not known. */
  pc: string | null;
  look: Look;
  reach: Reach;
  /** When the state shown was received (« 14:02 »), '' when never. */
  since: string;
  retry: () => void;
}

export function lookOf(fresh: boolean, synced: boolean, reach: Reach): Look {
  if (fresh) return 'online';
  if (reach === 'pc_offline' || reach === 'relay_unreachable') return 'offline';
  return synced ? 'reconnecting' : 'loading';
}

const Ctx = createContext<ShellLink>({ pc: null, look: 'online', reach: 'pc_online', since: '', retry: () => {} });
export const ShellProvider = Ctx.Provider;
export const useShell = (): ShellLink => useContext(Ctx);

/** The PC's name as the pill shows it: cut at 14 characters with « … ». */
export const hostName = (pc: string | null): string => {
  const name = pc ?? copy.host.unknown;
  return name.length > 14 ? `${name.slice(0, 13)}…` : name;
};

/** The Ledge mark: a black square, a white L, a red dot, the same in both themes (Desktop's LedgeMark). */
export function LedgeMark({ size = 24 }: { size?: number }) {
  return (
    <svg data-ledge-mark width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="flex-none">
      <rect width="16" height="16" rx="3.5" fill="#0A0A0A" />
      <rect x="3" y="3" width="3" height="10" rx=".5" fill="#FAFAFA" />
      <rect x="7" y="10" width="6" height="3" rx=".5" fill="#FAFAFA" />
      <circle cx="10" cy="6" r="2" fill="#FF6467" />
    </svg>
  );
}

/** The host pill: the PC's name and how it answers. A tap opens Réglages › Connexion; it is not a host picker (Q6). */
export function HostPill() {
  const { pc, look } = useShell();
  const name = hostName(pc);
  const off = look === 'offline';
  return (
    <a
      href={href({ name: 'connection', section: 'link' })} data-host={look} aria-label={copy.host.label(pc ?? copy.host.unknown, look)}
      className={`inline-flex h-[26px] flex-none items-center gap-1.5 rounded-full border px-2.5 text-small whitespace-nowrap ${off ? 'border-attention/45 text-attention' : 'border-input text-muted'}`}
    >
      {look === 'loading'
        ? <span aria-hidden="true" className="inline-block size-2.5 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" />
        : <span aria-hidden="true" className={`inline-block size-2 flex-none rounded-full ${look === 'online' ? 'bg-ok' : off ? 'bg-attention' : 'bg-muted'}`} />}
      {off ? copy.host.offline(name) : name}
    </a>
  );
}

/** The header of the five tabs on a phone: the mark, the host pill, Réglages. */
export function TopBar() {
  return (
    <header className="bleed flex h-14 flex-none items-center gap-1.5 border-b border-line pr-1.5 pl-4">
      <span className="mr-1 flex items-center gap-2 text-[17px] font-semibold"><LedgeMark />{copy.brand}</span>
      <HostPill />
      <span className="flex-1" />
      <a href={href({ name: 'connection' })} aria-label={copy.nav.settings} title={copy.nav.settings} className="grid size-11 flex-none place-items-center rounded-lg text-muted active:bg-raised">
        <Icon name="gear" />
      </a>
    </header>
  );
}

/** A tab's badge: red, or amber for questions only. */
export type TabBadge = { text: string; tone: 'red' | 'amber' } | null;

function Badge({ badge, className }: { badge: TabBadge; className: string }) {
  if (!badge) return null;
  return (
    <span data-badge={badge.tone} className={`absolute h-4 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold ${badge.tone === 'red' ? 'bg-primary text-primary-fg' : 'bg-attention text-[#1c1100]'} ${className}`}>
      {badge.text}
    </span>
  );
}

const ICON: Record<Tab, IconName> = { atoi: 'inbox', sessions: 'sessions', prs: 'pr', rigs: 'rigs', chat: 'ledge', atelier: 'atelier' };

/**
 * A tap on a tab: to the screen it was left on. On the tab already shown, its list back to the top, then, a second time, the
 * tab's first screen (after a thread or a request opened beside it).
 */
function useTabTap(route: Route) {
  return (t: Tab, lit: boolean) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (!lit || route.name === 'connection') return;
    e.preventDefault();
    const list = document.querySelector<HTMLElement>('[data-tab-scroll]');
    if (list && list.scrollTop > 0) list.scrollTo({ top: 0, behavior: 'smooth' });
    else if (!isRoot(route)) navigate(rootOf(t));
  };
}

/**
 * The phone's five tabs, fixed, in this order. `active`: the tab lit (under Réglages, the one it was opened from). A phone on
 * its side shows them as a narrow rail on the left (styles.css, `.tabbar`).
 */
export function TabBar({ route, active, badges }: { route: Route; active: Tab | null; badges: Partial<Record<Tab, TabBadge>> }) {
  const tap = useTabTap(route);
  return (
    <nav aria-label={copy.nav.label} className="tabbar bleed grid flex-none grid-cols-5 border-t border-line bg-sidebar">
      {PHONE_TABS.map(t => (
        <a key={t} href={tabHref(t)} onClick={tap(t, active === t)} aria-current={active === t ? 'page' : undefined} className="tab group relative flex flex-col items-center justify-center gap-[3px] text-[11px] leading-[13px] text-muted aria-[current=page]:font-medium aria-[current=page]:text-fg">
          <span className="pad grid h-7 w-[52px] place-items-center rounded-full group-aria-[current=page]:bg-raised"><Icon name={ICON[t]} /></span>
          {copy.nav[t]}
          <Badge badge={badges[t] ?? null} className="top-[3px] left-1/2 ml-[7px]" />
        </a>
      ))}
    </nav>
  );
}

/**
 * The tablet's rail, 76 px on the left: the mark, the tabs and the Atelier (when the PC sends its projects), then, apart at the
 * bottom, Ledge and Réglages.
 */
export function Rail({ route, active, badges, atelier }: { route: Route; active: Tab | 'settings' | null; badges: Partial<Record<Tab, TabBadge>>; atelier: boolean }) {
  const tap = useTabTap(route);
  const item = (t: Tab) => (
    <a key={t} href={tabHref(t)} onClick={tap(t, active === t)} aria-current={active === t ? 'page' : undefined} className="rb">
      <Icon name={ICON[t]} />
      {copy.nav[t]}
      <Badge badge={badges[t] ?? null} className="top-[3px] right-[7px]" />
    </a>
  );
  return (
    <nav aria-label={copy.nav.label} className="rail">
      <span className="mb-2"><LedgeMark size={30} /></span>
      {(['atoi', 'sessions', 'prs', 'rigs'] as const).map(item)}
      {atelier && item('atelier')}
      <span className="flex-1" />
      {item('chat')}
      <span aria-hidden="true" className="my-1.5 h-px w-[34px] bg-line" />
      <a href={href({ name: 'connection' })} aria-current={active === 'settings' ? 'page' : undefined} className="rb">
        <Icon name="gear" />
        {copy.nav.settings}
      </a>
    </nav>
  );
}

/**
 * The banner at the top of a tab's content when the PC or the relay does not answer: what is shown is the last known state.
 * `body`: a tab's own sentence for a PC that does not answer (the Rigs tab: nothing can be started or stopped).
 */
export function LinkStrip({ body }: { body?: ((since: string) => string) | undefined } = {}) {
  const { pc, look, reach, since, retry } = useShell();
  const [busy, setBusy] = useBusy();
  if (look !== 'offline') return null;
  const relay = reach === 'relay_unreachable';
  return (
    <section role="status" data-strip={relay ? 'relay' : 'pc'} className="strip flex flex-none items-start gap-[9px] rounded-lg border border-attention/40 px-3 py-2.5 text-[13px] leading-[18px]">
      <Icon name={relay ? 'cloud' : 'wifioff'} className="mt-px size-4 text-attention" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <b className="font-semibold">{relay ? copy.compare.relayTitle : copy.offline.title(pc)}</b>
        <span className="text-muted">{relay ? copy.compare.relayBody : since ? (body ?? copy.offline.body)(since) : copy.offline.bodyUnknown}</span>
        <button type="button" disabled={busy} onClick={() => { setBusy(true); retry(); }} className={kitButtonClass({ size: 'sm', className: 'self-start' })}>
          <Icon name="refresh" className="size-4" />{copy.offline.retry}
        </button>
      </div>
    </section>
  );
}

/** Two cards in outline while the PC's first state comes (§4, « Chargement »). */
function Loading() {
  const sk = 'block animate-[ledge-pulse_1.6s_ease-in-out_infinite] rounded-[5px] bg-raised';
  return (
    <div aria-hidden="true" data-loading="" className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3">
        <div className="flex items-center gap-[7px]"><span className={`${sk} h-4 w-[26px]`} /><span className={`${sk} h-3.5 w-20`} /><span className="flex-1" /><span className={`${sk} h-4 w-[70px]`} /></div>
        <span className={`${sk} h-[34px]`} />
        <div className="grid grid-cols-2 gap-2"><span className={`${sk} h-11`} /><span className={`${sk} h-11`} /></div>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3">
        <div className="flex items-center gap-[7px]"><span className={`${sk} h-4 w-[26px]`} /><span className={`${sk} h-3.5 w-[110px]`} /></div>
        <span className={`${sk} h-3.5 w-[85%]`} />
      </div>
    </div>
  );
}

/**
 * A tab's page. On a phone: the banner, then the tab's title and what it says, then its content. On a wide screen, the list's
 * head carries the title, the host pill beside it. Before the PC's first state, its outline instead of the content.
 */
export function TabPage({ title, subtitle, wideSubtitle, children, bodyClassName = 'flex flex-col gap-3', offlineBody }: {
  title: string; subtitle?: string | undefined;
  /** What the list's head says beside the title on a wide screen (« 3 demandes »); only the tabs whose mockup shows it give one. */
  wideSubtitle?: string | undefined;
  children: ReactNode; bodyClassName?: string;
  /** The offline strip's words for this tab (M4: « Dernier état connu · … »). */
  offlineBody?: (since: string) => string;
}) {
  const wide = useWide();
  const { pc, look } = useShell();
  const loading = look === 'loading';
  return (
    <>
      {wide && (
        <div className="pane-head flex h-[58px] flex-none items-center gap-2 border-b border-line pr-1.5 pl-4">
          <h1 className="text-lg font-semibold">{title}</h1>
          {wideSubtitle && <span className="min-w-0 truncate text-small text-muted">{wideSubtitle}</span>}
          <HostPill />
        </div>
      )}
      <main data-tab-scroll="" className="tab-main flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pt-3.5 pb-[18px]">
        <LinkStrip body={offlineBody} />
        {!wide && (
          <div className="flex flex-none items-baseline gap-2">
            <h1 className="text-[22px] leading-7 font-semibold tracking-[-.02em]">{title}</h1>
            {(loading || subtitle) && <span className="min-w-0 truncate text-[12.5px] text-muted">{loading ? copy.link.connecting(hostName(pc)) : subtitle}</span>}
          </div>
        )}
        {loading ? <Loading /> : <div className={`flex-none ${bodyClassName}`}>{children}</div>}
      </main>
    </>
  );
}
