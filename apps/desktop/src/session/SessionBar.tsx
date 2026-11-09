import { useEffect, type JSX } from 'react';
import { useContextNear, type DaemonClient } from '@ledge/fleet';
import { contextShare, isArchived, type Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { modelName } from '../usage/model';
import { changeTotals, modelProvider, providerOf } from '../workspace/sessionTab';
import { ProviderLogo } from '../ide/ProviderLogo';
import type { Link } from '../workspace/model';
import type { ChangedFile } from './changedFiles';
import { SessionModel, useCanSwitchModel } from './SessionModel';
import { isNative } from '../term/mode';
import { Icon } from '@ledge/ui/ui/icons';
import { SHELL_ICONS } from '../shell/icons';
import type { PillLook } from './browserLive';
import { reliefDone, reliefText } from './relief';
import type { FleetPullRequest } from '@ledge/fleet';
import { PipeDot } from '../forge/PipeGraph';
import '../styles/forge.css';

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
  /** Where the agent's screen runs (« wsl », « ssh · host »), while the tab is on its Terminal view; else null. */
  terminal?: string | null;
  /** « N sous-agents »: how many, and showing them in the sidebar. */
  kids?: number; onShowKids?(): void;
  /** The agent's browser (the heading's Navigateur pill): its look and the captures' count, null when there is none; opening it. */
  browser?: { pill: PillLook; captures: number } | null; onBrowser?(): void;
  /** Its request (lot 8b, mockup agentView `.chip`): the pipeline's dot and its ref, after the project; a click opens it. */
  pr?: FleetPullRequest | null; onPr?(): void;
}

/** The mockup's `ic.diff` at 13 px: a plus, a minus and the slash between them. */
const DiffGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M8 3v8M4 7h8" /><path d="M12 17h8" /><path d="M18 4 6 20" strokeWidth="1.4" opacity=".6" />
  </svg>
);

/** Thousands, rounded, glued to `k` (the mockup's « 84k / 200k »). */
const k = (n: number) => `${Math.round(n / 1000)}k`;

/**
 * An IDE session tab's bottom bar (docs/mockups/ledge-ide-interactive.html, agentView() `.sfoot.cbar.pfoot`): the model
 * (logo and name, with a ▾ that opens the models where the machine can switch it), the context gauge, the branch, where the
 * agent's screen runs on Terminal, and the project; on the right a relief under way or failed, the subagents and the browser
 * (what the session page's heading said: an IDE tab has none), « Interrompre » while the agent works, and « +N −N », which
 * opens the Changes beside. Never a usage limit: the status bar says those. It narrows with its group (ide.css @container).
 */
