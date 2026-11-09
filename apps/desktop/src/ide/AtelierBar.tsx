import type { JSX } from 'react';
import type { ProjectColor } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { Grouping } from '../openrig/grouping';
import { ProjectSwatch } from '../projects/ProjectSwatch';
import { SHELL_ICONS } from '../shell/icons';
import '../styles/ide.css';

export interface AtelierBarProps {
  /** The project filter shown after « Atelier » (R2): null for all projects; `color` null for « Sans projet ». */
  filter: { name: string; color: ProjectColor | null } | null; onClearFilter(): void;
  /** « Projets | Rigs » (R1): null hides it (no rig, OpenRig not installed). */
  grouping: Grouping | null; onGrouping(g: Grouping): void;
  helpers: boolean; onHelpers(): void;
  paused: boolean; onPaused(): void;
  /** « Détacher »: the atelier tab, alone, in a new window (lot 9, v27). */
  onDetach?: () => void;
  /** « Ramener », in place of « Détacher » when the atelier is in a detached window: back to the main window's active group. */
  onAttach?: () => void;
}

/** The IDE's Atelier tab bar (mockup atelierPage() `.abar`): what the old top bar gave the atelier, above it. The atelier itself
 *  does not change: « Atelier » and its project filter, « Projets | Rigs », the subagents, the animations (R3), « Détacher ». */
export function AtelierBar(p: AtelierBarProps): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ide-abar" role="toolbar" aria-label={t.side.atelier}>
      <span className="ide-abar-title">{t.side.atelier}</span>
      {p.filter && <>
        <span className="ide-abar-sep">/</span>
        <span className="ide-abar-filter">
          <ProjectSwatch project={p.filter.color ? { color: p.filter.color } : null} />
          <span title={p.filter.name}>{p.filter.name}</span>
          <button type="button" aria-label={t.crumb.clearFilter} title={t.crumb.clearFilter} onClick={p.onClearFilter}><Icon d={ICONS.close.d} size={12} /></button>
        </span>
      </>}
      {p.grouping && (
        <span className="ide-abar-seg" role="radiogroup" aria-label={t.top.grouping}>
          {(['projects', 'rigs'] as const).map(g => (
            <button key={g} type="button" role="radio" aria-checked={p.grouping === g} title={t.top.groupingHint[g]} onClick={() => { if (p.grouping !== g) p.onGrouping(g); }}>{t.top.groupingBy[g]}</button>
          ))}
        </span>
      )}
      <span className="ide-abar-sp" />
      <button type="button" className="ide-abar-btn" onClick={p.onHelpers}>{p.helpers ? t.top.helpersHide : t.top.helpersShow}</button>
      <button type="button" className="ide-abar-icon" aria-pressed={p.paused} aria-label={p.paused ? t.top.play : t.top.pause} title={p.paused ? t.top.play : t.top.pause} onClick={p.onPaused}>
        <Icon d={p.paused ? SHELL_ICONS.play : SHELL_ICONS.pause} size={14} />
      </button>
      {p.onDetach && <button type="button" className="ide-abar-btn" title={t.detached.detachTitle} onClick={p.onDetach}>{t.ide.atelierDetach}</button>}
      {!p.onDetach && p.onAttach && <button type="button" className="ide-abar-btn" title={t.detached.attachTitle} onClick={p.onAttach}>{t.ide.atelierBack}</button>}
    </div>
  );
}
