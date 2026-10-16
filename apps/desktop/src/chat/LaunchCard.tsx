import type { ChatProposal, Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { TOOL_NAMES } from '../shell/Person';
import { ErrorStatus } from './ErrorStatus';

export interface LaunchCardProps {
  proposal: ChatProposal;
  /** The launched session, once the fleet lists `launchedId`. */
  session?: Session;
  busy: boolean; disabled: boolean;
  onLaunch: () => void;
}

/** The session Ledge proposes (spec §9.3; the island's LaunchCard): proposed, launched, or failed with a retry. Launching is the
 *  person's click. Once launched, the turn's links open the session (no link or Terminal button here). */
export function LaunchCard(p: LaunchCardProps) {
  const { t } = useI18n();
  const c = t.chat.card;
  const pr = p.proposal;
  const state = pr.launchedId !== undefined ? 'launched' : pr.error !== undefined ? 'failed' : 'proposed';
  return (
    <section className="ledge-card" data-launch-card={state} aria-label={c.label}>
      {state === 'launched' ? <p className="ledge-card-done">{p.session ? c.started(p.session.name) : c.startedUnknown}</p> : <>
        <dl>
          <dt>{c.folder}</dt><dd><strong>{pr.project}</strong> <code>{pr.cwd}</code></dd>
          <dt>{c.tool}</dt><dd>{c.byDefault(TOOL_NAMES[pr.tool])}</dd>
          <dt>{c.prompt}</dt><dd>{pr.prompt ?? <span className="ledge-card-muted">{c.noPrompt}</span>}</dd>
        </dl>
        {state === 'failed' && <ErrorStatus className="ledge-card-error" raw={pr.error!} wrap={c.failed} />}
        <div className="ledge-card-foot">
          <button type="button" className="primary" disabled={p.busy || p.disabled} onClick={p.onLaunch}>{p.busy ? c.launching : state === 'failed' ? c.retry : c.launch}</button>
          <span>{state === 'failed' ? c.orFolder : c.orRephrase}</span>
        </div>
      </>}
    </section>
  );
}
