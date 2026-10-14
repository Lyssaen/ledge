import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { tables, type Grouping } from '../grouping/groups';
import { Table } from './Table';

export function RoomView({ sessions, grouping, selected, onSelect, onGrouping }: { sessions: Session[]; grouping: Grouping; selected: string | null; onSelect: (id: string) => void; onGrouping: (g: Grouping) => void }) {
  const { t } = useI18n();
  const groups = tables(sessions, grouping, t);
  return (
    <section className="central room-central">
      <div className="room-toolbar">
        <label htmlFor="table-grouping">{t.room.grouping}</label>
        <select id="table-grouping" value={grouping} onChange={e => onGrouping(e.target.value as Grouping)}>
          {(['all', 'machine', 'jira'] as const).map(g => <option key={g} value={g}>{t.room.groupings[g]}</option>)}
        </select>
        <span>{t.room.tableCount(groups.length)}</span>
      </div>
      <div className={`table-groups${grouping === 'all' ? ' single-table' : ''}`}>
        {groups.map(g => <Table key={g.id} table={g} selected={selected} onSelect={onSelect} />)}
      </div>
    </section>
  );
}
