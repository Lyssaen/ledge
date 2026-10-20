import { useRef, useState, type JSX } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Tool } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { ModelPick } from '../launch/model';
import { EffortStepper, ModelMenu, MODEL_ICONS } from '../launch/ModelMenu';
import { effective, effortsFor, menuModels, withEffort, withModel } from '../launch/ModelPicker';
import { useModels } from '../launch/useModels';
import { cls } from '../shell/cls';

/** A chat card's model and effort (#58, #62): one « model · effort » chip opening the launch form's searchable list, with the
 *  effort's stepper at its foot; a pick keeps the list open. Offered once the machine has listed its models, and not at all by a
 *  daemon too old to take them. */
export function CardModelPick(p: { client: DaemonClient; machine: string | undefined; tool: Tool; pick: ModelPick; disabled: boolean; onPick(pick: ModelPick): void }): JSX.Element | null {
  const { t } = useI18n();
  const tl = t.launch;
  const state = useModels(p.client, p.machine ?? null, p.tool);
  const chip = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (state.status !== 'ready' || state.error === 'outdated') return null;
  const { models } = state;
  const rows = menuModels(models, p.tool, t);
  const selected = p.pick.model ?? rows[0]!.id;
  const name = p.pick.model === null ? rows[0]!.label : rows.find(m => m.id === p.pick.model)?.label ?? p.pick.model;
  const e = effective(models, p.pick).effort;
  const text = e ? `${name} · ${(tl.efforts as Record<string, string | undefined>)[e] ?? e}` : name;
  const efforts = effortsFor(models, p.pick);
  const legend = tl.modelOf(tl.tools[p.tool][0]);
  return (
    <span className="card-model">
      <button ref={chip} type="button" className={cls('model-chip', open && 'open')} disabled={p.disabled} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${legend} : ${text}`} onClick={() => setOpen(o => !o)}>
        <Icon d={MODEL_ICONS.chip} size={14} />
        <span className="model-chip-text">{text}</span>
        <Icon d={MODEL_ICONS.down} size={14} />
      </button>
      {open && chip.current && (
        <ModelMenu anchor={chip.current} label={legend} models={rows} selected={selected} total={models.length >= 20 ? models.length : undefined}
          onPick={id => p.onPick(withModel(models, p.pick, id))} onClose={() => setOpen(false)}>
          {(efforts.length > 0 || p.tool === 'cursor') && (
            <div className="model-menu-foot">
              <div className="model-menu-effort">{tl.effort}
                {efforts.length > 0
                  ? <EffortStepper efforts={efforts} value={e} onChange={x => p.onPick(withEffort(models, p.pick, x))} />
                  : <span className="effort-none">{tl.cursorEffort}</span>}
              </div>
            </div>
          )}
        </ModelMenu>
      )}
    </span>
  );
}
