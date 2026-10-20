import { useEffect, useRef, useState, type JSX } from 'react';
import { useMachines, type DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { ModelPick } from '../launch/model';
import { EffortStepper, ModelMenu, MODEL_ICONS } from '../launch/ModelMenu';
import { effective, effortsFor, menuModels, withEffort, withModel } from '../launch/ModelPicker';
import { useModels } from '../launch/useModels';
import { cls } from '../shell/cls';

/**
 * A live session's model and effort (#58 lot 2, mockup ledge-model-picker v2): a chip in the reply bar, which opens the
 * agent's models and its effort. Apply restarts the agent on the same conversation with them; while it works the change
 * is scheduled and the chip says « next turn ». Only where the machine's daemon takes `session.model`.
 */
export function SessionModel(p: { client: DaemonClient; session: Session; notify(text: string): void }): JSX.Element | null {
  const { t } = useI18n();
  const tl = t.launch; const tm = t.session.model;
  const { session } = p;
  const machine = session.machineId ?? 'local';
  const daemon = useMachines(p.client).find(m => m.id === machine)?.daemon;
  const able = !!daemon?.modelSwitch && session.source === 'launcher' && session.state !== 'exited';
  const state = useModels(p.client, able ? machine : null, session.tool);
  const chip = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const runs: ModelPick = { model: session.model ?? null, effort: session.effort ?? null };
  const next = session.modelNext;
  const shown: ModelPick = next ? { model: next.model ?? null, effort: next.effort ?? null } : runs;
  const [draft, setDraft] = useState<ModelPick>(shown);

  // A refusal of this session's change comes back as an error naming it.
  useEffect(() => p.client.onMessage(m => {
    if (m.type === 'error' && m.request === 'session.model' && m.id === session.id) p.notify(tm.refused(m.message));
  }), [p.client, session.id]);
  if (!able) return null;

  const { models } = state;
  const rows = menuModels(models, session.tool, t);
  const nameOf = (pick: ModelPick) => (pick.model === null ? rows[0]!.label : rows.find(m => m.id === pick.model)?.label ?? pick.model);
  const effortOf = (pick: ModelPick) => { const e = effective(models, pick).effort; return e ? (tl.efforts as Record<string, string | undefined>)[e] ?? e : undefined; };
  const text = (pick: ModelPick) => { const e = effortOf(pick); return e ? `${nameOf(pick)} · ${e}` : nameOf(pick); };
  const efforts = effortsFor(models, draft);
  const working = session.state !== 'idle' && session.state !== 'error';
  const unchanged = draft.model === shown.model && draft.effort === shown.effort;
  const toggle = () => { setDraft(shown); setOpen(o => !o); };
  const apply = () => {
    if (unchanged) return;
    p.client.send({ type: 'session.model', id: session.id, model: draft.model, effort: draft.effort });
    setOpen(false); chip.current?.focus();
  };

  return (
    <>
      <button ref={chip} type="button" className={cls('model-chip', open && 'open', next && 'scheduled')} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${tm.label} : ${text(shown)}${next ? ` (${tm.nextTurn})` : ''}`} title={tm.label} onClick={toggle}>
        <Icon d={MODEL_ICONS.chip} size={14} />
        <span className="model-chip-text">{text(shown)}</span>
        {next && <span className="model-chip-next">{tm.nextTurn}</span>}
        <Icon d={MODEL_ICONS.down} size={14} />
      </button>
      {open && chip.current && (
        <ModelMenu anchor={chip.current} up label={tm.label} models={rows} selected={draft.model ?? rows[0]!.id} current={runs.model ?? rows[0]!.id}
          total={models.length >= 20 ? models.length : undefined} onPick={id => setDraft(d => withModel(models, d, id))} onClose={() => setOpen(false)}>
          <div className="model-menu-foot">
            {efforts.length > 0 && (
              <div className="model-menu-effort">{tl.effort}
                <EffortStepper efforts={efforts} value={effective(models, draft).effort} onChange={e => setDraft(d => withEffort(models, d, e))} />
              </div>
            )}
            <div className="model-menu-actions">
              <small>{working ? tm.scheduleHint(session.name) : tm.applyHint(session.name)}</small>
              <Button variant="ghost" size="sm" onClick={() => { setOpen(false); chip.current?.focus(); }}>{tm.cancel}</Button>
              <Button variant="primary" size="sm" disabled={unchanged} onClick={apply}>{working ? tm.schedule : tm.apply}</Button>
            </div>
          </div>
        </ModelMenu>
      )}
    </>
  );
}
