import { useEffect, useRef, useState, type JSX } from 'react';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { Menu, MenuItem } from '../shell/Menu';
import { SHELL_ICONS } from '../shell/icons';
import { cleanName, shapeOf, type Disposition } from '../workspace/dispositions';
import '../styles/ide.css';

export interface DispositionsProps {
  list: readonly Disposition[];
  /** The disposition applied or saved last, and whether the workspace changed since (its « • »). */
  current: { name: string; modified: boolean } | null;
  onApply(name: string): void;
  /** Saves the workspace under `name`, replacing the one of that name if any. */
  onSave(name: string): void;
  onManage(): void;
  /** Bumped by the palette's « Enregistrer la disposition… »: the menu opens on its name field. */
  saveAsk?: number;
}

/** The status bar's « disposition » (mockup v27 statusbar() `.lay`, menuHtml() `layout`; states: ledge-ide-layouts-palette.html):
 *  the one applied last (« Disposition » in grey before any is saved, a « • » once changed), and its menu — apply one, save into the
 *  current one or under a name (« Nom, puis Entrée »; a name taken asks for a second Enter), manage them in Settings. It opens upward. */
export function DispositionsMenu({ list, current, onApply, onSave, onManage, saveAsk = 0 }: DispositionsProps): JSX.Element {
  const { t } = useI18n();
  const d = t.ide.dispositions;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // The name the field warned about (« existe déjà »): a second Enter on it replaces.
  const [taken, setTaken] = useState<string | null>(null);
  const change = (o: boolean) => { setOpen(o); if (!o) { setSaving(false); setTaken(null); } };
  // Opened by a new ask only (the palette's « Enregistrer la disposition… »), not by the count it finds when the bar mounts again.
  const asked = useRef(saveAsk);
  useEffect(() => { if (saveAsk !== asked.current) { asked.current = saveAsk; setOpen(true); setSaving(true); } }, [saveAsk]);
  // After the menu's own effect (it focuses its first item on opening): the field keeps the focus.
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open && saving) field.current?.focus(); }, [open, saving]);
  const shape = (x: Disposition) => { const s = shapeOf(x); return d.shape(s.groups, s.windows); };
  const tip = !current ? d.noneTip : current.modified ? d.modTip : d.tip;
  return (
    <Menu open={open} onOpenChange={change} label={d.title} className="ide-lay-wrap" menuClassName="session-menu ide-lay-menu" flip
      trigger={tr => (
        <button type="button" ref={tr.ref} className={`ide-lay${open ? ' open' : ''}${current ? '' : ' none'}`} aria-haspopup={tr['aria-haspopup']} aria-expanded={tr['aria-expanded']}
          onClick={tr.onClick} title={tip} aria-label={`${d.title} : ${current ? current.name : d.none}${current?.modified ? ` (${d.modified})` : ''}`}>
          <Icon d={SHELL_ICONS.split} size={12} /><span className="ide-lay-name">{current ? current.name : d.none}</span>
          {current?.modified && <span className="ide-lay-mod" aria-hidden="true">•</span>}
          <span className="ide-lay-caret" aria-hidden="true">▴</span>
        </button>
      )}>
      <div className="ide-lay-h">{d.title}</div>
      {list.length === 0 && <div className="ide-lay-empty">{d.empty}</div>}
      {list.map(x => {
        const on = x.name === current?.name;
        return (
          <MenuItem key={x.name} className={on ? 'sel' : undefined} onSelect={() => onApply(x.name)}>
            <span className="ide-lay-n">{x.name}</span>
            <small className="ide-lay-r">{shape(x)}{on ? ` · ${d.current}${current!.modified ? ` · ${d.modified}` : ''}` : ''}</small>
          </MenuItem>
        );
      })}
      <hr />
      {saving ? (
        <>
          <input ref={field} className={`ide-lay-save${taken ? ' warn' : ''}`} aria-label={d.nameLabel} placeholder={d.namePlaceholder} aria-invalid={taken ? true : undefined}
            onChange={e => { if (taken !== null && cleanName(e.target.value) !== taken) setTaken(null); }}
            onKeyDown={e => {
              // The arrows stay in the field (the menu would move the focus to its items).
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End') e.stopPropagation();
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
              e.preventDefault();
              const name = cleanName(e.currentTarget.value);
              if (!name) return;
              if (taken !== name && list.some(x => x.name === name)) { setTaken(name); return; }
              onSave(name);
              change(false);
            }} />
          {taken && <div className="ide-lay-hint" role="alert">{d.taken(taken)}</div>}
        </>
      ) : current ? (
        <>
          <MenuItem onSelect={() => onSave(current.name)}>{d.saveInto(current.name)}</MenuItem>
          {/* Not a MenuItem: choosing it keeps the menu open, on its field. */}
          <button type="button" role="menuitem" onClick={() => setSaving(true)}>{d.saveAs}</button>
        </>
      ) : (
        <button type="button" role="menuitem" onClick={() => setSaving(true)}>{d.saveCurrent}</button>
      )}
      <MenuItem onSelect={onManage}><span>{d.manage}</span><small className="ide-lay-r">{d.manageHint}</small></MenuItem>
    </Menu>
  );
}
