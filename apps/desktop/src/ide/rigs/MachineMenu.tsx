import { useEffect, type JSX } from 'react';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../../i18n/lang';
import type { MachineEntry } from './model';

/** The machine menu of the Rigs view: one radio per machine, then the two links to Settings. Escape and a click outside close it. */
export function MachineMenu({ entries, current, onPick, onManage, onClose }: { entries: readonly MachineEntry[]; current: string; onPick(id: string): void; onManage(): void; onClose(): void }): JSX.Element {
  const { t } = useI18n();
  const v = t.ide.rigsView;
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  const sub = (e: MachineEntry): string => e.status === 'running' ? v.runningRigs(e.running)
    : e.status === 'stopped' ? v.openrigStopped : e.status === 'absent' ? t.openrig.notInstalledTitle
    : e.status === 'offline' ? t.side.offline : t.openrig.loading;
  return (
    <>
      <div className="ide-rigs-back" data-testid="ide-rigs-back" onClick={onClose} />
      <div className="ide-rigs-menu" role="menu" aria-label={v.machines}>
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
        <button type="button" role="menuitem" className="a" onClick={onManage}><Icon d={ICONS.plus.d} size={13} />{v.add}</button>
      </div>
    </>
  );
}
