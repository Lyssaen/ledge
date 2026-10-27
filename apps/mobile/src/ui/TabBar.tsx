import { copy } from '../copy';
import { href } from '../router';
import { Icon } from './icons';

const tab = (on: boolean) => `flex min-h-12 items-center justify-center gap-2 rounded-control text-body transition-colors duration-100 active:bg-raised ${on ? 'bg-raised text-fg' : 'text-muted'}`;

/**
 * « Ledge » first when the PC offers the chat (ledge home spec §2.4), then « À traiter » and « Agents »; `count` is what waits there.
 * A phone on its side shows it as a rail on the left (`.tabbar`, styles.css).
 */
export function TabBar({ count, active = 'inbox', chat = false }: { count: number; active?: 'inbox' | 'agents' | 'chat'; chat?: boolean }) {
  return (
    <nav aria-label={copy.nav.label} className={`tabbar grid flex-none ${chat ? 'grid-cols-3' : 'grid-cols-2'} border-t border-line bg-bg pt-2 pb-3`}>
      {chat && (
        <a href={href({ name: 'chat' })} aria-current={active === 'chat' ? 'page' : undefined} className={`${tab(active === 'chat')} px-1 text-center leading-tight`}>
          <Icon name="chat" />
          {copy.nav.chat}
        </a>
      )}
      <a href={href({ name: 'inbox' })} aria-current={active === 'inbox' ? 'page' : undefined} className={tab(active === 'inbox')}>
        <Icon name="inbox" />
        {copy.nav.inbox}
        {count > 0 && <span className="inline-grid h-[19px] min-w-[19px] place-items-center rounded-md bg-primary px-[5px] text-meta font-bold text-primary-fg">{count}</span>}
      </a>
      <a href={href({ name: 'agents' })} aria-current={active === 'agents' ? 'page' : undefined} className={tab(active === 'agents')}>
        <Icon name="grid" />
        {copy.nav.agents}
      </a>
    </nav>
  );
}
