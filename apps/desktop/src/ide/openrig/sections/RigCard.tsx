import type { JSX, ReactNode } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import { useRigPermissions } from '@ledge/fleet/openrig';
import type { Rig, Session } from '@ledge/protocol';
import { useI18n } from '../../../i18n/lang';
import { cls } from '../../../shell/cls';
import { providerOf } from '../../../workspace/sessionTab';
import { ProviderLogo } from '../../ProviderLogo';
import { permLevelOf } from '../../rig/model';
import type { RigDot } from '../../rigs/model';
import { roleChips } from '../model';

/** OpenRig's runtime as a session's tool, for its logo. */
const toolOf = (runtime: string): Session['tool'] => (runtime === 'codex' ? 'codex' : runtime === 'claude-code' ? 'claude' : 'omp');

/** A rig's permission level as its card writes it (R13): read once when the card shows, nothing until read, « Mixte » when the seats differ. */
function usePermLabel(client: DaemonClient, machine: string, rig: string | null): string | null {
  const { t } = useI18n();
  const perms = useRigPermissions(client, machine, rig);
  if (perms.status !== 'ready' || perms.error) return null;
  const level = permLevelOf(perms.seats);
  return level === null ? null : level === 'mixed' ? t.ide.rigTab.mixed : t.ide.rigTab.level[level] ?? null;
}

export interface RigCardProps {
  client: DaemonClient; machine: string; rig: Rig; kernel: boolean; running: boolean; dot: RigDot;
  /** The start, restart and stop buttons (none while the daemon is stopped). */ power: ReactNode;
  /** The confirmation and the last failure, under the header. */ under: ReactNode;
  onOpen(): void;
}

/** One rig of the Rigs section (mockup `rigCard`): dot, name, state, buttons; its roles as chips; its seats, permission and snapshot. */
export function RigCard({ client, machine, rig, kernel, running, dot, power, under, onOpen }: RigCardProps): JSX.Element {
  const { t } = useI18n();
  const p = t.ide.openrigPage;
  const perm = usePermLabel(client, machine, kernel ? null : rig.name);
  const foot = kernel ? p.kernelSub : [p.seats(rig.seats), perm, rig.snapshot ? t.openrig.snapshot(rig.snapshot) : null].filter(Boolean).join(' · ');
  return (
    <article className={cls('ide-orp-card', !running && 'off')} aria-label={rig.name} data-target={kernel ? 'kernel' : rig.name}>
      <div className="ide-orp-card-h">
        <i className={`ide-rigs-dot d-${dot}`} aria-hidden="true" />
        <button type="button" className="ide-orp-name" onClick={onOpen}><b>{rig.name}</b></button>
        {kernel && <span className="ide-orp-pill">{p.system}</span>}
        <span className={cls('ide-orp-pill', running ? 'run' : 'stop')}>{running ? p.running : p.stopped}</span>
        <span className="ide-orp-sp" />
        {power}
      </div>
      {under}
      <div className="ide-orp-comp">
        {roleChips(rig).map(c => (
          <span key={c.key} className="ide-orp-chip"><ProviderLogo provider={providerOf(toolOf(c.runtime))} size={11} /><span data-testid="role-chip">{c.role}{c.count > 1 ? ` ×${c.count}` : ''}</span></span>
        ))}
      </div>
      <div className="ide-orp-card-f"><span>{foot}</span><button type="button" className="ide-orp-lnk" onClick={onOpen}>{p.openRig}</button></div>
    </article>
  );
}
