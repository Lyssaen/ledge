import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { SHELL_ICONS } from '../shell/icons';
import type { IdeLayout, LayoutAction, SideView } from '../workspace/layout';
import { keyOf, type Tab } from '../workspace/model';
import { ATELIER_TAB, SETTINGS_TAB } from '../workspace/store';
import { PrIcon } from '../forge/PrIcon';
import '../styles/ide.css';

/** The IDE's activity bar (mockup `activity()`): the four sidebar views (« MR et PR », lot 8b, with the open requests whose
 *  pipeline failed), then the tabs that open in the workspace. */
export function ActivityBar({ layout, onLayout, onTab, activeTab, badge, prsFailing = 0 }: {
  layout: IdeLayout; onLayout(a: LayoutAction): void; onTab(t: Tab): void; activeTab: Tab | null; badge: { perm: number; ask: number }; prsFailing?: number;
}) {
  const { t } = useI18n();
  const view = (v: SideView, d: readonly string[] | React.ReactNode, label: string, extra?: React.ReactNode) => (
    <button className={layout.sideOpen && layout.sideView === v ? 'on' : undefined} aria-label={label} title={label} onClick={() => onLayout({ type: 'view', view: v })}>
      {Array.isArray(d) ? <Icon d={d} size={18} /> : d}{extra}
    </button>
  );
  const active = activeTab ? keyOf(activeTab) : '';
  const tab = (target: Tab, d: readonly string[], label: string) => (
    <button className={active === keyOf(target) ? 'on' : undefined} aria-label={label} title={label} onClick={() => onTab(target)}>
      <Icon d={d} size={18} />
    </button>
  );
  const mark = badge.perm ? <span className="ide-badge">{badge.perm}</span> : badge.ask ? <span className="ide-badge amber">{badge.ask}</span> : null;
  return (
    <nav className="ide-activity" aria-label={t.ide.activityLabel}>
      {view('projects', SHELL_ICONS.files, t.ide.projects)}
      {view('rigs', SHELL_ICONS.rig, t.ide.rigs)}
      {view('atoi', SHELL_ICONS.inbox, t.ide.atoi, mark)}
      {view('prs', <PrIcon />, t.forge.view, prsFailing > 0 ? <span className="ide-badge">{prsFailing}</span> : null)}
      {tab(ATELIER_TAB, SHELL_ICONS.grid, t.ide.atelierTab)}
      <span className="grow" />
      {tab(SETTINGS_TAB, SHELL_ICONS.gear, t.ide.settingsTab)}
    </nav>
  );
}
