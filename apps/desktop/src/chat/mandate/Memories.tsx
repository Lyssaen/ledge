import { useMemo, useState, type JSX } from 'react';
import type { LedgeDecision, LedgeRule, MandateCategory, Rig } from '@ledge/protocol';
import { useI18n } from '../../i18n/lang';
import { DecisionRow, RulesTable } from './CategoryDetail';
import { CATEGORIES, filterMemories } from './model';

/** A rig's name for the filter: the listed rig's, else the `@rig` of a decision's seat, else its id. */
function rigLabel(id: string, rigs: readonly Rig[], decisions: readonly LedgeDecision[]): string {
  const listed = rigs.find(r => r.id === id)?.name;
  if (listed) return listed;
  const seat = decisions.find(d => d.rigId === id && d.from?.includes('@'))?.from;
  return seat ? seat.slice(seat.indexOf('@') + 1) : id;
}

/**
 * « Souvenirs » (lot 7): every rule (with its category), then the whole history the daemon serves, filtered by who decided (« Ledge / toi »),
 * by category and by rig, each line with « Revenir dessus ».
 */
export function Memories({ rules, decisions, rigs, offline, onSetRule, onRevisit }: {
  rules: readonly LedgeRule[]; decisions: readonly LedgeDecision[]; rigs: readonly Rig[]; offline: boolean;
  onSetRule(id: string, status: 'active' | 'rejected'): void; onRevisit(d: LedgeDecision): void;
}): JSX.Element {
  const { t } = useI18n();
  const m = t.mandate;
  const f = m.filters;
  const [by, setBy] = useState<'' | 'ledge' | 'user'>('');
  const [category, setCategory] = useState<'' | MandateCategory>('');
  const [rig, setRig] = useState('');
  const rigIds = useMemo(() => [...new Set(decisions.flatMap(d => (d.rigId ? [d.rigId] : [])))], [decisions]);
  const shown = filterMemories(decisions, { ...(by ? { by } : {}), ...(category ? { category } : {}), ...(rig ? { rig } : {}) });
  return (
    <section className="md-memories" aria-label={m.memoriesTitle}>
      <h4>{m.rules}</h4>
      {rules.length === 0 ? <p className="lp-none">{m.noRules}</p> : <RulesTable rules={rules} decisions={decisions} onSet={onSetRule} disabled={offline} withCategory />}
      <p className="md-note"><span className="md-blue">{m.blueWord}</span>{m.blueRest}</p>
      <div className="md-mem-head">
        <h4>{m.decisions}</h4>
        <span className="st-fill" />
        <label className="rigs-machine">{f.who}
          <select aria-label={f.who} value={by} onChange={e => setBy(e.target.value as typeof by)}>
            <option value="">{f.everyone}</option><option value="ledge">{f.ledge}</option><option value="user">{f.you}</option>
          </select>
        </label>
        <label className="rigs-machine">{f.category}
          <select aria-label={f.category} value={category} onChange={e => setCategory(e.target.value as typeof category)}>
            <option value="">{f.allCategories}</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{m.category(c)}</option>)}
          </select>
        </label>
        <label className="rigs-machine">{f.rig}
          <select aria-label={f.rig} value={rig} onChange={e => setRig(e.target.value)}>
            <option value="">{f.allRigs}</option>
            {rigIds.map(id => <option key={id} value={id}>{rigLabel(id, rigs, decisions)}</option>)}
          </select>
        </label>
      </div>
      {shown.length === 0 ? <p className="lp-none">{m.noDecisions}</p> : null}
      <ul className="md-decs" aria-label={m.decisions}>
        {shown.map(d => <DecisionRow key={d.id} d={d} rules={rules} onRevisit={onRevisit} disabled={offline} withCategory />)}
      </ul>
    </section>
  );
}
