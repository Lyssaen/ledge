import { useEffect, useRef, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../../i18n/lang';
import type { MachineEntry } from './model';

/** The machine menu of the Rigs view: one radio per machine, then the two links to Settings. Escape and a click outside close it; the arrows, Home and End move between the items (the checked one has the focus on opening). */
export function MachineMenu({ entries, current, outdated, onPick, onManage, onAdd, onClose }: { entries: readonly MachineEntry[]; current: string; /** The machines whose Ledge is too old: shown as such, not offline. */ outdated: ReadonlySet<string>; onPick(id: string): void; onManage(): void; /** Adding a machine is a setting (Settings › Machines), managing the shown ones is the OpenRig page's section. */ onAdd(): void; onClose(): void }): JSX.Element {
  const { t } = useI18n();
  const v = t.ide.rigsView;
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => { menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(); }, []);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let to: number;
    if (e.key === 'ArrowDown') to = (at + 1) % items.length;
    else if (e.key === 'ArrowUp') to = (at <= 0 ? items.length : at) - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = items.length - 1;
    else return;
    e.preventDefault();
    items[to]!.focus();
  };
  const sub = (e: MachineEntry): string => e.status === 'running' ? v.runningRigs(e.running)
    : e.status === 'stopped' ? v.openrigStopped : e.status === 'absent' ? t.openrig.notInstalledTitle
    : e.status === 'offline' ? (outdated.has(e.id) ? (t.openrig.launch.errors.outdated ?? t.side.offline) : t.side.offline) : t.openrig.loading;
  return (
    <>
      <div className="ide-rigs-back" data-testid="ide-rigs-back" onClick={onClose} />
      <div ref={menu} className="ide-rigs-menu" role="menu" aria-label={v.machines} onKeyDown={onKeyDown}>
        <div className="ide-rigs-menu-h">{v.machines}</div>
        {entries.map(e => (
          <button key={e.id} type="button" role="menuitemradio" aria-checked={e.id === current} className={e.id === current ? 'on' : ''} onClick={() => onPick(e.id)}>
            <i className={`ide-rigs-dot d-${e.status === 'running' ? 'idle' : 'off'}`} aria-hidden="true" />
            <span className="ide-rigs-menu-t"><b>{e.label}</b><small>{e.kind === 'ssh' ? v.ssh : v.local} · {sub(e)}</small></span>
            {e.id === current && <span className="ide-rigs-menu-ck" aria-hidden="true">✓</span>}
          </button>
        ))}
        <div className="ide-rigs-menu-sep" />
        <button type="button" role="menuitem" className="a" onClick={onManage}>{v.manage}</button>
        <button type="button" role="menuitem" className="a" onClick={onAdd}><Icon d={ICONS.plus.d} size={13} />{v.add}</button>
      </div>
    </>
  );
}
