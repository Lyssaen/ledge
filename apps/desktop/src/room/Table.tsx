import type { CSSProperties } from 'react';
import { useI18n } from '../i18n/lang';
import { needsAttention } from '../fleet/attention';
import type { Table as TableData } from '../grouping/groups';
import { Avatar, StateBadge, useStateLabel } from '../shell/Person';
import { seatPositions, tableSize } from './geometry';

export function Table({ table, selected, onSelect }: { table: TableData; selected: string | null; onSelect: (id: string) => void }) {
  const { t } = useI18n(); const stateLabel = useStateLabel();
  const count = table.sessions.length; const size = tableSize(count); const seats = seatPositions(count);
  const pending = table.sessions.filter(needsAttention).length;
  // Every table of the Jira grouping (a story, none or several) says where each agent runs, as the mockup does.
  const byStory = table.kind === 'story' || table.kind === 'unassigned' || table.kind === 'ambiguous';
  const caption = table.kind === 'machine' ? t.room.captions.machine : table.kind === 'story' ? t.room.captions.detected : table.kind === 'all' ? t.room.captions.mine : t.room.captions.unassigned;
  const eyebrow = t.room.eyebrow[table.kind === 'all' ? 'mine' : table.kind === 'machine' ? 'machine' : table.kind === 'story' ? 'detected' : 'unassigned'];
  const style = { '--stage-width': `${size.stageW}px`, '--stage-height': `${size.stageH}px`, '--table-width': `${size.tableW}px`, '--table-height': `${size.tableH}px` } as CSSProperties;
  return (
    <section className="table-group" aria-label={table.label} data-table={table.id} data-participants={count} style={style} title={caption}>
      <div className="room-stage">
        <div className="meeting-table"><span className="table-eyebrow">{eyebrow}</span><strong>{table.label}</strong><small>{pending > 0 ? t.room.pending(pending) : t.room.allGood}</small></div>
        {table.sessions.map((s, i) => {
          const pos = seats[i]!;
          return (
            <button key={s.id} type="button" className={`seat${s.offline ? ' offline' : ''}${s.id === selected ? ' selected' : ''}`} style={{ left: `clamp(44px, ${pos.x}%, calc(100% - 44px))`, top: `${pos.y}%` }}
              data-session={s.id} data-offline={s.offline ? 'true' : undefined} aria-pressed={s.id === selected} aria-label={[s.name, stateLabel(s), s.machineName].filter(Boolean).join(', ')} onClick={() => onSelect(s.id)}>
              <Avatar session={s} size={count >= 5 ? 49 : 42} />
              {needsAttention(s) && <span className={`raised ${s.state}`} aria-hidden="true">!</span>}
              <span className="person-name">{s.name}</span>
              <StateBadge session={s} />
              {byStory && s.machineName && <span className="seat-machine">{s.machineName}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
