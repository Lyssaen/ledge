import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { SHELL_ICONS } from '../shell/icons';
import type { IdeLayout, LayoutAction, SideView } from '../workspace/layout';
import { keyOf, type Tab } from '../workspace/model';
import { ATELIER_TAB, SETTINGS_TAB } from '../workspace/store';
import '../styles/ide.css';

/** The IDE's activity bar (mockup `activity()`): the three sidebar views, then the tabs that open in the workspace.
 *  « MR et PR » comes with lot 8. */
export function ActivityBar({ layout, onLayout, onTab, activeTab, badge, rigsAlert }: {
  layout: IdeLayout; onLayout(a: LayoutAction): void; onTab(t: Tab): void; activeTab: Tab | null; badge: { perm: number; ask: number };
  /** OpenRig is installed but its daemon is down: an amber « ! » on Rigs. */
  rigsAlert: boolean;
}) {
  const { t } = useI18n();
  const view = (v: SideView, d: readonly string[], label: string, extra?: React.ReactNode) => (
    <button className={layout.sideOpen && layout.sideView === v ? 'on' : undefined} aria-label={label} title={label} onClick={() => onLayout({ type: 'view', view: v })}>
      <Icon d={d} size={18} />{extra}
    </button>
  );
  const active = activeTab ? keyOf(activeTab) : '';
  const tab = (target: Tab, d: readonly string[], label: string) => (
    <button className={active === keyOf(target)  ? 'on' : undefined} aria-label={label} title={label} onClick={() => onTab(target)}>
      <Icon d={d} size={18} />
    </button>
  );
  const mark = badge.perm ? <span className="ide-badge">{badge.perm}</span> : badge.ask ? <span className="ide-badge amber">{badge.ask}</span> : null;
  return (
    <nav className="ide-activity" aria-label={t.ide.activityLabel}>
      {view('projects', SHELL_ICONS.files, t.ide.projects)}
      {view('rigs', SHELL_ICONS.rig, t.ide.rigs, rigsAlert ? <span className="ide-badge amber">!</span> : null)}
      {view('atoi', SHELL_ICONS.inbox, t.ide.atoi, mark)}
      {tab(ATELIER_TAB, SHELL_ICONS.grid, t.ide.atelierTab)}
      <span className="grow" />
      {tab(SETTINGS_TAB, SHELL_ICONS.gear, t.ide.settingsTab)}
    </nav>
  );
}
