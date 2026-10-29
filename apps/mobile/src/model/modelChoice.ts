import type { PhoneModelChoice, PhoneSession } from '@ledge/protocol';
import { copy } from '../copy';

/** A model and an effort as the phone picks or reads them; `null`: the agent's own default. */
export type Pick = { model: string | null; effort: string | null };

const EFFORTS: Record<string, string> = { low: 'Bas', medium: 'Moyen', high: 'Élevé', xhigh: 'Très élevé', max: 'Max', ultra: 'Ultra' };
const HINTS: Record<string, string> = {
  'claude:fable': 'Le plus capable', 'claude:opus': 'Très capable, plus lent', 'claude:sonnet': 'Équilibré, au quotidien', 'claude:haiku': 'Rapide et économique'
};

/** A model by the listing's label, else by its id; none: « Par défaut », with the default's name when the listing knows it. */
export function modelLabel(_tool: string, id: string | undefined, models: PhoneModelChoice[]): string {
  if (id === undefined) {
    const d = models.find(m => m.isDefault);
    return d ? `${copy.model.byDefault} · ${d.label}` : copy.model.byDefault;
  }
  return models.find(m => m.id === id)?.label ?? id;
}

export const effortLabel = (e: string): string => EFFORTS[e] ?? e;

/** What a model is for, in French for the ones Ledge knows, else what the agent says. */
export const modelHint = (tool: string, m: PhoneModelChoice): string | undefined => HINTS[`${tool}:${m.id}`] ?? m.description;

export const samePick = (a: Pick, b: Pick): boolean => a.model === b.model && a.effort === b.effort;

/** What the session runs now. */
export const running = (s: PhoneSession): Pick => ({ model: s.model ?? null, effort: s.effort ?? null });

/** The efforts the picked model takes (the default model's when none is picked); none for an agent without a separate effort. */
export function efforts(tool: string, models: PhoneModelChoice[], pick: Pick): string[] | null {
  if (tool === 'cursor') return null;
  const m = pick.model === null ? models.find(x => x.isDefault) : models.find(x => x.id === pick.model);
  return m?.efforts && m.efforts.length > 0 ? m.efforts : null;
}