export function SessionBar({ client, session, project, files, besideLink, notify, onChanges, terminal = null, kids = 0, onShowKids, browser = null, onBrowser, pr = null, onPr }: SessionBarProps): JSX.Element {
  const { t } = useI18n();
  const tb = t.session.browser;
  const relief = session.handover && !reliefDone(session.handover) ? session.handover : null;
  // Its name in every state (its icon and count alone under 560 px are not one): the heading pill's title.
  const browserName = browser === null ? '' : browser.pill === 'captures' && browser.captures > 0 ? tb.pill(browser.captures)
    : tb.pillTitle(session.name, browser.pill === 'captures' ? null : browser.pill, browser.captures);
  const ti = t.ide;
  const near = useContextNear(client);
  const switchable = useCanSwitchModel(client, session);
  const share = contextShare(session.context);
  const warn = share !== undefined && share >= near;
  const pct = share === undefined ? 0 : Math.round(share * 100);
  // R8: only what can be interrupted from here: working, live, reachable, not a read-only hook session. A native OMP session
  // has its own stop in the reply (« Arrêter », which gives its queue back): no second stop with another meaning here.
  const interruptible = session.state === 'working' && !isArchived(session) && session.offline !== true && session.source !== 'hook_only' && !isNative(session);
  const { files: count, plus, minus } = changeTotals(files);
  // A refusal of this session's interrupt comes back as an error naming it.
  useEffect(() => client.onMessage(m => {
    if (m.type === 'error' && m.request === 'session.interrupt' && m.id === session.id) notify(ti.interruptRefused(session.name, m.message));
  }), [client, session.id, session.name, notify, ti]);
  return (
    <div className="ide-bar">
      <span className="ide-bar-model" {...(switchable && { title: ti.changeModel })}>
        {switchable ? <SessionModel client={client} session={session} notify={notify} variant="bar" />
          : session.model && <span className="ide-bar-mdl"><ProviderLogo provider={modelProvider(session.model) ?? providerOf(session.tool)} size={12} /><span className="model-chip-text" title={modelName(session.model)}>{modelName(session.model)}</span></span>}
      </span>
      {session.context && (
        <span className={cls('ide-bar-ctx', warn && 'amber')} title={ti.context(k(session.context.used), k(session.context.window))}>
          <span className={cls('ugauge', warn && 'amber')}><i style={{ width: `${pct}%` }} /></span><b>{pct}&nbsp;%</b>
        </span>
      )}
      <span className="ide-bar-sep" aria-hidden="true" />
      {session.branch && <span className="ide-bar-chip br mono" title={ti.branch(session.branch)}>{session.branch}</span>}
      {terminal && <span className="ide-bar-chip tm mono">{terminal}</span>}
      <span className="ide-bar-chip pj">{project}</span>
      {pr && (
        <button type="button" className="ide-bar-chip fg-chip mono" title={`${t.forge.host[pr.forge]} · pipeline ${t.forge.pipe[pr.pipeline]}`} onClick={onPr}>
          <PipeDot status={pr.pipeline} />{pr.ref}
        </button>
      )}
      {/* Before the right side, out of it: the one chip there that gives way (ellipsis) when the group narrows. */}
      {relief && <span className={cls('ide-bar-relief', relief.state === 'failed' && 'amber')} role="status" title={reliefText(relief, t.handover)}>{reliefText(relief, t.handover)}</span>}
      <span className="ide-bar-side">
        {kids > 0 && (
          <button type="button" className="ide-bar-pill ide-bar-kids" title={t.session.kidsPillTitle} aria-label={t.session.kidsPill(kids)} onClick={onShowKids}>
            <Icon d={SHELL_ICONS.subagents} size={13} /><span className="lbl" aria-hidden="true">{t.session.kidsPill(kids)}</span><span className="n" aria-hidden="true">{kids}</span>
          </button>
        )}
        {browser && (
          <button type="button" className={cls('ide-bar-pill ide-bar-browser', browser.pill !== 'captures' && `ide-bar-browser-${browser.pill}`)} onClick={onBrowser}
            title={browserName} aria-label={browserName}>
            {browser.pill === 'live' ? <i className="live-dot" aria-hidden="true" /> : <Icon d={SHELL_ICONS.browser} size={13} />}
            {/* Live, its dot says so; closed, the word. */}
            <span className="lbl">{tb.tab}{browser.pill === 'closed' && ` · ${tb.pillState.closed}`}</span>
            {browser.captures > 0 && <span className="tab-count mono">{browser.captures}</span>}
          </button>
        )}
        {interruptible && (
          <button type="button" className="ide-bar-stop" aria-label={ti.interrupt} title={ti.interrupt} onClick={() => client.send({ type: 'session.interrupt', id: session.id })}>
            <i aria-hidden="true" />
          </button>
        )}
        {plus + minus > 0 && (
          <button type="button" className={cls('dchip', besideLink && 'on')} title={ti.changesChip(count)} onClick={onChanges}>
            {besideLink && <span className={`lk lk-${besideLink}`} aria-hidden="true" />}
            <DiffGlyph />
            {plus > 0 && <span className="a">+{plus}</span>}
            {minus > 0 && <span className="d">−{minus}</span>}
          </button>
        )}
      </span>
    </div>
  );
}
