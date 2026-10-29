import type { ReactNode } from 'react';
import type { PhoneModelChoice } from '@ledge/protocol';
import { copy } from '../copy';
import { effortLabel, efforts, modelHint, type Pick } from '../model/modelChoice';
import { Segmented } from './Segmented';

/** The id of the title: the `Sheet` around names itself by it. */
export const MODEL_TITLE_ID = 'model-sheet-title';

const ROW = 'flex min-h-12 w-full items-center gap-3 rounded-control border border-line bg-surface px-3 py-2.5 text-left active:bg-raised aria-pressed:border-fg/40 aria-pressed:bg-raised';

/**
 * What a model change asks, as the mockup draws it: « Par défaut » then the models the PC knows, the effort the picked
 * model takes, a note, and the footer the caller gives. Nothing is sent from here: picking only moves `pick`.
 */
export function ModelSheet({ tool, models, error, current, pick, onPick, note, actions }: {
  tool: string; models: PhoneModelChoice[]; error: boolean | undefined; current: Pick; pick: Pick; onPick: (p: Pick) => void;
  note: string; actions: ReactNode;
}) {
  const known = current.model === null || models.some(m => m.id === current.model);
  const levels = efforts(tool, models, pick);
  const choose = (model: string | null) => {
    const next = efforts(tool, models, { model, effort: null });
    onPick({ model, effort: pick.effort !== null && next?.includes(pick.effort) ? pick.effort : null });
  };
  const row = (model: string | null, label: string, hint: string | undefined) => (
    <button key={model ?? ''} type="button" aria-pressed={pick.model === model} onClick={() => choose(model)} className={ROW}>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium">{label}</span>
        {hint && <span className="block text-meta text-muted">{hint}</span>}
      </span>
      {current.model === model && <span className="flex-none rounded-full bg-raised px-2 py-0.5 text-meta text-muted">{copy.model.current}</span>}
    </button>
  );
  const shown = levels && (pick.effort ?? models.find(m => (pick.model === null ? m.isDefault : m.id === pick.model))?.defaultEffort ?? '');
  return (
    <>
      <div>
        <h2 id={MODEL_TITLE_ID} className="text-heading leading-[1.3] font-semibold tracking-[-.5px]">{copy.model.title}</h2>
        <p className="mt-1 text-meta text-muted">{copy.model.subtitle(copy.tools[tool as keyof typeof copy.tools] ?? tool)}</p>
      </div>
      {error && <p role="status" className="text-meta text-attention">{copy.model.listError}</p>}
      <div className="flex max-h-[45vh] flex-col gap-1.5 overflow-y-auto">
        {row(null, copy.model.byDefault, copy.model.defaultHint)}
        {!known && current.model !== null && row(current.model, current.model, undefined)}
        {models.map(m => row(m.id, m.label, modelHint(tool, m)))}
      </div>
      {levels && (
        <div>
          <p className="text-body font-medium">{copy.model.effortTitle} <span className="text-meta font-normal text-muted">{copy.model.effortHint}</span></p>
          <div className="mt-2">
            <Segmented name="model-effort" legend={copy.model.effortTitle} value={shown ?? ''} onChange={e => onPick({ model: pick.model, effort: e })}
              options={levels.map(e => ({ value: e, label: effortLabel(e) }))} />
          </div>
        </div>
      )}
      <p className="text-small whitespace-pre-line text-muted">{note}</p>
      {actions}
    </>
  );
}
