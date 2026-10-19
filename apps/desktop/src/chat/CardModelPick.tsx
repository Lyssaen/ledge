import type { JSX } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Tool } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import type { ModelPick } from '../launch/model';
import { defaultModel, effortsFor } from '../launch/ModelPicker';
import { useModels } from '../launch/useModels';

/** A chat card's model and effort (#58): two lists, the agent's default first (nothing passed); offered once the machine has listed
 *  its models, and not at all by a daemon too old to take them. */
export function CardModelPick(p: { client: DaemonClient; machine: string | undefined; tool: Tool; pick: ModelPick; disabled: boolean; onPick(pick: ModelPick): void }): JSX.Element | null {
  const { t } = useI18n();
  const state = useModels(p.client, p.machine ?? null, p.tool);
  if (state.status !== 'ready' || state.error === 'outdated') return null;
  const fallback = defaultModel(state.models);
  const efforts = effortsFor(state.models, p.pick);
  const effortLabel = (e: string) => (t.launch.efforts as Record<string, string | undefined>)[e] ?? e;
  return (
    <span className="card-model">
      <select aria-label={t.launch.modelOf(t.launch.tools[p.tool][0])} disabled={p.disabled} value={p.pick.model ?? ''}
        onChange={e => { const model = e.target.value || null; const next = { model, effort: p.pick.effort }; p.onPick(next.effort && !effortsFor(state.models, next).includes(next.effort) ? { model, effort: null } : next); }}>
        <option value="">{fallback ? `${fallback.label} · ${t.launch.defaultBadge}` : t.launch.byDefault}</option>
        {state.models.filter(m => m !== fallback).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      {efforts.length > 0 && (
        <select aria-label={t.launch.effort} disabled={p.disabled} value={p.pick.effort ?? ''} onChange={e => p.onPick({ model: p.pick.model, effort: e.target.value || null })}>
          <option value="">{t.launch.effort} · {t.launch.defaultBadge}</option>
          {efforts.map(e => <option key={e} value={e}>{effortLabel(e)}</option>)}
        </select>
      )}
    </span>
  );
}
