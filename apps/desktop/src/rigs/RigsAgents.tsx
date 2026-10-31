import type { JSX } from 'react';
import { PROJECT_COLORS, type Rig, type Session } from '@ledge/protocol';
import { allSeats, rigColor, runtimeLabel } from '@ledge/ui/rigs/model';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { cls } from '../shell/cls';

/** « Agents » (spec §8.2): every seat outside the kernels in one flat table (`allSeats`: working first, then by name); a seat paired with a
 *  Ledge session opens it. */
export function RigsAgents({ rigs, byId, dispatch }: { rigs: readonly Rig[]; byId: ReadonlyMap<string, Session>; dispatch: (a: NavAction) => void }): JSX.Element {
  const { t } = useI18n();
  const r = t.rigsTab;
  const seats = allSeats(rigs);
  if (seats.length === 0) return <p className="lp-none">{r.noAgents}</p>;
  return (
    <table className="rigs-agents" aria-label={r.agents}>
      <thead>
        <tr><th>{r.agentCols.address}</th><th>{r.agentCols.name}</th><th>{r.agentCols.rig}</th><th>{r.agentCols.state}</th><th>{r.agentCols.tool}</th><th>{r.agentCols.context}</th></tr>
      </thead>
      <tbody>
        {seats.map(({ rig, seat }) => {
          const paired = seat.sessionId ? byId.get(seat.sessionId) : undefined;
          const open = paired ? () => dispatch({ type: 'open', id: paired.id }) : undefined;
          return (
            <tr key={`${rig.machine}/${rig.id}/${seat.ref}`} className={cls(paired && 'ra-paired')} onClick={open}>
              <td className="mono">{seat.address}</td>
              <td>{open
                ? <button type="button" className="ra-name" aria-label={r.open(seat.name)} onClick={e => { e.stopPropagation(); open(); }}>{seat.name}</button>
                : <span className="ra-name">{seat.name}</span>}</td>
              <td><span className="ra-rig"><i className="side-swatch" style={{ background: PROJECT_COLORS[rigColor(rig)] }} />{rig.name}</span></td>
              <td className={`rc-${seat.state}`}>{r.seatState[seat.state]}</td>
              <td>{[runtimeLabel(seat.runtime), seat.model].filter(Boolean).join(' · ')}</td>
              <td className="mono">{seat.contextPct !== undefined ? `${Math.round(seat.contextPct)} %` : ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
