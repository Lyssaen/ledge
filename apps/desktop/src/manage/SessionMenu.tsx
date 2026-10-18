import { useState, type JSX, type ReactNode } from 'react';
import type { Project, Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { Kbd } from '@ledge/ui/ui/Kbd';
import type { Filing } from '../atelier/filing';
import { useI18n } from '../i18n/lang';
import { machineOf } from '../nav/agents';
import { Menu, MenuItem } from '../shell/Menu';
import { Modal } from '../shell/Modal';
import { SHELL_ICONS } from '../shell/icons';
import type { SessionActions } from './useSessionActions';

/** A session still runs when its machine answers and it has not exited. */
export const isLiveSession = (s: Session): boolean => !s.offline && s.state !== 'exited';

export interface SessionMenuProps {
  session: Session;
  /** Where the pointer was (a right click), or under the seat's « … »: the menu is fixed there. */
  at: { x: number; y: number };
  actions: SessionActions;
  filing: Filing;
  /** « Ranger dans… » offers these, but the session's own project. */
  projects: readonly Project[];
  current: string | null;
  onOpen(s: Session): void;
  onTerminal(s: Session): void;
  onRename(s: Session): void;
  /** The menu closed (a choice, Escape, a click outside): the caller gives the focus back where it came from. */
  onClose(): void;
}

/** The menu of one session (manage.tsx's `SessionMenu`), opened from a seat or a card of the atelier: open, terminal, rename, file, end or resume,
 *  archive, delete. A machine whose daemon cannot archive keeps Archiver, Supprimer and Reprendre disabled, with the reason. */
export function SessionMenu({ session: s, at, actions, filing, projects, current, onOpen, onTerminal, onRename, onClose }: SessionMenuProps): JSX.Element {
  const { t } = useI18n();
  const m = t.manage.menu;
  const [filingOpen, setFilingOpen] = useState(false);
  const live = isLiveSession(s);
  const exited = s.state === 'exited';
  const machine = machineOf(s);
  const outdated = actions.allowed(s.id) ? undefined : t.manage.outdated(machine);
  const item = (label: string, icon: readonly string[], onSelect: () => void, o: { hint?: string; key?: string; danger?: boolean; disabled?: string | true } = {}): JSX.Element => (
    <MenuItem aria-label={label} aria-keyshortcuts={o.key} className={o.danger ? 'danger' : undefined} disabled={o.disabled !== undefined} title={typeof o.disabled === 'string' ? o.disabled : undefined} onSelect={onSelect}>
      <span><Icon d={icon} size={14} />{label}</span>{o.hint && <small aria-hidden="true"><Kbd>{o.hint}</Kbd></small>}
    </MenuItem>
  );
  const note: ReactNode = s.helpers.length > 0 ? <p className="session-menu-note">{m.kids(s.helpers.length, s.name)}</p> : null;
  return (
    <Menu open onOpenChange={o => { if (!o) onClose(); }} label={m.label(s.name)} className="session-menu-wrap" menuClassName="session-menu" at={at} trigger={() => null}>
      <div className="session-menu-head"><strong>{s.name}</strong><small>{s.topic ?? s.title}</small></div>
      {item(m.open, ICONS.external.d, () => onOpen(s), { hint: '↵' })}
      {item(m.terminal, SHELL_ICONS.terminal, () => onTerminal(s), { hint: 'T', key: 't', disabled: s.offline ? m.offline(machine) : undefined })}
      {item(m.rename, SHELL_ICONS.pencil, () => onRename(s), { hint: 'F2', key: 'F2', disabled: exited || undefined })}
      <button type="button" role="menuitem" aria-label={t.filing.moveTo} aria-haspopup="menu" aria-expanded={filingOpen} onClick={() => setFilingOpen(o => !o)}>
        <span><Icon d={ICONS.folder.d} size={14} />{m.moveTo}</span><Icon d={ICONS.chevronRight.d} size={12} />
      </button>
      {filingOpen && (
        <div className="session-menu-sub" role="group" aria-label={m.moveTo}>
          {projects.filter(p => p.id !== current).map(p => <MenuItem key={p.id} onSelect={() => filing.file(s, p.id)}><span>{p.name}</span></MenuItem>)}
        </div>
      )}
      <hr />
      {exited
        ? item(m.resume, SHELL_ICONS.resume, () => actions.resume(s.id), { disabled: outdated })
        : item(m.end, SHELL_ICONS.stop, () => actions.request('end', [s.id]), { disabled: s.offline ? m.cannotEnd(machine) : undefined })}
      {item(live ? m.endAndArchive : m.archive, SHELL_ICONS.archive, () => actions.request('archive', [s.id]), { hint: 'E', key: 'e', disabled: outdated })}
      {note}
      <hr />
      {item(m.delete, SHELL_ICONS.trash, () => actions.request('delete', [s.id]), { hint: 'Del', key: 'Delete', danger: true, disabled: outdated })}
    </Menu>
  );
}

/** « Renommer… »: one field, the session's topic; Entrée or « Renommer » sends it. Escape cancels without going further. */
export function RenameDialog({ session: s, onRename, onClose }: { session: Session; onRename(topic: string): void; onClose(): void }): JSX.Element {
  const { t } = useI18n();
  const r = t.manage.rename;
  const [topic, setTopic] = useState(s.topic ?? '');
  const ok = topic.trim() !== '' && topic.trim() !== (s.topic ?? '');
  const submit = () => { if (ok) { onRename(topic.trim()); onClose(); } };
  return (
    <Modal title={r.title(s.name)} className="rename-modal" onClose={onClose}>
      <form className="rename-form" onSubmit={e => { e.preventDefault(); submit(); }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <input autoFocus aria-label={r.label} value={topic} maxLength={500} onChange={e => setTopic(e.target.value)} onFocus={e => e.currentTarget.select()} />
        <div className="confirm-actions">
          <Button type="button" onClick={onClose}>{r.cancel}</Button>
          <Button type="submit" variant="primary" disabled={!ok}>{r.save}</Button>
        </div>
      </form>
    </Modal>
  );
}
