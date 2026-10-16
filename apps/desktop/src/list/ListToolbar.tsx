import { useRef, type JSX, type KeyboardEvent, type Ref } from 'react';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../i18n/lang';
import { SHELL_ICONS } from '../shell/icons';
import { BUCKETS, type Chip, type GroupBy } from './model';
import type { Density } from './prefs';

const GROUPS: readonly GroupBy[] = ['project', 'machine', 'state'];

export interface ListToolbarProps {
  barRef: Ref<HTMLDivElement>;
  text: string;
  onText: (text: string) => void;
  chip: Chip;
  onChip: (chip: Chip) => void;
  /** Under the text filter (list model's `counts`). */
  counts: Record<Chip, number>;
  group: GroupBy;
  onGroup: (group: GroupBy) => void;
  density: Density;
  onDensity: (density: Density) => void;
}

/** The List's sticky toolbar (list.tsx, lines 143-154): the text filter, the state chips with their counts, the grouping
 *  and the density. « Hors ligne » only shows when it counts or is chosen; a chip at 0 is disabled unless it is chosen,
 *  and the chosen chip clicked again goes back to « Tous ». */
export function ListToolbar({ barRef, text, onText, chip, onChip, counts, group, onGroup, density, onDensity }: ListToolbarProps): JSX.Element {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const radios = useRef<Partial<Record<GroupBy, HTMLButtonElement | null>>>({});
  const other: Density = density === 'tight' ? 'comfy' : 'tight';
  // A radio group: ← / → (and ↑ / ↓) move the choice and the focus, Home / End go to the ends.
  const onSegKey = (e: KeyboardEvent) => {
    const i = GROUPS.indexOf(group);
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? GROUPS[(i + 1) % GROUPS.length]
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? GROUPS[(i + GROUPS.length - 1) % GROUPS.length]
      : e.key === 'Home' ? GROUPS[0] : e.key === 'End' ? GROUPS[GROUPS.length - 1] : undefined;
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    onGroup(next);
    radios.current[next]?.focus();
  };
  return (
    <div ref={barRef} className="list-toolbar">
      <label className="list-filter">
        <Icon d={SHELL_ICONS.search} size={14} />
        <input ref={input} value={text} onChange={e => onText(e.target.value)} placeholder={t.list.filterPlaceholder} aria-label={t.list.filter} />
        {text
          ? <button type="button" className="filter-clear" aria-label={t.list.clearFilter} onClick={() => { onText(''); input.current?.focus(); }}><Icon d={ICONS.close.d} size={12} /></button>
          : <Kbd>F</Kbd>}
      </label>
      <div className="state-chips" role="group" aria-label={t.list.chips}>
        <button type="button" aria-pressed={chip === 'all'} onClick={() => onChip('all')}>{t.list.all}<span className="mono">{counts.all}</span></button>
        {BUCKETS.filter(b => b !== 'offline' || counts.offline > 0 || chip === 'offline').map(b => (
          <button key={b} type="button" className={`chip-${b}`} aria-pressed={chip === b} disabled={counts[b] === 0 && chip !== b} onClick={() => onChip(chip === b ? 'all' : b)}>
            <i className={`g-dot dot-${b}`} />{t.list.buckets[b]}<span className="mono">{counts[b]}</span>
          </button>
        ))}
      </div>
      <span className="spacer" />
      <div className="seg" role="radiogroup" aria-label={t.list.groupBy} onKeyDown={onSegKey}>
        <span className="seg-label">{t.list.groupLabel}</span>
        {GROUPS.map(g => (
          <button key={g} ref={el => { radios.current[g] = el; }} type="button" role="radio" aria-checked={group === g} tabIndex={group === g ? 0 : -1} onClick={() => onGroup(g)}>{t.list.groups[g]}</button>
        ))}
      </div>
      <Button variant="ghost" size="icon" className="density-toggle" aria-pressed={density === 'tight'} aria-label={t.list[other]} title={t.list[other]} onClick={() => onDensity(other)}>
        <Icon d={other === 'comfy' ? SHELL_ICONS.densityComfy : SHELL_ICONS.densityTight} size={15} />
      </Button>
    </div>
  );
}
