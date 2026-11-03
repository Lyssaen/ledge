import type { JSX, ReactNode } from 'react';
import type { Projects, Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../../i18n/lang';
import type { SessionActions } from '../../manage/useSessionActions';
import type { ContextMenuState } from '../../manage/useContextMenu';
import type { NavAction } from '../../nav/state';
import { ProjectSwatch } from '../../projects/ProjectSwatch';
import { SHELL_ICONS } from '../icons';
import { Menu, MenuItem } from '../Menu';
import type { ProjectGroup } from './model';
import { projectKey } from './Tree';

export interface SidebarMenuHostProps {
  state: ContextMenuState;
  projects: Projects | null;
  groups: readonly ProjectGroup[];
  archived: readonly Session[];
  actions: SessionActions;
  dispatch(a: NavAction): void;
  broadcast: boolean;
  closed: ReadonlySet<string>;
  onClosed(next: Set<string>): void;
  archivesOpen: boolean;
  onArchivesOpen(open: boolean): void;
  notify(text: string): void;
}

interface ItemOptions { danger?: boolean; disabled?: boolean; note?: string }

/** One choice: its label is its accessible name (the tests and the screen readers read it), an icon before it. */
function item(label: string, icon: readonly string[], onSelect: () => void, o: ItemOptions = {}): JSX.Element {
  return (
    <MenuItem key={label} aria-label={label} className={o.danger ? 'danger' : undefined} disabled={o.disabled} onSelect={onSelect}>
      <span><Icon d={icon} size={14} />{label}</span>{o.note && <small>{o.note}</small>}
    </MenuItem>
  );
}

/** The sidebar's own menus (every target but a session, which `SessionMenuHost` renders): a project, « No project », the Archives, one archive. */
export function SidebarMenuHost(p: SidebarMenuHostProps): JSX.Element | null {
  const { t } = useI18n();
  const c = t.side.ctx;
  const { menu } = p.state;
  if (!menu || menu.target.kind === 'session') return null;
  const target = menu.target;
  const go = (a: NavAction) => p.dispatch(a);
  const toggleKey = (key: string) => {
    const n = new Set(p.closed);
    if (n.has(key)) n.delete(key); else n.add(key);
    p.onClosed(n);
  };
  const foldItem = (key: string) => item(p.closed.has(key) ? c.unfold : c.fold, ICONS.chevronRight.d, () => toggleKey(key));

  let title: string;
  let head: ReactNode;
  let items: ReactNode;
  switch (target.kind) {
    case 'project': {
      const project = p.projects?.projects.find(x => x.id === target.id);
      if (!project) return null;
      const id = project.id;
      const group = p.groups.find(g => g.id === id);
      const has = !!group && group.branches.some(b => b.sessions.length > 0);
      title = project.name;
      head = <div className="session-menu-head"><strong><ProjectSwatch project={project} />{project.name}</strong></div>;
      items = <>
        {item(c.newHere, ICONS.plus.d, () => go({ type: 'modal', modal: { kind: 'launch', project: id } }))}
        {p.broadcast && item(c.broadcast, SHELL_ICONS.mail, () => go({ type: 'modal', modal: { kind: 'broadcast', to: { project: id } } }))}
        {item(c.addFolder, ICONS.folder.d, () => go({ type: 'modal', modal: { kind: 'project', edit: id, addFolder: true } }))}
        {item(c.edit, SHELL_ICONS.pencil, () => go({ type: 'modal', modal: { kind: 'project', edit: id } }))}
        {has && foldItem(projectKey(id))}
        <hr />
        {item(c.deleteProject, SHELL_ICONS.trash, () => go({ type: 'modal', modal: { kind: 'project', edit: id, delete: true } }), { danger: true })}
      </>;
      break;
    }
    case 'unassigned':
      title = t.side.unassigned;
      head = <div className="session-menu-head"><strong>{t.side.unassigned}</strong></div>;
      items = <>
        {item(c.newSession, ICONS.plus.d, () => go({ type: 'modal', modal: { kind: 'launch' } }))}
        {item(c.newProject, ICONS.folder.d, () => go({ type: 'modal', modal: { kind: 'project' } }))}
        {foldItem(projectKey(null))}
      </>;
      break;
    default:
      return null;
  }
  return (
    <Menu key={JSON.stringify(target)} open onOpenChange={o => { if (!o) p.state.close(); }} label={c.label(title)} className="session-menu-wrap" menuClassName="session-menu"
      at={menu.at} trigger={() => null}>
      {head}
      {items}
    </Menu>
  );
}

