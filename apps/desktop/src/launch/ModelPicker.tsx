import { useRef, useState, type JSX } from 'react';
import type { ModelChoice } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import type { ModelPick, Tool } from './model';
import { EffortStepper, ModelMenu, MODEL_ICONS, type MenuModel } from './ModelMenu';
import type { ModelsState } from './useModels';

/** The model the agent picks by itself, when it says which. */
export const defaultModel = (models: readonly ModelChoice[]) => models.find(m => m.isDefault);
/** What the agent will run: the model chosen, or its default; the effort chosen, or that model's default. */
export function effective(models: readonly ModelChoice[], pick: ModelPick): { model?: ModelChoice | { id: string; label: string }; effort?: string } {
  const model = pick.model === null ? defaultModel(models) : models.find(m => m.id === pick.model) ?? { id: pick.model, label: pick.model };
  const effort = pick.effort ?? (model && 'defaultEffort' in model ? model.defaultEffort : undefined);
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}
/** The efforts offered beside a model: its own, else every effort the agent's models take (a model typed as is). */
export function effortsFor(models: readonly ModelChoice[], pick: ModelPick): string[] {
  const model = pick.model === null ? defaultModel(models) : models.find(m => m.id === pick.model);
  if (model?.efforts) return model.efforts;
  const all: string[] = [];
  for (const m of models) for (const e of m.efforts ?? []) if (!all.includes(e)) all.push(e);
  return all;
}

/** The menu's rows for an agent: its default first (« Default » when it names none), then the others in its order. */
export function menuModels(models: readonly ModelChoice[], tool: Tool, t: ReturnType<typeof useI18n>['t']): MenuModel[] {
  const fallback = defaultModel(models);
  const hint = (m: ModelChoice) => (t.launch.modelHints as Record<string, string | undefined>)[`${tool}:${m.id}`] ?? m.description;
  return [
    fallback ? { id: fallback.id, label: fallback.label, description: hint(fallback), isDefault: true } : { id: null, label: t.launch.byDefault, description: t.launch.byDefaultHint, isDefault: true },
    ...models.filter(m => m !== fallback).map(m => ({ id: m.id, label: m.label, description: hint(m) }))
  ];
}

/** A pick with a new model: an effort that model does not take goes back to its default. */
export function withModel(models: readonly ModelChoice[], pick: ModelPick, id: string | null): ModelPick {
  const model = id !== null && id === defaultModel(models)?.id ? null : id;
  const next = { model, effort: pick.effort };
  return next.effort && !effortsFor(models, next).includes(next.effort) ? { model, effort: null } : next;
}
/** A pick with a new effort: the model's own default effort passes nothing. */
export function withEffort(models: readonly ModelChoice[], pick: ModelPick, effort: string): ModelPick {
  return { model: pick.model, effort: effort === effective(models, { ...pick, effort: null }).effort ? null : effort };
}

/** The New session form's « Model » block (#58, mockup ledge-model-picker v2): one field naming the model, which opens the
 *  searchable list, and the effort's stepper beside it where the agent has one. */
export function ModelPicker(p: { tool: Tool; state: ModelsState; pick: ModelPick; remembered: boolean; onPick(pick: ModelPick): void }): JSX.Element {
  const { t } = useI18n();
  const tl = t.launch;
  const { models } = p.state;
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const rows = menuModels(models, p.tool, t);
  const selected = p.pick.model ?? rows[0]!.id;
  const shown = rows.find(m => m.id === selected) ?? { id: selected, label: selected ?? tl.byDefault, description: tl.exactId };
  const efforts = effortsFor(models, p.pick);
  const legend = tl.modelOf(tl.tools[p.tool][0]);

  return (
    <fieldset className="composer-models">
      <legend className="composer-label">{legend}</legend>
      {p.remembered && <small className="models-remembered">{tl.remembered}</small>}
      <div className="model-row">
        <button ref={trigger} type="button" className={cls('model-trigger', open && 'open')} aria-haspopup="dialog" aria-expanded={open}
          aria-label={`${legend} : ${shown.label}`} onClick={() => setOpen(o => !o)}>
          <Icon d={MODEL_ICONS.chip} size={15} />
          <strong>{shown.label}</strong>
          {shown.isDefault && <span className="model-badge">{tl.defaultBadge}</span>}
          <span className="model-desc">{shown.description}</span>
          <Icon d={MODEL_ICONS.upDown} size={15} />
        </button>
        {efforts.length > 0 ? <EffortStepper efforts={efforts} value={effective(models, p.pick).effort} onChange={e => p.onPick(withEffort(models, p.pick, e))} />
          : p.tool === 'cursor' && <span className="effort-none">{tl.cursorEffort}</span>}
      </div>
      {open && trigger.current && (
        <ModelMenu anchor={trigger.current} label={legend} models={rows} selected={selected} total={models.length >= 20 ? models.length : undefined}
          onPick={id => { p.onPick(withModel(models, p.pick, id)); setOpen(false); trigger.current?.focus(); }} onClose={() => setOpen(false)} />
      )}
      {p.state.status === 'loading' && <small className="models-note">{tl.modelsLoading}</small>}
      {p.state.error && <small className="models-note">{tl.modelsUnavailable(p.state.error)}</small>}
    </fieldset>
  );
}
