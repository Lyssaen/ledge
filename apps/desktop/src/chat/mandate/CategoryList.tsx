import { useId, type JSX } from 'react';
import { MANDATE_CATEGORY_TAGS, type MandateCategory } from '@ledge/protocol';
import { useI18n } from '../../i18n/lang';
import { cls } from '../../shell/cls';

type Stats = Record<MandateCategory, { week: number; pending: number }>;

/** One column's list: its heading (« LEDGE TRANCHE SEUL » / « TE REVIENT TOUJOURS »), then one option per category with its tags. */
function Group({ title, items, chosen, onChoose, count }: {
  title: string; items: readonly MandateCategory[]; chosen: MandateCategory | null; onChoose(c: MandateCategory): void; count(c: MandateCategory): string;
}): JSX.Element {
  const { t } = useI18n();
  const id = useId();
  return (
    <>
      <h3 id={id} className="md-group">{title}</h3>
      <ul role="listbox" aria-labelledby={id} className="md-cats">
        {items.map(c => (
          <li key={c} role="option" aria-selected={c === chosen} tabIndex={0} className={cls('rs-item md-cat', c === chosen && 'sel')}
            onClick={() => onChoose(c)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChoose(c); } }}>
            <span className="rs-item-head"><strong>{t.mandate.category(c)}</strong><span className="st-fill" /><small>{count(c)}</small></span>
            <span className="rs-chips">{MANDATE_CATEGORY_TAGS[c].map(tag => <code key={tag}>{tag}</code>)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The left column of « Ce que Ledge tranche » (maquette p-ledge-mandat): « LEDGE TRANCHE SEUL » with the mandate's own categories and their
 * count of the week (« 6 cette semaine » for the chosen one, the number alone for the others), then « TE REVIENT TOUJOURS » with the rest and
 * « n en attente » or « — ».
 */
export function CategoryList({ self, user, stats, chosen, onChoose }: {
  self: readonly MandateCategory[]; user: readonly MandateCategory[]; stats: Stats; chosen: MandateCategory | null; onChoose(c: MandateCategory): void;
}): JSX.Element {
  const { t } = useI18n();
  const m = t.mandate;
  return (
    <div className="md-list">
      <Group title={m.selfTitle} items={self} chosen={chosen} onChoose={onChoose} count={c => m.week(stats[c].week, c === chosen)} />
      <Group title={m.userTitle} items={user} chosen={chosen} onChoose={onChoose} count={c => (stats[c].pending > 0 ? m.pending(stats[c].pending) : m.none)} />
    </div>
  );
}
