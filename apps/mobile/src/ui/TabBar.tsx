import { copy } from '../copy';
import { href } from '../router';

const ICON = 'size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]';
const tab = (on: boolean) => `flex min-h-12 items-center justify-center gap-2 rounded-control text-[13px] ${on ? 'bg-white/[0.03] text-fg' : 'text-muted'}`;

/** « À traiter » and « Agents »; `count` is the number of requests waiting. */
export function TabBar({ count, active = 'inbox' }: { count: number; active?: 'inbox' | 'agents' }) {
  return (
    <nav aria-label={copy.nav.label} className="grid flex-none grid-cols-2 border-t border-line bg-bg px-side pt-2 pb-3">
      <a href={href({ name: 'inbox' })} aria-current={active === 'inbox' ? 'page' : undefined} className={tab(active === 'inbox')}>
        <svg className={ICON} viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z" /></svg>
        {copy.nav.inbox}
        {count > 0 && <span className="inline-grid h-[19px] min-w-[19px] place-items-center rounded-md bg-attention px-[5px] text-[10px] font-bold text-[#201b11]">{count}</span>}
      </a>
      <a href={href({ name: 'agents' })} aria-current={active === 'agents' ? 'page' : undefined} className={tab(active === 'agents')}>
        <svg className={ICON} viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v13H9l-5 4z" /></svg>
        {copy.nav.agents}
      </a>
    </nav>
  );
}
