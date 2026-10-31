import { useMemo, type JSX } from 'react';
import { useDaemon, useOpenRig, useRigs, type DaemonClient } from '@ledge/fleet';
import type { Projects } from '@ledge/protocol';
import { allSeats, isStandalone } from '@ledge/ui/rigs/model';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import type { FleetView } from '../fleet/useFleet';
import type { Decisions } from '../fleet/decisions';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { useTheme } from '../shell/theme';
import { cls } from '../shell/cls';
import { HOME_TABS, type HomeTab, type NavAction, type NavState } from '../nav/state';
import { RigsTab, rigsCount, visibleRigs } from '../rigs/RigsTab';
import type { Relief } from '../session/useRelief';
import type { Wait } from '../list/time';
import { HomePlaceholder } from './HomePlaceholder';
import { LedgeConversation } from './LedgeConversation';

/** `relief`, `decisions` and `waits` feed the rail (« À toi ») of task 10. */
export interface LedgeHomeProps {
  client: DaemonClient; view: FleetView; relief: Relief; decisions: Decisions; waits: ReadonlyMap<string, Wait>;
  tab: HomeTab; nav: NavState; dispatch: (a: NavAction) => void;
  paused: boolean; focus: number;
  projects: Projects | null;
  onLaunched(id: string): void; onTerminal(id: string): void; notify(text: string): void; onProposal(pid: string): void;
}

/**
 * The Ledge screen (spec §8, `c-A.png`), where the app opens: « Ledge. » and what it orchestrates, the tabs « Conversation · Rigs · n ·
 * Mandat », then the tab: Ledge's thread and its composer, the Rigs tab of lot 3, or the mandate's placeholder until lot 7.
 */
export function LedgeHome(p: LedgeHomeProps): JSX.Element {
  const { client, view, tab, dispatch } = p;
  const { t } = useI18n();
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const { chat } = useDaemon();
  const offline = !view.machines.find(m => m.id === 'local')?.ready;
  const allRigs = useRigs(client);
  const openrig = useOpenRig(client);
  const rigs = rigsCount(allRigs, openrig);
  const agents = useMemo(() => allSeats(visibleRigs(allRigs, openrig)).length, [allRigs, openrig]);
  const solo = useMemo(() => view.sessions.filter(s => isStandalone(s, allRigs)).length, [view.sessions, allRigs]);
  const orchestrating = openrig.some(s => s.state === 'running');
  const labels: Record<HomeTab, string> = { conversation: t.home.tabs.conversation, rigs: t.home.rigsCount(rigs), mandat: t.home.tabs.mandat };
  return (
    <section className="ledge-home" aria-label={t.side.ledgeHome}>
      <div className="home-column">
        <div className="home-head">
          <ResidentMascot size={30} theme={theme} paused={p.paused} reducedMotion={p.paused || reduced} />
          <div className="home-title">
            <span data-brand className="home-brand">Ledge<span className="brand-dot">.</span></span>
            <span className="home-sub">{orchestrating ? t.home.header(rigs, agents, solo) : t.home.solo(solo)}</span>
          </div>
          <span className="st-fill" />
          <Button variant="ghost" size="icon" aria-label={t.chat.reset} title={t.chat.reset} disabled={offline || chat.length === 0} onClick={() => client.send({ type: 'chat.reset' })}><Icon {...ICONS.plus} /></Button>
          <Button variant="ghost" size="icon" aria-label={t.home.toAtelier} title={t.home.toAtelier} onClick={() => dispatch({ type: 'escape' })}><Icon {...ICONS.close} /></Button>
        </div>
        <div className="home-tabs" role="tablist" aria-label={t.home.tabsLabel}>
          {HOME_TABS.map(x => <button key={x} type="button" role="tab" aria-selected={tab === x} className={cls(tab === x && 'on')} onClick={() => dispatch({ type: 'ledge', tab: x })}>{labels[x]}</button>)}
        </div>
        <div className="home-body">
          {tab === 'conversation' && <LedgeConversation client={client} view={view} dispatch={dispatch} focus={p.focus} projects={p.projects} paused={p.paused}
            onLaunched={p.onLaunched} onTerminal={p.onTerminal} notify={p.notify} onProposal={p.onProposal} />}
          {tab === 'rigs' && <RigsTab nav={p.nav} dispatch={dispatch} client={client} sessions={view.sessions} projects={p.projects} notify={p.notify} />}
          {tab === 'mandat' && <HomePlaceholder title={t.home.mandat.title} body={t.home.mandat.body} />}
        </div>
      </div>
    </section>
  );
}
