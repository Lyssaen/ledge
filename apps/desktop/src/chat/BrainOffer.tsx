import { useState, type JSX } from 'react';
import { setBrain, useBrainStatus, type DaemonClient } from '@ledge/fleet';
import { Button } from '@ledge/ui/ui/Button';
import type { FleetView } from '../fleet/useFleet';
import { useI18n } from '../i18n/lang';

/** The one-time offer to turn the brain on (lot 7): shown at the top of the Ledge conversation with OpenRig while the daemon never
 *  asked (`enabled === null`; undefined = unknown, hidden). Any answer hides it at once; the daemon remembers it through `enabled`. */
export function BrainOffer({ client, view }: { client: DaemonClient; view: FleetView }): JSX.Element | null {
  const { t } = useI18n();
  const brain = useBrainStatus();
  const [answered, setAnswered] = useState(false);
  const openrig = view.machines.find(m => m.id === 'local')?.daemon?.openrig === true;
  if (!openrig || brain?.enabled !== null || brain === undefined || answered) return null;
  const o = t.home.brainOffer;
  const answer = (on: boolean) => { setAnswered(true); setBrain(client, on ? { enabled: true, first: true } : { enabled: false }); };
  return (
    <div className="home-brain-offer" role="group" aria-label={o.text}>
      <p>{o.text}</p>
      <div>
        <Button variant="primary" size="sm" onClick={() => answer(true)}>{o.activate}</Button>
        <Button variant="ghost" size="sm" onClick={() => answer(false)}>{o.later}</Button>
      </div>
    </div>
  );
}
