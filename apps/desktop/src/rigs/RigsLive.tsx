import { useState, type JSX, type ReactNode } from 'react';
import type { OpenRigStatus, Projects, Rig, RigSeat, Session } from '@ledge/protocol';
import { rigFilter, type rigsModel } from '@ledge/ui/rigs/model';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { Menu, MenuItem } from '../shell/Menu';
import { SHELL_ICONS } from '../shell/icons';
import { KernelCard, RigCard } from './RigCard';
import { isLaunching, LaunchNote } from './LaunchNote';
import { RigRepos } from './RigRepos';
import { useRigControls, type RigControls } from './useRigActions';

/** A « … » of the Rigs tab: a rig's or a seat's menu. */
function More({ label, disabled, children }: { label: string; disabled?: boolean; children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Menu open={open} onOpenChange={setOpen} label={label} className="rc-menu-wrap" menuClassName="assign-menu rc-menu"
      trigger={tr => <button type="button" className="icon-action rc-more-actions" aria-label={label} title={label} disabled={disabled} {...tr}><Icon d={[]} fill={SHELL_ICONS.dots} size={14} /></button>}>
      {children}
    </Menu>
  );
}

/** What acts on a rig card (spec §4.5, §4.6): a launching rig's « Annuler le lancement » (no confirmation: nothing worked yet), « Ouvrir
 *  l'invite » for a seat waiting for the user's trust (its terminal: Ledge types nothing there) and the note at its foot; a stopped rig's
 *  « Reprendre » and « … › Reprendre depuis le dernier instantané »; a running rig's « Arrêter… » and each seat's « … » (« Relancer ce
 *  siège », « Relève », « Arrêter… »). An unreachable rig offers nothing. */
function rigActions(c: RigControls, rig: Rig, onTerminal: (seat: RigSeat) => void, t: ReturnType<typeof useI18n>['t']): {
  actions?: ReactNode; seatAction?: (seat: RigSeat) => ReactNode; footer?: ReactNode;
} {
  const a = t.rigActions;
  const busy = c.busy(rig.machine, rig.id);
  const act = (verb: Parameters<RigControls['act']>[1], seat?: RigSeat) => { void c.act(rig.machine, verb, { rigId: rig.id, ...(seat ? { seatRef: seat.ref } : {}) }); };
  const openPrompt = (seat: RigSeat) => seat.state === 'trust'
    ? <button type="button" className="st-qa rc-open-prompt" onClick={() => onTerminal(seat)}>{a.openPrompt}</button>
    : null;
  if (rig.lifecycle === 'unreachable') return {};
  if (isLaunching(rig)) return {
    actions: <button type="button" className="st-qa" disabled={busy} onClick={() => act('down')}>{a.cancelLaunch}</button>,
    seatAction: openPrompt,
    footer: <LaunchNote rig={rig} />
  };
  if (rig.lifecycle === 'stopped') return {
    actions: <>
      <button type="button" className="st-qa" disabled={busy} onClick={() => act('up')}>{a.resume}</button>
      <More label={a.more(rig.name)} disabled={busy}><MenuItem onSelect={() => act('restore')}><span>{a.restore}</span></MenuItem></More>
    </>
  };
  return {
    actions: <button type="button" className="st-qa" disabled={busy} onClick={() => c.askStop(rig)}>{a.stop}</button>,
    seatAction: seat => <>
      {openPrompt(seat)}
      <More label={a.seatMenu(seat.name)} disabled={busy}>
        <MenuItem onSelect={() => act('restart', seat)}><span>{a.restartSeat}</span></MenuItem>
        <MenuItem onSelect={() => act('handover', seat)}><span>{a.handover}</span></MenuItem>
        <MenuItem onSelect={() => c.askStop(rig, seat)}><span>{a.stop}</span></MenuItem>
      </More>
    </>
  };
}

/** A rig in a space off any project that no project holds yet (once filed, `projectId` is set; the daemon keeps `offProject`). */
export const isUnfiled = (rig: Rig): boolean => rig.offProject && !rig.projectId && rig.lifecycle !== 'unreachable';

/** « En cours » (spec §8.2): one card per rig, by name, then the kernels (the local one first). Without the app's rig gestures
 *  (`RigControlsContext`), the cards only show. */
export function RigsLive({ model, openrig, byId, projects, dispatch, onTerminal }: {
  model: ReturnType<typeof rigsModel>; openrig: readonly OpenRigStatus[]; byId: ReadonlyMap<string, Session>; projects: Projects | null;
  dispatch: (a: NavAction) => void; onTerminal(rig: Rig, seat: RigSeat): void;
}): JSX.Element {
  const { t } = useI18n();
  const controls = useRigControls();
  const open = (id: string) => dispatch({ type: 'open', id });
  if (model.rigs.length === 0 && model.kernels.length === 0) return <p className="lp-none">{t.rigsTab.noRigs}</p>;
  return (
    <div className="rigs-live">
      {model.rigs.map(row => {
        const acts = controls ? rigActions(controls, row.rig, seat => onTerminal(row.rig, seat), t) : {};
        // Off any project, not filed yet: the repositories the rig found, and the way to file it (spec §8.2).
        const repos = controls && projects && isUnfiled(row.rig)
          ? <RigRepos rig={row.rig} projects={projects} onChoose={() => controls.askAdopt(row.rig)} onAdopt={id => { void controls.adopt(row.rig.machine, row.rig.id, id); }} />
          : null;
        const footer = acts.footer || repos ? <>{acts.footer}{repos}</> : undefined;
        return (
          <RigCard key={row.key} rig={row.rig} place={row.place} byId={byId} onOpen={open}
            onTable={() => dispatch({ type: 'home', project: rigFilter(row.rig) })} onTerminal={seat => onTerminal(row.rig, seat)}
            {...acts} {...(footer ? { footer } : {})} />
        );
      })}
      {model.kernels.map(k => <KernelCard key={k.key} rig={k.rig} byId={byId} status={openrig.find(s => s.machine === k.rig.machine)} onOpen={open} />)}
    </div>
  );
}
