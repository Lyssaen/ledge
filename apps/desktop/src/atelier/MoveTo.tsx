import type { JSX } from 'react';
import type { Project, Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { Menu, MenuItem } from '../shell/Menu';
import { folderOf, type Filing } from './filing';

/** « Ranger dans… » (assign-wrap): the projects, each with its repositories' folder names, then « Nouveau projet… » from this
 *  session's folder. A choice goes to `filing.file`. Shared by the atelier's « Sans projet » cards and the List's rows. */
export function MoveTo({ session: s, projects, filing, dispatch, open, onOpenChange, className, flip }: { session: Session; projects: readonly Project[]; filing: Filing; dispatch: (a: NavAction) => void; open: boolean; onOpenChange(open: boolean): void; className: string; flip?: boolean }): JSX.Element {
  const { t } = useI18n();
  return (
    <Menu open={open} onOpenChange={onOpenChange} label={t.filing.moveTo} className={className} menuClassName="assign-menu" flip={flip}
      trigger={tr => (
        <Button variant="outline" size="sm" {...tr}>
          <Icon d={ICONS.folder.d} size={13} />{t.filing.moveTo}
        </Button>
      )}>
      {projects.map(p => (
        <MenuItem key={p.id} onSelect={() => filing.file(s, p.id)}>
          {p.name}<small>{p.repos.map(r => folderOf(r.path)).join(' · ')}</small>
        </MenuItem>
      ))}
      <MenuItem className="assign-new" onSelect={() => dispatch({ type: 'modal', modal: { kind: 'project', file: s.id } })}>
        <span><Icon d={ICONS.plus.d} size={12} />{t.filing.newProject}</span>
        <small>{t.filing.from(s.cwd)}</small>
      </MenuItem>
    </Menu>
  );
}
