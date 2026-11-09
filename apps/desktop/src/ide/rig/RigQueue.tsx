import type { JSX } from 'react';
import type { RigRow, Session } from '@ledge/protocol';
import { useI18n } from '../../i18n/lang';
import { queueLines } from './model';
import '../../styles/ide-rig.css';

/** The rig's open OpenRig requests (docs/mockups/ledge-ide-rigs.html `topoPage`, « File OpenRig »): hidden when there is none. */
export function RigQueue({ rows, truncated, sessions, machine, now }: { rows: readonly RigRow[]; truncated: boolean; sessions: readonly Session[]; machine: string; now: number }): JSX.Element | null {
  const { t } = useI18n();
  const r = t.ide.rigTab;
  if (rows.length === 0) return null;
  return (
    <section className="ide-rig-block" aria-label={r.queue}>
      <header className="ide-rig-head"><b>{r.queue}</b></header>
      <div className="ide-rig-body">
        {queueLines(rows, sessions, machine, now).map(l => (
          <div key={l.id} className="ide-rig-qrow">
            <span className={`ide-rig-qstate s-${l.state}`} title={r.state[l.state] ?? l.state}>{r.state[l.state] ?? l.state}</span>
            {l.needsInput && <b className="ide-rig-ask" title={r.needsInput} aria-label={r.needsInput}>!</b>}
            <span className="ide-rig-qsum">{l.summary || l.id.slice(0, 12)}</span>
            <span className="ide-rig-qwho">{`${l.from} → ${l.to}`}</span>
            <span className="ide-rig-qage">{r.age(l.age)}</span>
          </div>
        ))}
        {truncated && <p className="ide-rig-empty">{r.queueTruncated}</p>}
      </div>
    </section>
  );
}
