import { useEffect, useRef, type JSX } from 'react';
import { setBrain, useBrainStatus } from '@ledge/fleet';
import type { ServerMessage, Tool } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';
import { Card, Row, Segmented, SwitchRow } from './controls';
import type { SettingsContext } from './SettingsPage';

/** The tools that can carry the brain: the tmux ones (OMP cannot, C13). */
const BRAIN_TOOLS: readonly Tool[] = ['claude', 'codex', 'cursor'];

/** Settings › Ledge (lot 7): the brain's switch, its tool and its state. Each change is a `brain.set` to the local daemon; a refusal
 *  (its `rig.result`) is said in a notice. */
export function Ledge({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const l = t.settings.ledge;
  const brain = useBrainStatus();
  const { client, notify } = ctx;
  const pending = useRef(new Set<string>());
  useEffect(() => {
    const handle = (m: ServerMessage) => {
      if (m.type !== 'rig.result' || !pending.current.delete(m.rid)) return;
      if (!m.ok) notify(l.refused(m.reason ?? m.code ?? 'failed'));
    };
    const offs = [client.onMessage(handle), ...(client.fleet ? [client.fleet.onMachineMessage((_, m) => handle(m))] : [])];
    return () => { for (const off of offs) off(); };
  }, [client, notify, l]);

  const send = (o: Parameters<typeof setBrain>[1]) => { pending.current.add(setBrain(client, o)); };
  const enabled = brain?.enabled === true;
  const st = l.status;
  const line = !brain ? null
    : brain.state === 'on' ? (brain.contextPct !== undefined ? st.context(Math.round(brain.contextPct)) : st.on)
    : brain.state === 'starting' ? st.starting
    : brain.state === 'down' ? st.down(brain.reason)
    : st.off;

  return (
    <Card title={l.title}>
      <SwitchRow label={l.think} hint={l.thinkHint} checked={enabled} onChange={on => send({ enabled: on })} />
      <Row label={l.tool} hint={l.toolHint} stack>
        <Segmented label={l.tool} value={brain?.tool ?? 'claude'} onChange={v => send({ enabled, tool: v })}
          options={BRAIN_TOOLS.map(id => ({ value: id, label: t.launch.tools[id][0] }))} />
      </Row>
      {line && (
        <div className="set-row">
          <div className="set-copy"><span data-brain-status aria-live="polite" className="set-label">{line}</span></div>
          {brain?.state === 'down' && <div className="set-control"><Button variant="outline" size="sm" onClick={() => send({ enabled: true })}>{st.restart}</Button></div>}
        </div>
      )}
    </Card>
  );
}
