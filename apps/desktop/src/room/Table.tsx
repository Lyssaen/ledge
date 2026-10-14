import type { CSSProperties } from 'react';
import { Bot, botState, poseFor } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { needsAttention } from '../fleet/attention';
import type { Table as TableData } from '../grouping/groups';
import { useTheme } from '../shell/theme';
import { seatPositions, tableSize } from './geometry';

export function Table({ table, selected, onSelect }: { table: TableData; selected: string | null; onSelect: (id: string) => void }) {
  const { t } = useI18n(); const theme = useTheme();
  const count = table.sessions.length; const size = tableSize(count); const seats = seatPositions(count);
  const pending = table.sessions.filter(needsAttention).length;
  const caption = table.kind === 'machine' ? t.room.captions.machine : table.kind === 'story' ? t.room.captions.detected : table.kind === 'all' ? t.room.captions.mine : t.room.captions.unassigned;
  const eyebrow = t.room.eyebrow[table.kind === 'all' ? 'mine' : table.kind === 'machine' ? 'machine' : table.kind === 'story' ? 'detected' : 'unassigned'];
  const style = { '--stage-width': `${size.stageW}px`, '--stage-height': `${size.stageH}px`, '--table-width': `${size.tableW}px`, '--table-height': `${size.tableH}px` } as CSSProperties;
  return (
    <section className="table-group" aria-label={table.label} data-table={table.id} data-participants={count} style={style} title={caption}>
      <div className="room-stage">
        <div className="meeting-table"><span className="table-eyebrow">{eyebrow}</span><strong>{table.label}</strong><small>{pending > 0 ? t.room.pending(pending) : t.room.allGood}</small></div>
        {table.sessions.map((s, i) => {
          const state = botState(s); const pos = seats[i]!;
          return (
            <button key={s.id} type="button" className={`seat${s.offline ? ' offline' : ''}${s.id === selected ? ' selected' : ''}`} style={{ left: `clamp(44px, ${pos.x}%, calc(100% - 44px))`, top: `${pos.y}%` }}
              data-session={s.id} data-offline={s.offline ? 'true' : undefined} aria-pressed={s.id === selected} aria-label={`${s.name} · ${t.states[s.state]}${s.machineName ? ` · ${s.machineName}` : ''}`} onClick={() => onSelect(s.id)}>
              <Bot tool={s.tool} state={state} pose={poseFor(s.id, state)} size={40} theme={theme} seed={s.id} readOnly={!!s.offline} />
              {needsAttention(s) && <span className={`raised ${s.state}`} aria-hidden="true">!</span>}
              <span className="person-name">{s.name}</span>
              <span className="state" data-state={s.state}>{t.states[s.state]}</span>
              {table.kind === 'story' && s.machineName && <span className="seat-machine">{s.machineName}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
