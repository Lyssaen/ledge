import type { JSX } from 'react';
import { manualInstall, type AgentStatus, type InstallableTool } from '@ledge/protocol';
import type { DaemonClient } from '@ledge/fleet';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';
import { installAgent, useAgents } from '../native/agents';
import { Card, Row } from './controls';

const NAMES: Record<InstallableTool, string> = { claude: 'Claude Code', codex: 'Codex' };

/** Settings › General on native Windows: Claude Code and Codex, installed or not, and their install (spec 2026-11-03 §4.2.6). */
export function Agents({ client, epoch }: { client: DaemonClient; /** The local daemon's info (new with each snapshot): asked again when it comes back. */ epoch?: unknown }): JSX.Element {
  const { t } = useI18n();
  const c = t.agents;
  const view = useAgents(client, true, epoch);
  const row = (tool: InstallableTool) => {
    const s: AgentStatus | undefined = view.agents?.find(a => a.tool === tool);
    const busy = view.installing === tool;
    return (
      <Row key={tool} label={NAMES[tool]} hint={s === undefined ? c.checking : s.found ? s.version ?? c.found : c.notInstalled}>
        {s && !s.found && (
          <Button size="sm" variant="primary" aria-label={c.installOne(NAMES[tool])} disabled={view.installing !== null} onClick={() => installAgent(client, tool)}>
            {busy ? c.installing : c.install}
          </Button>
        )}
      </Row>
    );
  };
  const last = view.last;
  return (
    <Card title={c.title} hint={c.hint}>
      {row('claude')}
      {row('codex')}
      {last?.ok && <p className="set-card-note" role="status">{c.installed(NAMES[last.tool])}</p>}
      {last && !last.ok && (
        <div className="set-card-note" role="alert">
          <p>{last.error === 'busy' ? c.busy : last.error === 'not_offered' ? c.notOffered : c.failed(NAMES[last.tool], last.code ?? null)}</p>
          {last.output && <pre className="mono">{last.output}</pre>}
          {last.error === 'failed' && <><p>{c.manual}</p><pre className="mono">{manualInstall(last.tool)}</pre></>}
        </div>
      )}
    </Card>
  );
}
