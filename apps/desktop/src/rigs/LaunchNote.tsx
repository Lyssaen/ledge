import type { JSX } from 'react';
import type { Rig } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';

/** A rig Ledge launched whose goal has not been given yet (spec §4.6, step 3): « Annuler le lancement » stops it without asking. */
export const isLaunching = (rig: Rig): boolean => !!rig.launch && !rig.launch.goalSentAt;

/** The lead's name: the seat `launch.lead` names (by ref or address), else that word without its « @ ». */
const leadName = (rig: Rig, lead: string): string => rig.seats.find(s => s.ref === lead || s.address === lead)?.name ?? lead.replace(/^@/, '');

/** A launching rig's foot (maquette l-3): « Le but attend : je le donne à {lead} dès que les {n} sièges sont prêts. », then, for each
 *  seat that waits for the user's trust in its folder, « {siège} attend ta confiance dans le dossier, je ne réponds pas à sa place. ». */
export function LaunchNote({ rig }: { rig: Rig }): JSX.Element | null {
  const { t } = useI18n();
  if (!rig.launch) return null;
  const seats = rig.seats.filter(s => s.state !== 'stopped');
  const trust = seats.filter(s => s.state === 'trust');
  return (
    <p className="rc-launch-note" role="note">
      <span className="rc-flag" aria-hidden="true">⚑</span>
      <span>
        <strong>{t.rigActions.goalWaits(leadName(rig, rig.launch.lead), seats.length)}</strong>
        {trust.map(s => <span key={s.ref} className="rc-trust-note"> {t.rigActions.trustWaits(s.name)}</span>)}
      </span>
    </p>
  );
}
