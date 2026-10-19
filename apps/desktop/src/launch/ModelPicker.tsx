import { useId, useState, type JSX } from 'react';
import { ModelIdSchema, type ModelChoice } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import type { ModelPick, Tool } from './model';
import type { ModelsState } from './useModels';

/** Cards shown before « Other… »: Cursor offers hundreds of models, the rest is searched in « Other… ». */
const CARDS = 4;

/** The model the agent picks by itself, when it says which. */
export const defaultModel = (models: readonly ModelChoice[]) => models.find(m => m.isDefault);
/** What the agent will run: the model chosen, or its default; the effort chosen, or that model's default. */
export function effective(models: readonly ModelChoice[], pick: ModelPick): { model?: ModelChoice | { id: string; label: string }; effort?: string } {
  const model = pick.model === null ? defaultModel(models) : models.find(m => m.id === pick.model) ?? { id: pick.model, label: pick.model };
  const effort = pick.effort ?? (model && 'defaultEffort' in model ? model.defaultEffort : undefined);
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}
/** The efforts offered beside a model: its own, else every effort the agent's models take (a model typed in « Other… »). */
export function effortsFor(models: readonly ModelChoice[], pick: ModelPick): string[] {
  const model = pick.model === null ? defaultModel(models) : models.find(m => m.id === pick.model);
  if (model?.efforts) return model.efforts;
  const all: string[] = [];
  for (const m of models) for (const e of m.efforts ?? []) if (!all.includes(e)) all.push(e);
  return all;
}

/** The New session form's « Model » block (#58, mockup ledge-model-picker): the agent's models as cards, its default marked (picking it
 *  passes nothing), « Other… » for an exact id, then the effort where the agent has one. */
export function ModelPicker(p: { tool: Tool; state: ModelsState; pick: ModelPick; remembered: boolean; onPick(pick: ModelPick): void }): JSX.Element {
  const { t } = useI18n();
  const listId = useId();
  const { models } = p.state;
  const fallback = defaultModel(models);
  const known = p.pick.model === null || models.some(m => m.id === p.pick.model);
  const [other, setOther] = useState(!known);
  const [typed, setTyped] = useState(known ? '' : p.pick.model ?? '');
  // The default first, then the others in the agent's order; a chosen model beyond the cards stays in « Other… ».
  const cards = [...(fallback ? [fallback] : []), ...models.filter(m => m !== fallback)].slice(0, CARDS);
  const efforts = effortsFor(models, p.pick);
  const shownEffort = effective(models, p.pick).effort;
  const choose = (model: string | null) => {
    setOther(false);
    const id = model !== null && model === fallback?.id ? null : model;
    const next = { model: id, effort: p.pick.effort };
    // An effort the new model does not take goes back to that model's default.
    if (next.effort && !effortsFor(models, next).includes(next.effort)) next.effort = null;
    p.onPick(next);
  };
  const type = (value: string) => {
    setTyped(value);
    const id = value.trim();
    p.onPick({ model: id && ModelIdSchema.safeParse(id).success ? (id === fallback?.id ? null : id) : null, effort: p.pick.effort });
  };
  const hint = (m: ModelChoice) => (t.launch.modelHints as Record<string, string | undefined>)[`${p.tool}:${m.id}`] ?? m.description;
  const effortLabel = (e: string) => (t.launch.efforts as Record<string, string | undefined>)[e] ?? e;
  const selected = (id: string | null) => !other && (p.pick.model === null ? id === null || id === fallback?.id : p.pick.model === id);

  return (
    <fieldset className="composer-models">
      <legend className="composer-label">{t.launch.modelOf(t.launch.tools[p.tool][0])}</legend>
      {p.remembered && <small className="models-remembered">{t.launch.remembered}</small>}
      <div className="model-cards" role="radiogroup" aria-label={t.launch.modelOf(t.launch.tools[p.tool][0])}>
        {!fallback && (
          <label className={`model-card ${selected(null) ? 'selected' : ''}`}>
            <input type="radio" name="model" checked={selected(null)} onChange={() => choose(null)} />
            <strong>{t.launch.byDefault}</strong><small>{t.launch.byDefaultHint}</small>
          </label>
        )}
        {cards.map(m => (
          <label key={m.id} className={`model-card ${selected(m.id) ? 'selected' : ''}`}>
            <input type="radio" name="model" checked={selected(m.id)} onChange={() => choose(m.id)} />
            <strong>{m.label}{m === fallback && <span className="model-badge">{t.launch.defaultBadge}</span>}</strong>
            {hint(m) && <small>{hint(m)}</small>}
          </label>
        ))}
        <label className={`model-card other ${other ? 'selected' : ''}`}>
          <input type="radio" name="model" checked={other} onChange={() => { setOther(true); type(typed); }} />
          <strong>{t.launch.otherModel}</strong><small>{t.launch.otherModelHint}</small>
        </label>
      </div>
      {other && (
        <>
          <input className="model-other" list={listId} value={typed} autoFocus spellCheck={false} placeholder={t.launch.otherPlaceholder}
            aria-label={t.launch.otherModel} aria-invalid={!!typed.trim() && !ModelIdSchema.safeParse(typed.trim()).success} onChange={e => type(e.target.value)} />
          <datalist id={listId}>{models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
        </>
      )}
      {p.state.status === 'loading' && <small className="models-note">{t.launch.modelsLoading}</small>}
      {p.state.error && <small className="models-note">{t.launch.modelsUnavailable(p.state.error)}</small>}
      {efforts.length > 0 ? (
        <div className="model-effort">
          <span className="composer-label">{t.launch.effort}</span>
          <div className="segmented" role="radiogroup" aria-label={t.launch.effort}>
            {efforts.map(e => (
              <label key={e} className={shownEffort === e ? 'selected' : ''}>
                <input type="radio" name="effort" checked={shownEffort === e}
                  onChange={() => p.onPick({ model: p.pick.model, effort: e === effective(models, { ...p.pick, effort: null }).effort ? null : e })} />
                {effortLabel(e)}
              </label>
            ))}
          </div>
          <small>{t.launch.effortHint}</small>
        </div>
      ) : p.tool === 'cursor' && <small className="models-note">{t.launch.cursorEffort}</small>}
    </fieldset>
  );
}
