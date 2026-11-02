import { useState, type JSX } from 'react';
import type { TeamsEngine } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { Card, Row, Segmented } from './controls';
import type { SettingsContext } from './SettingsPage';

/** Settings › Teams: which engine runs the teams, Ledge's own or OpenRig (`teams.engine` / `teams.engine.set`, the local daemon's).
 *  OpenRig is greyed while no machine has it, both while a team runs; a refusal of the daemon is said as it came, and « Setting saved »
 *  comes only once the daemon accepted the change. Without `teams.engine` the daemon is too old (or offline): the section says so. */
export function Teams({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const c = t.settings.teams;
  const { teamsEngine: state, fleet, machines, saved } = ctx;
  const [error, setError] = useState<string | null>(null);
  const localUp = machines.find(m => m.id === 'local')?.ready === true;
  if (!state) return <Card><div role="status" className="set-well"><span>{localUp ? c.outdated : t.offline}</span></div></Card>;

  const choose = async (engine: TeamsEngine) => {
    setError(null);
    try {
      const r = await fleet.setTeamsEngine(engine);
      if (r.ok) saved(c.saved(c[engine])); else setError(r.reason ?? c.refused.offline);
    } catch (e) {
      setError((e as Error).name === 'DaemonOutdated' ? c.outdated : c.refused.offline);
    }
  };
  const note = state.running ? c.running : !state.openrigAvailable ? c.openrigAbsent : null;
  return (
    <Card>
      <Row label={c.engine} stack error={error}
        hint={<>{c.ledge} : {c.ledgeHint}<br />{c.openrig} : {c.openrigHint}{note && <><br />{note}</>}</>}>
        {describedBy => (
          <Segmented label={c.engine} value={state.engine} disabled={state.running} describedBy={describedBy} onChange={choose}
            options={[{ value: 'ledge', label: c.ledge }, { value: 'openrig', label: c.openrig, disabled: !state.openrigAvailable }]} />
        )}
      </Row>
    </Card>
  );
}
