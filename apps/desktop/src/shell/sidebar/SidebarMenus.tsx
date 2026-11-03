import { useId, type JSX, type ReactNode } from 'react';
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

/** One choice: its label is its accessible name, an icon before it; a note goes on its own line under it and is its description. */
function Item({ label, icon, onSelect, o = {} }: { label: string; icon: readonly string[]; onSelect(): void; o?: ItemOptions }): JSX.Element {
  const noteId = useId();
  const cls = [o.danger && 'danger', o.note && 'with-note'].filter(Boolean).join(' ') || undefined;
  return (
    <MenuItem aria-label={label} aria-describedby={o.note ? noteId : undefined} className={cls} disabled={o.disabled} onSelect={onSelect}>
      <span><Icon d={icon} size={14} />{label}</span>{o.note && <small id={noteId} className="menu-note">{o.note}</small>}
    </MenuItem>
  );
}
const item = (label: string, icon: readonly string[], onSelect: () => void, o: ItemOptions = {}): JSX.Element =>
  <Item key={label} label={label} icon={icon} onSelect={onSelect} o={o} />;

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
    case 'archives': {
      // Every archive, not only the ones the filter shows; an archive whose machine cannot archive is kept, and said so.
      const ok = p.archived.filter(s => p.actions.allowed(s.id)).map(s => s.id);
      const kept = p.archived.length - ok.length;
      title = t.side.archives;
      head = <div className="session-menu-head"><strong>{t.side.archives}</strong></div>;
      items = <>
        {item(c.deleteAll(ok.length), SHELL_ICONS.trash, () => p.actions.request('delete', ok), { danger: true, disabled: ok.length === 0, ...(kept > 0 ? { note: c.skipped(kept) } : {}) })}
        {item(c.restoreAll, SHELL_ICONS.restore, () => { for (const id of ok) p.actions.restore(id); p.notify(c.restoredAll(ok.length)); }, { disabled: ok.length === 0 })}
        {item(p.archivesOpen ? c.fold : c.unfold, ICONS.chevronRight.d, () => p.onArchivesOpen(!p.archivesOpen))}
      </>;
      break;
    }
    case 'archive': {
      const s = p.archived.find(x => x.id === target.id);
      if (!s) return null;
      const disabled = !p.actions.allowed(s.id);
      title = s.name;
      head = <div className="session-menu-head"><strong>{s.name}</strong>{s.topic && <small>{s.topic}</small>}</div>;
      items = <>
        {item(c.read, ICONS.external.d, () => go({ type: 'open', id: s.id }))}
        {item(t.manage.archivedBanner.restore, SHELL_ICONS.restore, () => p.actions.restore(s.id), { disabled })}
        {item(t.manage.menu.resume, SHELL_ICONS.resume, () => p.actions.resume(s.id), { disabled })}
        <hr />
        {item(t.manage.archivedBanner.delete, SHELL_ICONS.trash, () => p.actions.request('delete', [s.id]), { danger: true, disabled })}
      </>;
      break;
    }
  }
  return (
    <Menu key={JSON.stringify(target)} open onOpenChange={o => { if (!o) p.state.close(); }} label={c.label(title)} className="session-menu-wrap" menuClassName="session-menu"
      at={menu.at} trigger={() => null}>
      {head}
      {items}
    </Menu>
  );
}

