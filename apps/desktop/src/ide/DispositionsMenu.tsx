import { useEffect, useRef, useState, type JSX } from 'react';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { Menu, MenuItem } from '../shell/Menu';
import { SHELL_ICONS } from '../shell/icons';
import { cleanName, groupCount, type Disposition } from '../workspace/dispositions';
import '../styles/ide.css';

export interface DispositionsProps {
  list: readonly Disposition[]; current: string | null;
  onApply(name: string): void; onSave(name: string): void; onManage(): void;
  /** Bumped by the palette's « Enregistrer la disposition »: the menu opens on its name field. */
  saveAsk?: number;
}

/** The status bar's « disposition » (mockup statusbar() `.lay`, menuHtml() `layout`): the one applied last, and its menu — apply one,
 *  save the current one under a name (« Nom, puis Entrée »), manage them in Settings › Workspace. It opens upward. */
export function DispositionsMenu({ list, current, onApply, onSave, onManage, saveAsk = 0 }: DispositionsProps): JSX.Element {
  const { t } = useI18n();
  const d = t.ide.dispositions;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const change = (o: boolean) => { setOpen(o); if (!o) setSaving(false); };
  useEffect(() => { if (saveAsk > 0) { setOpen(true); setSaving(true); } }, [saveAsk]);
  // After the menu's own effect (it focuses its first item on opening): the field keeps the focus.
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open && saving) field.current?.focus(); }, [open, saving]);
  return (
    <Menu open={open} onOpenChange={change} label={d.title} className="ide-lay-wrap" menuClassName="session-menu ide-lay-menu" flip
      trigger={tr => (
        <button type="button" ref={tr.ref} className={`ide-lay${open ? ' open' : ''}`} aria-haspopup={tr['aria-haspopup']} aria-expanded={tr['aria-expanded']} onClick={tr.onClick} title={d.tip}>
          <Icon d={SHELL_ICONS.split} size={12} /><span className="ide-lay-name">{current ?? d.title}</span><span className="ide-lay-caret" aria-hidden="true">▴</span>
        </button>
      )}>
      <div className="ide-lay-h">{d.title}</div>
      {list.map(x => (
        <MenuItem key={x.name} className={x.name === current ? 'sel' : undefined} onSelect={() => onApply(x.name)}>
          <span className="ide-lay-n">{x.name}</span>
          <small className="r">{d.groups(groupCount(x))}{x.name === current ? ` · ${d.current}` : ''}</small>
        </MenuItem>
      ))}
      {list.length > 0 && <hr />}
      {saving ? (
        <input ref={field} className="ide-lay-save" aria-label={d.nameLabel} placeholder={d.namePlaceholder}
          onKeyDown={e => {
            // The arrows stay in the field (the menu would move the focus to its items).
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End') e.stopPropagation();
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            const name = cleanName(e.currentTarget.value);
            if (!name) return;
            onSave(name);
            change(false);
          }} />
      ) : (
        // Not a MenuItem: choosing it keeps the menu open, on its field.
        <button type="button" role="menuitem" onClick={() => setSaving(true)}>{d.save}</button>
      )}
      <MenuItem onSelect={onManage}><span>{d.manage}</span><small className="r">{d.manageHint}</small></MenuItem>
    </Menu>
  );
}
