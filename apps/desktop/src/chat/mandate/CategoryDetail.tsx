import { useState, type JSX } from 'react';
import type { LedgeDecision, LedgeRule, MandateCategory } from '@ledge/protocol';
import { localDay } from '@ledge/ui/chat/ledge/threadModel';
import { useI18n } from '../../i18n/lang';
import { Menu, MenuItem } from '../../shell/Menu';
import { cls } from '../../shell/cls';
import { dayMonth, ruleSource } from './model';

/** When a decision was taken, as the lists write it: the time today, « hier », else jj/mm. */
export function useWhen(): (iso: string) => string {
  const { t } = useI18n();
  return iso => {
    const day = localDay(iso);
    const today = localDay(new Date().toISOString());
    if (day === today) return new Date(iso).toLocaleTimeString(t.time.locale, { hour: '2-digit', minute: '2-digit' });
    const y = new Date(); y.setDate(y.getDate() - 1);
    return day === localDay(y.toISOString()) ? t.mandate.yesterday : dayMonth(day);
  };
}

/** « à valider »: the menu « Valider » / « Rejeter » of a proposed rule. */
function Approve({ rule, onSet, disabled }: { rule: LedgeRule; onSet(id: string, status: 'active' | 'rejected'): void; disabled: boolean }): JSX.Element {
  const { t } = useI18n();
  const m = t.mandate;
  const [open, setOpen] = useState(false);
  return (
    <Menu open={open} onOpenChange={setOpen} label={m.ruleMenu(rule.text)} className="rc-menu-wrap" menuClassName="assign-menu rc-menu"
      trigger={tr => <button type="button" className="md-approve" disabled={disabled} {...tr}>{m.toApprove}</button>}>
      <MenuItem onSelect={() => onSet(rule.id, 'active')}><span>{m.approve}</span></MenuItem>
      <MenuItem onSelect={() => onSet(rule.id, 'rejected')}><span>{m.reject}</span></MenuItem>
    </Menu>
  );
}

/** « Règles retenues »: Règle · Depuis (jj/mm, or « proposée ») · D'où elle vient · Appliquée (« n fois »); a proposed rule in blue with
 *  « à valider ». `withCategory` adds the category (Souvenirs, where every category shows). */
export function RulesTable({ rules, decisions, onSet, disabled, withCategory = false }: {
  rules: readonly LedgeRule[]; decisions: readonly LedgeDecision[]; onSet(id: string, status: 'active' | 'rejected'): void; disabled: boolean; withCategory?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const m = t.mandate;
  return (
    <table className="rs-table md-rules" aria-label={m.rules}>
      <thead><tr><th>{m.cols.rule}</th>{withCategory && <th>{m.cols.category}</th>}<th>{m.cols.since}</th><th>{m.cols.from}</th><th>{m.cols.applied}</th></tr></thead>
      <tbody>
        {rules.map(r => (
          <tr key={r.id} className={cls(r.status === 'proposed' && 'proposed')}>
            <td>{r.text}</td>
            {withCategory && <td>{m.category(r.category)}</td>}
            <td>{m.since(r.status === 'proposed' ? null : r.since)}</td>
            <td>{ruleSource(r, decisions, m.source)}</td>
            <td>{r.status === 'proposed' ? <Approve rule={r} onSet={onSet} disabled={disabled} /> : m.applied(r.appliedCount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A decision's line: when, `seat@rig` (or who decided) and the summary, « règle du jj/mm », « Revenir dessus » (`withCategory`: Souvenirs). */
export function DecisionRow({ d, rules, onRevisit, disabled, withCategory = false }: {
  d: LedgeDecision; rules: readonly LedgeRule[]; onRevisit(d: LedgeDecision): void; disabled: boolean; withCategory?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const m = t.mandate;
  const when = useWhen();
  const rule = d.rule ? rules.find(r => r.id === d.rule) : undefined;
  const who = d.by === 'user' ? m.byYou : 'Ledge';
  return (
    <li className={cls('md-dec', d.revisitedBy && 'revisited')} data-decision={d.id}>
      <span className="md-when">{when(d.at)}</span>
      <span className="md-what"><b>{d.from ?? who}</b> {d.summary}
        {(withCategory || d.from) && <small> · {withCategory ? `${d.category ? m.category(d.category) : '—'} · ` : ''}{who}</small>}</span>
      <span className="md-ruleof">{rule ? m.ruleOf(rule.since) : ''}</span>
      <button type="button" className="md-revisit" disabled={disabled || Boolean(d.revisitedBy)} onClick={() => onRevisit(d)}>{m.revisit}</button>
    </li>
  );
}

/**
 * The right column of « Ce que Ledge tranche » (maquette p-ledge-mandat): the category, « Ledge tranche seul · n décisions cette semaine ·
 * mandat », « Me le remonter désormais » (only for a category Ledge settles), « Règles retenues » and the blue note, the 5 « Dernières
 * décisions », the files box (« Ouvrir » edits the mandate in the app, C26) and the footnote.
 */
export function CategoryDetail(p: {
  category: MandateCategory; isSelf: boolean; week: number; pending: number;
  /** Every rule and every decision (newest first); the column keeps the category's. */
  rules: readonly LedgeRule[]; decisions: readonly LedgeDecision[];
  files: { file: string; memory: string }; offline: boolean;
  onEscalate(c: MandateCategory): void; onSetRule(id: string, status: 'active' | 'rejected'): void; onRevisit(d: LedgeDecision): void; onOpen(): void;
}): JSX.Element {
  const { t } = useI18n();
  const m = t.mandate;
  const label = m.category(p.category);
  const mine = p.rules.filter(r => r.category === p.category);
  const last = p.decisions.filter(d => d.category === p.category).slice(0, 5);
  return (
    <section className="rs-detail md-detail" aria-label={m.categoryOf(label)}>
      <header className="rs-detail-head">
        <div>
          <h3>{label}</h3>
          <p className="rs-line">{p.isSelf ? m.selfLine(p.week) : m.userLine(p.pending)} <code className="md-pill">{m.pill}</code></p>
        </div>
        <span className="st-fill" />
        {p.isSelf && <button type="button" className="st-qa md-escalate" disabled={p.offline} onClick={() => p.onEscalate(p.category)}>{m.escalate}</button>}
      </header>
      <h4>{m.rules}</h4>
      {mine.length === 0 ? <p className="lp-none">{m.noRules}</p> : (
        <RulesTable rules={mine} decisions={p.decisions} onSet={p.onSetRule} disabled={p.offline} />
      )}
      <p className="md-note"><span className="md-blue">{m.blueWord}</span>{m.blueRest}</p>
      <h4>{m.last}</h4>
      {last.length === 0 ? <p className="lp-none">{m.noDecisions}</p> : (
        <ul className="md-decs" aria-label={m.last}>
          {last.map(d => <DecisionRow key={d.id} d={d} rules={p.rules} onRevisit={p.onRevisit} disabled={p.offline} />)}
        </ul>
      )}
      <dl className="rs-facts md-files" role="group" aria-label={m.files.label}>
        <dt>{m.files.mandate}</dt>
        <dd><code>{p.files.file}</code><button type="button" className="st-qa" disabled={p.offline} onClick={p.onOpen}>{m.open}</button></dd>
        <dt>{m.files.memory}</dt>
        <dd><code>{p.files.memory}</code><span>{m.files.count(p.rules.length, p.decisions.length)}</span></dd>
      </dl>
      <p className="home-footnote md-foot"><span aria-hidden="true">✎ </span>{m.footnote}</p>
    </section>
  );
}
