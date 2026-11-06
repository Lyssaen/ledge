import { useEffect, type JSX } from 'react';
import { useContextNear, type DaemonClient } from '@ledge/fleet';
import { contextShare, isArchived, type Session } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { modelName } from '../usage/model';
import { changeTotals } from '../workspace/sessionTab';
import type { Link } from '../workspace/model';
import type { ChangedFile } from './changedFiles';
import { SessionModel, useCanSwitchModel } from './SessionModel';

export interface SessionBarProps {
  client: DaemonClient; session: Session;
  /** « rig · role » for a seat, else the project (projectLabel). */
  project: string;
  /** The files the shown thread changed (Workspace's changedFiles): « +N −N ». */
  files: readonly ChangedFile[];
  /** The colour of the linked group showing this session's Changes, null when none does. */
  besideLink: Link | null;
  notify(text: string): void;
  /** « +N −N »: the session's Changes beside it, in a linked group. */
  onChanges(): void;
}

/** Thousands, rounded, glued to `k` (the mockup's « 84k / 200k »). */
const k = (n: number) => `${Math.round(n / 1000)}k`;

/**
 * An IDE session tab's bottom bar (docs/mockups/ledge-ide-interactive.html, agentView() `.sfoot.cbar.pfoot`): the model
 * (its chip where the machine can switch it, else its name), the context gauge, the branch and the project; on the right
 * « Interrompre » while the agent works, and « +N −N », which opens the Changes beside. Never a usage limit: the status
 * bar says those. It narrows with its group (ide.css @container).
 */
export function SessionBar({ client, session, project, files, besideLink, notify, onChanges }: SessionBarProps): JSX.Element {
  const { t } = useI18n();
  const ti = t.ide;
  const near = useContextNear(client);
  const switchable = useCanSwitchModel(client, session);
  const share = contextShare(session.context);
  const warn = share !== undefined && share >= near;
  const pct = share === undefined ? 0 : Math.round(share * 100);
  // R8: only what can be interrupted from here: working, live, reachable, not a read-only hook session.
  const interruptible = session.state === 'working' && !isArchived(session) && session.offline !== true && session.source !== 'hook_only';
  const { files: count, plus, minus } = changeTotals(files);
  // A refusal of this session's interrupt comes back as an error naming it.
  useEffect(() => client.onMessage(m => {
    if (m.type === 'error' && m.request === 'session.interrupt' && m.id === session.id) notify(ti.interruptRefused(session.name, m.message));
  }), [client, session.id, session.name, notify, ti]);
  return (
    <div className="ide-bar">
      <span className="ide-bar-model" title={ti.changeModel}>
        {switchable ? <SessionModel client={client} session={session} notify={notify} /> : session.model && <span className="ide-bar-mdl">{modelName(session.model)}</span>}
      </span>
      {session.context && (
        <span className={cls('ide-bar-ctx', warn && 'amber')} title={ti.context(k(session.context.used), k(session.context.window))}>
          <span className={cls('ugauge', warn && 'amber')}><i style={{ width: `${pct}%` }} /></span><b>{pct}&nbsp;%</b>
        </span>
      )}
      <span className="ide-bar-sep" aria-hidden="true" />
      {session.branch && <span className="ide-bar-chip br mono" title={ti.branch(session.branch)}>{session.branch}</span>}
      <span className="ide-bar-chip pj">{project}</span>
      <span className="ide-bar-side">
        {interruptible && (
          <button type="button" className="ide-bar-stop" aria-label={ti.interrupt} title={ti.interrupt} onClick={() => client.send({ type: 'session.interrupt', id: session.id })}>
            <i aria-hidden="true" />
          </button>
        )}
        {plus + minus > 0 && (
          <button type="button" className={cls('dchip', besideLink && 'on')} title={ti.changesChip(count)} onClick={onChanges}>
            {besideLink && <span className={`lk lk-${besideLink}`} aria-hidden="true" />}
            <Icon d={SHELL_ICONS.diff} size={13} />
            {plus > 0 && <span className="a">+{plus}</span>}
            {minus > 0 && <span className="d">−{minus}</span>}
          </button>
        )}
      </span>
    </div>
  );
}
