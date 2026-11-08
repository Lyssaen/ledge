import { useEffect, useRef, type JSX, type KeyboardEvent } from 'react';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { PERM_LEVELS, type PermLevel } from './rig/model';

export interface PermSegmentProps {
  /** The level shown checked; null: none known (a mixed rig, not read yet). */
  value: PermLevel | null;
  onChange(l: PermLevel): void;
  label: string;
  /** Every level off. */
  disabled?: boolean;
  /** One level off (the Rig tab's « Spec » without a known spec policy). */
  levelOff?(l: PermLevel): boolean;
  /** A level's tooltip (why it is off). */
  titleOf?(l: PermLevel): string | undefined;
  /** The look of the screen it sits in (the Rig tab's `.ide-rig-seg`). */
  className?: string;
}

/** The six permission levels as one radio group (mockup `.segc`, `rxSeg`). The arrows, Home and End only move the focus (roving,
 *  wrapping, skipping a level that is off): a level is chosen by Space, Enter or a click, since choosing one may act at once (the Rig
 *  tab sends `rig.policy`). A choice that turns the levels off while it runs (busy) gets the focus back once they come back on, where
 *  the focus fell to the page meanwhile. YOLO is marked risky. */
export function PermSegment({ value, onChange, label, disabled = false, levelOff, titleOf, className }: PermSegmentProps): JSX.Element {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const off = (l: PermLevel): boolean => disabled || levelOff?.(l) === true;
  const on = PERM_LEVELS.filter(l => !off(l));
  // The one level in the tab order: the chosen one, else the first that can be chosen.
  const tabStop = value !== null && !off(value) ? value : on[0];
  const button = (l: PermLevel | undefined) => (l ? box.current?.querySelector<HTMLButtonElement>(`[data-level="${l}"]`) ?? null : null);

  const chose = useRef(false);
  const choose = (l: PermLevel) => { chose.current = true; onChange(l); };
  useEffect(() => {
    if (!chose.current || !tabStop) return;
    const at = document.activeElement;
    chose.current = false;
    if (at === null || at === document.body) button(tabStop)?.focus();
  }, [tabStop, on.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const keys = (e: KeyboardEvent<HTMLButtonElement>, from: PermLevel) => {
    if (on.length === 0) return;
    const i = on.indexOf(from);
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? on[(i + 1) % on.length]
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? on[(i - 1 + on.length) % on.length]
      : e.key === 'Home' ? on[0] : e.key === 'End' ? on[on.length - 1] : undefined;
    if (!to) return;
    e.preventDefault();
    button(to)?.focus();
  };

  return (
    <div ref={box} className={cls('ide-perm-seg', className)} role="radiogroup" aria-label={label}>
      {PERM_LEVELS.map(l => (
        <button key={l} type="button" role="radio" data-level={l} aria-checked={value === l} disabled={off(l)} tabIndex={l === tabStop ? 0 : -1}
          className={l === 'yolo' ? 'risky' : undefined} title={titleOf?.(l)} onClick={() => choose(l)} onKeyDown={e => keys(e, l)}>{t.ide.rigTab.level[l]}</button>
      ))}
    </div>
  );
}
