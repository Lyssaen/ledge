import { copy } from '../copy';
import { href } from '../router';
import { Icon } from './icons';

/** Four tabs leave ~90 px each on a 360 px phone: the icon goes above its label and the count sits on the icon's corner (as in the landscape rail). */
const tab = (on: boolean, four: boolean) => `relative flex min-h-12 min-w-0 items-center justify-center rounded-control transition-colors duration-100 active:bg-raised ${four ? 'flex-col gap-0.5 px-1 text-center text-meta leading-tight' : 'gap-2 text-body'} ${on ? 'bg-raised text-fg' : 'text-muted'}`;

/**
 * « Ledge » first when the PC offers the chat (ledge home spec §2.4), then « À traiter », « Agents » and « Équipes »; `count` is what waits there.
 * A phone on its side shows it as a rail on the left (`.tabbar`, styles.css).
 */
export function TabBar({ count, active = 'inbox', chat = false }: { count: number; active?: 'inbox' | 'agents' | 'chat' | 'teams'; chat?: boolean }) {
  return (
    <nav aria-label={copy.nav.label} className={`tabbar grid flex-none ${chat ? 'grid-cols-4' : 'grid-cols-3'} border-t border-line bg-bg pt-2 pb-3`}>
      {chat && (
        <a href={href({ name: 'chat' })} aria-current={active === 'chat' ? 'page' : undefined} className={tab(active === 'chat', chat)}>
          <Icon name="chat" />
          {copy.nav.chat}
        </a>
      )}
      <a href={href({ name: 'inbox' })} aria-current={active === 'inbox' ? 'page' : undefined} className={tab(active === 'inbox', chat)}>
        <Icon name="inbox" />
        {copy.nav.inbox}
        {count > 0 && <span className={`${chat ? 'absolute top-1 right-3 ' : ''}inline-grid h-[19px] min-w-[19px] place-items-center rounded-md bg-primary px-[5px] text-meta font-bold text-primary-fg`}>{count}</span>}
      </a>
      <a href={href({ name: 'agents' })} aria-current={active === 'agents' ? 'page' : undefined} className={tab(active === 'agents', chat)}>
        <Icon name="grid" />
        {copy.nav.agents}
      </a>
      <a href={href({ name: 'teams' })} aria-current={active === 'teams' ? 'page' : undefined} className={tab(active === 'teams', chat)}>
        <Icon name="flag" />
        {copy.nav.teams}
      </a>
    </nav>
  );
}
