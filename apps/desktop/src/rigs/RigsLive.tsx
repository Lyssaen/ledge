import type { JSX } from 'react';
import type { OpenRigStatus, Rig, RigSeat, Session } from '@ledge/protocol';
import { rigFilter, type rigsModel } from '@ledge/ui/rigs/model';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { KernelCard, RigCard } from './RigCard';

/** « En cours » (spec §8.2): one card per rig, by name, then the kernels (the local one first). */
export function RigsLive({ model, openrig, byId, dispatch, onTerminal }: {
  model: ReturnType<typeof rigsModel>; openrig: readonly OpenRigStatus[]; byId: ReadonlyMap<string, Session>;
  dispatch: (a: NavAction) => void; onTerminal(rig: Rig, seat: RigSeat): void;
}): JSX.Element {
  const { t } = useI18n();
  const open = (id: string) => dispatch({ type: 'open', id });
  if (model.rigs.length === 0 && model.kernels.length === 0) return <p className="lp-none">{t.rigsTab.noRigs}</p>;
  return (
    <div className="rigs-live">
      {model.rigs.map(row => (
        <RigCard key={row.key} rig={row.rig} place={row.place} byId={byId} onOpen={open}
          onTable={() => dispatch({ type: 'home', project: rigFilter(row.rig) })} onTerminal={seat => onTerminal(row.rig, seat)} />
      ))}
      {model.kernels.map(k => <KernelCard key={k.key} rig={k.rig} byId={byId} status={openrig.find(s => s.machine === k.rig.machine)} onOpen={open} />)}
    </div>
  );
}
