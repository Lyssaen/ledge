import type { MachineState } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';
import type { Lang } from '../i18n/messages';
import { LocalDownNotice } from '../shell/OfflineNotice';
import type { Updater } from '../update/store';
import type { DaemonUpdate } from '../update/daemon';
import type { MachineFleet } from './useMachineEditor';
import { AboutPanel } from './AboutPanel';
import { DisplayPanel } from './DisplayPanel';
import { MachinesPanel } from './MachinesPanel';
import { NotificationsPanel } from './NotificationsPanel';
import { SoundsPanel } from './SoundsPanel';

export type SettingsTab = 'display' | 'machines' | 'notifications' | 'sounds' | 'about';
export const SETTINGS_TABS: readonly SettingsTab[] = ['display', 'machines', 'notifications', 'sounds', 'about'];
export interface SettingsScreenProps {
  tab: SettingsTab; onTab(tab: SettingsTab): void; onBack(): void;
  lang: Lang; onLang(lang: Lang): void;
  machines: readonly MachineState[]; fleet: MachineFleet; localDown: boolean;
  testSound(): 'played' | 'dnd'; updater: Updater; daemon: DaemonUpdate;
}

/** The settings screen (spec §9.4; mockup settings.js `render`): it takes the heading's and the sessions' place, as the
 *  launch screen does; the panel scrolls inside the window. Openable while the local daemon is down (decision 16). */
export function SettingsScreen(p: SettingsScreenProps) {
  const { t } = useI18n();
  const s = t.settings;
  return (
    <section className="settings-screen" aria-label={s.title}>
      <header className="view-heading settings-heading">
        <div><h2>{s.title}</h2><p>{s.subtitle}</p></div>
        <button type="button" className="settings-button" data-settings-back onClick={p.onBack}><span aria-hidden="true">← </span>{s.back}</button>
      </header>
      {p.localDown && <LocalDownNotice role="status" />}
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={s.nav}>
          {SETTINGS_TABS.map(id => (
            <button key={id} type="button" data-settings-tab={id} aria-current={id === p.tab ? 'page' : undefined} onClick={() => p.onTab(id)}>{s.tabs[id]}</button>
          ))}
        </nav>
        <section className="settings-panel" aria-label={s.tabs[p.tab]}>
          {p.tab === 'display' && <DisplayPanel lang={p.lang} onLang={p.onLang} />}
          {p.tab === 'machines' && <MachinesPanel machines={p.machines} fleet={p.fleet} localDown={p.localDown} />}
          {p.tab === 'notifications' && <NotificationsPanel />}
          {p.tab === 'sounds' && <SoundsPanel testSound={p.testSound} />}
          {p.tab === 'about' && <AboutPanel machines={p.machines} updater={p.updater} daemon={p.daemon} />}
        </section>
      </div>
    </section>
  );
}
