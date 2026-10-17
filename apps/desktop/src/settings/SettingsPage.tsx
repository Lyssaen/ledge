import { useEffect, useId, useRef, type JSX } from 'react';
import type { Fleet, MachineState } from '@ledge/fleet';
import type { Projects, Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n, type Lang } from '../i18n/lang';
import { SECTIONS, type NavAction, type SectionId } from '../nav/state';
import type { Alerts } from '../notify/useAlerts';
import type { DaemonUpdate } from '../update/daemon';
import { updateReady, useUpdate } from '../update/store';
import { General } from './General';
import { Appearance } from './Appearance';
import { Notifications } from './Notifications';
import { Sounds } from './Sounds';

/** What the sections receive from the shell: the app's toast (`saved` says « Setting saved · … » once a change is accepted,
 *  in `lang` when given), the fleet and its machines, the projects, the sessions, navigation, the alerts (the Sounds' Test), the
 *  local daemon's update, the language and how to change it (its strings load first: 'failed' leaves the language as it is),
 *  and whether the animations are frozen. */
export interface SettingsContext {
  notify(text: string): void;
  saved(what: string, lang?: Lang): void;
  fleet: Fleet;
  machines: readonly MachineState[];
  projects: Projects | null;
  projectIdOf(s: Session): string | null;
  sessions: readonly Session[];
  dispatch(a: NavAction): void;
  alerts: Alerts;
  daemonUpdate: DaemonUpdate;
  lang: Lang;
  setLang(l: Lang): Promise<'ok' | 'failed'>;
  paused: boolean;
}

/** The sections' line icons, as the mockup draws them (settings.tsx, SECTIONS). */
const SECTION_ICONS: Record<SectionId, readonly string[]> = {
  general: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  appearance: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 3v18'],
  notifications: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  sounds: ['M11 5 6 9H2v6h4l5 4V5Z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'],
  machines: ['M3 4h18v12H3z', 'M12 16v4', 'M8 20h8'],
  projects: ICONS.folder.d,
  shortcuts: ['M2 6h20v12H2z', 'M6 10h.01', 'M10 10h.01', 'M14 10h.01', 'M18 10h.01', 'M7 14h10'],
  about: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 16v-4', 'M12 8h.01']
};

/** A section's cards. Each one not built yet waits for its task of lot 10 (4 and 5), which replaces its placeholder. */
function SectionBody({ section, ctx }: { section: SectionId; ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  if (section === 'general') return <General ctx={ctx} />;
  if (section === 'appearance') return <Appearance ctx={ctx} />;
  if (section === 'notifications') return <Notifications ctx={ctx} />;
  if (section === 'sounds') return <Sounds ctx={ctx} />;
  return <p className="muted">{t.pending}</p>;
}

/** The mockup's Settings page: the sections on the left (« Back to the atelier » first, as Escape; a dot on Machines while a
 *  machine is offline, on About while an update of the app or of the local daemon waits), the section's title, hint and cards
 *  on the right, scrolled back to the top at each change of section. */
export function SettingsPage({ section, ctx }: { section: SectionId; ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const s = t.settings;
  const update = useUpdate();
  const scroller = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [section]);
  const { dispatch } = ctx;
  // As the sidebar's gear inside Settings: the chat closes, then Escape takes the place back.
  const back = () => { dispatch({ type: 'chat', open: false }); dispatch({ type: 'escape' }); };
  const alert = (id: SectionId): string | null =>
    id === 'machines' && ctx.machines.some(m => !m.ready) ? s.machineOffline
    : id === 'about' && (updateReady(update) || ctx.daemonUpdate.offer !== 'none') ? s.updateWaiting
    : null;

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label={s.nav}>
        <Button variant="ghost" size="sm" className="settings-back" onClick={back}><Icon d={ICONS.chevronLeft.d} size={14} />{s.back}<Kbd>{t.crumb.escape}</Kbd></Button>
        {SECTIONS.map(id => {
          const note = alert(id);
          return (
            <button key={id} type="button" className={id === section ? 'settings-tab active' : 'settings-tab'} aria-current={id === section ? 'page' : undefined}
              onClick={() => dispatch({ type: 'settings', section: id })}>
              <Icon d={SECTION_ICONS[id]} size={15} /><span>{t.sections[id]}</span>{note && <b className="side-alert" role="img" aria-label={note} />}
            </button>
          );
        })}
      </nav>
      <div className="settings-scroll" ref={scroller}>
        <section className="settings-content" key={section} aria-labelledby={titleId}>
          {/* Inside a section a header is no banner (HTML-AAM); role="none" says so to the tools that miss the rule, so the top bar stays the only one. */}
          <header className="settings-head" role="none"><h1 id={titleId}>{t.sections[section]}</h1><p>{s.hints[section]}</p></header>
          <SectionBody section={section} ctx={ctx} />
        </section>
      </div>
    </div>
  );
}
