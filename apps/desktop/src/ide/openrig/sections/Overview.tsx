import type { JSX } from 'react';
import { KERNEL_RIG, type HumanAsk, type OpenRigState, type Session } from '@ledge/protocol';
import { useI18n } from '../../../i18n/lang';
import { openClick, type NavAction, type OpenRigSection } from '../../../nav/state';
import type { RigOutputEntry } from '../../../openrig/rigOutput';
import { cls } from '../../../shell/cls';
import type { Tab } from '../../../workspace/model';
import { providerOf } from '../../../workspace/sessionTab';
import { rigTab } from '../../../workspace/store';
import { OutputView } from '../../OutputView';
import { ProviderLogo } from '../../ProviderLogo';
import { recentCommands, roleLabel, tilesOf, waitingSeats } from '../model';

export interface OverviewProps {
  state: OpenRigState; machine: string; label: string; sessions: readonly Session[]; asks: readonly HumanAsk[]; output: readonly RigOutputEntry[];
  dispatch(a: NavAction): void; onTab(tab: Tab): void;
}

/** Vue d'ensemble (R12, mockup `orPageB` « apercu »): four tiles that lead to their section, the seats waiting for the person, the last commands. */
export function Overview({ state, machine, label, sessions, asks, output, dispatch, onTab }: OverviewProps): JSX.Element {
  const { t, lang } = useI18n();
  const p = t.ide.openrigPage, o = t.openrig;
  const tiles = tilesOf(state, sessions, asks, machine, lang);
  const waiting = waitingSeats(state, sessions, asks, machine);
  const go = (section: OpenRigSection) => dispatch({ type: 'openrig', machine, section });
  const d = tiles.daemon;
  return (
    <>
      <div className="ide-orp-tiles">
        <button type="button" className="ide-orp-tile" onClick={() => go('daemon')}>
          <small>{o.daemon}</small><b>{d.up ? p.running : p.stopped}</b><span>{d.up && d.version ? (d.since ? p.since(d.version, d.since) : d.version) : '—'}</span>
        </button>
        <button type="button" className="ide-orp-tile" onClick={() => onTab(rigTab(machine, KERNEL_RIG))}>
          <small>{o.kernel}</small><b>{tiles.kernel.up ? p.seats(tiles.kernel.seats) : p.stopped}</b><span>{tiles.kernel.roles.join(', ') || '—'}</span>
        </button>
        <button type="button" className="ide-orp-tile" onClick={() => go('rigs')}>
          <small>{o.rigs}</small><b>{p.rigsOf(tiles.rigs.running, tiles.rigs.total)}</b><span>{p.runningOn(label)}</span>
        </button>
        <button type="button" className={cls('ide-orp-tile', tiles.seats.waiting > 0 && 'warn')} onClick={() => go('rigs')}>
          <small>{t.ide.launchRig.seats}</small><b>{p.active(tiles.seats.active)}</b><span>{p.waiting(tiles.seats.waiting)}</span>
        </button>
      </div>
      {waiting.length > 0 && (
        <section className="ide-orp-blk" role="group" aria-label={p.waitingTitle}>
          <div className="ide-orp-blk-h"><b>{p.waitingTitle}</b></div>
          <div className="ide-orp-blk-b">
            {waiting.map(({ rig, seat, kind }) => seat.session && (
              <button key={`${rig}/${seat.logicalId}`} type="button" className="ide-orp-wait" onClick={e => dispatch(openClick(seat.session!.id, e))}>
                <i className={`ide-rigs-dot d-${seat.dot}`} aria-hidden="true" /><ProviderLogo provider={providerOf(seat.session.tool)} size={12} />
                <b>{seat.name}</b><span className="ide-orp-mut">{rig} · {roleLabel(rig, seat.logicalId)}</span><span className="ide-orp-meta">{p.kind[kind]}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="ide-orp-blk" role="group" aria-label={p.recent}>
        <div className="ide-orp-blk-h"><b>{p.recent}</b><span className="ide-orp-sp" /><button type="button" className="ide-orp-lnk" onClick={() => go('output')}>{p.seeAll}</button></div>
        <div className="ide-orp-term short"><OutputView entries={recentCommands(output, machine)} /></div>
      </section>
    </>
  );
}
