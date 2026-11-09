import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { OpenRigView } from '@ledge/fleet/openrig';
import type { HumanAsk, OpenRigAction, OpenRigState, Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../../../i18n/lang';
import { isRunning, kernelRig, listedRigs, targetOf } from '../../../openrig/model';
import type { Tab } from '../../../workspace/model';
import { rigTab } from '../../../workspace/store';
import { rigErrorText } from '../../rig/errors';
import { RigConfirm, useRigConfirm } from '../../rigs/RigConfirm';
import { powerOf, rigsViewOf } from '../../rigs/model';
import { POWER_GLYPH } from '../glyphs';
import { prefAction, type DaemonPrefs } from '../prefs';
import { RigCard } from './RigCard';

export interface RigsProps {
  client: DaemonClient; view: OpenRigView; state: OpenRigState; machine: string; label: string; prefs: DaemonPrefs;
  sessions: readonly Session[]; asks: readonly HumanAsk[]; onTab(tab: Tab): void; onLaunch(machine: string): void;
}

/** Rigs (R13, mockup `orPageB` « rigs »): the kernel's card first, then one per rig, then the dashed card that launches one. */
export function Rigs({ client, view, state, machine, label, prefs, sessions, asks, onTab, onLaunch }: RigsProps): JSX.Element {
  const { t } = useI18n();
  const v = t.ide.rigsView, p = t.ide.openrigPage;
  const up = state.daemon.state === 'running';
  const kernel = up ? kernelRig(state) : undefined;
  const rigs = up ? listedRigs(state) : [];
  const lines = rigsViewOf({ state, machine, sessions, asks });
  const dotOf = (name: string) => (name === kernel?.name ? lines.kernel : lines.rigs.find(r => r.name === name))?.dot ?? 'off';

  // A confirmation lives only while the rig it is about still runs.
  const offered = (a: OpenRigAction): boolean => {
    const target = targetOf(a);
    const r = target === 'kernel' ? kernel : rigs.find(x => x.name === target);
    return up && !!r && isRunning(r);
  };
  const conf = useRigConfirm(view, offered, { prefs, state });
  useEffect(() => { conf.reset(); }, [machine]); // eslint-disable-line react-hooks/exhaustive-deps
  const root = useRef<HTMLDivElement>(null);
  const nameOf = (target: string) => [...(root.current?.querySelectorAll<HTMLElement>('.ide-orp-card') ?? [])].find(c => c.dataset.target === target)?.querySelector<HTMLElement>('.ide-orp-name');
  const pendingOn = (target: string) => view.pending !== null && targetOf(view.pending) === target;

  const power = (target: string, what: string, running: boolean): ReactNode => !up ? null : (
    <span className="ide-orp-pw ide-orp-cpw">
      {powerOf(running).map(verb => {
        const name = v[verb](what);
        return <button key={verb} type="button" className={`ide-orp-ib icon ${verb}`} title={name} aria-label={name} disabled={pendingOn(target)}
          onClick={e => conf.ask(prefAction(target, verb, prefs), e.currentTarget, () => nameOf(target))}><Icon d={POWER_GLYPH[verb]} size={13} /></button>;
      })}
    </span>
  );
  const under = (target: string): ReactNode => {
    const d = view.last;
    return (
      <>
        {conf.confirm && targetOf(conf.confirm) === target && <RigConfirm action={conf.confirm} state={state} sessions={sessions} machine={machine} label={label} onConfirm={() => conf.run(conf.confirm!)} onCancel={conf.close} />}
        {d && !d.ok && conf.lastTarget === target && <div className="ide-orp-err" role="alert">{rigErrorText(t, d.error ?? '')}</div>}
      </>
    );
  };

  return (
    <>
      {!up && <p className="ide-orp-note flat" role="status"><b>{v.stoppedTitle}</b> {v.stoppedBody}</p>}
      <div ref={root} className="ide-orp-cards">
        {kernel && <RigCard client={client} machine={machine} rig={kernel} kernel running={isRunning(kernel)} dot={dotOf(kernel.name)}
          power={power('kernel', v.whatKernel, isRunning(kernel))} under={under('kernel')} onOpen={() => onTab(rigTab(machine, kernel.name))} />}
        {rigs.map(r => (
          <RigCard key={r.name} client={client} machine={machine} rig={r} kernel={false} running={isRunning(r)} dot={dotOf(r.name)}
            power={power(r.name, r.name, isRunning(r))} under={under(r.name)} onOpen={() => onTab(rigTab(machine, r.name))} />
        ))}
        <button type="button" className="ide-orp-card ide-orp-new" onClick={() => onLaunch(machine)}>
          <Icon d={ICONS.plus.d} size={14} /><b>{v.launchTitle}</b><span>{p.newSub}</span>
        </button>
      </div>
    </>
  );
}
