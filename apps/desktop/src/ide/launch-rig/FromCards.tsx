import { useId, type JSX, type ReactNode } from 'react';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../../i18n/lang';
import { cls } from '../../shell/cls';
import { SHELL_ICONS } from '../../shell/icons';
import type { FromChoice, LaunchFrom } from './model';
import { Row } from './parts';

/** A choice's key, to compare two of them. */
export const fromKey = (f: LaunchFrom | null): string => (f === null ? '' : f.kind === 'rig' ? `rig:${f.rig}` : f.kind === 'spec' ? `spec:${f.spec}` : f.kind);

/** « Partir de » (R1, mockup `.agents.rl-from`): one card per choice, a greyed one saying why. */
export function FromCards({ choices, chosen, onPick }: { choices: readonly FromChoice[]; chosen: LaunchFrom | null; onPick(f: LaunchFrom): void }): JSX.Element {
  const { t } = useI18n();
  const L = t.ide.launchRig;
  const id = useId();
  const face = (c: FromChoice): { icon: ReactNode; title: string; sub: string } => {
    switch (c.from.kind) {
      case 'rig': return { icon: <i className={`ide-rl-dot ${c.running ? 'd-work' : 'd-off'}`} aria-hidden="true" />, title: c.title, sub: c.running ? L.running : L.stoppedRig(c.seats) };
      case 'spec': return { icon: null, title: c.title, sub: L.savedSpec(c.seats, c.source) };
      case 'empty': return { icon: <Icon d={ICONS.plus.d} size={14} />, title: L.empty, sub: c.disabled ? L.noFactory : L.emptySub };
      case 'operator': return { icon: <Icon d={SHELL_ICONS.chat} size={14} />, title: L.operator, sub: c.disabled ? L.kernelOff : L.operatorSub };
    }
  };
  return (
    <Row label={L.from} id={id}>
      <div className="ide-rl-from" role="group" aria-labelledby={id}>
        {choices.map(c => {
          const f = face(c), on = fromKey(c.from) === fromKey(chosen);
          return (
            <button key={fromKey(c.from)} type="button" className={cls('ide-rl-card', on && 'on')} aria-pressed={on} disabled={c.disabled !== false} onClick={() => onPick(c.from)}>
              <span className="an">{f.icon}{f.title}</span><small>{f.sub}</small>
            </button>
          );
        })}
      </div>
    </Row>
  );
}
