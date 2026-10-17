import type { JSX } from 'react';
import { useDaemon, type DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { machineOf } from '../nav/agents';
import { SHELL_ICONS } from '../shell/icons';
import { isTauri } from '../tauri/bridge';
import { openSessionTerminal } from './terminal';

/** The terminal beside the conversation (observatory.tsx terminal-pane), shown on O: the session's last output as the daemon
 *  previews it (session.preview), read only — on a subagent's page, its parent's. In the app, and online, « Ouvrir dans un
 *  terminal » brings the real one forward or opens it. */
export function TerminalPane({ client, session, notify }: { client: DaemonClient; session: Session; notify(text: string): void }): JSX.Element {
  const { t } = useI18n();
  const tt = t.session.terminal;
  const lines = useDaemon().previews.get(session.id) ?? [];
  const offline = session.offline === true;
  const open = () => { void openSessionTerminal(client, session).then(ok => { if (!ok) notify(tt.openFailed(session.name)); }); };
  return (
    <section className="terminal-pane" role="region" aria-label={tt.title}>
      <div className="pane-heading"><Icon d={SHELL_ICONS.terminal} size={15} />{tt.title}<span className="spacer" /><span className="mono muted">{machineOf(session)}</span></div>
      <div className="terminal-content mono">
        {lines.length > 0
          ? <div className="terminal-output">{lines.map((line, i) => <div key={i}>{line === '' ? '\u00a0' : line}</div>)}</div>
          : <p className="muted">{tt.empty}</p>}
      </div>
      <div className="terminal-footer">
        <span className={offline ? 'muted' : 'terminal-prompt'} aria-hidden="true">●</span>{offline ? tt.offline : tt.readOnly}
        {isTauri() && !offline && <><span className="spacer" /><Button variant="ghost" size="sm" onClick={open}>{tt.open}</Button></>}
      </div>
    </section>
  );
}
