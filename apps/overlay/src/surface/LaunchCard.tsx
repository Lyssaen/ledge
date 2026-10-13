import type { ChatProposal, Session } from '@ledge/protocol';
import { Button } from '../ui/Button';
import { Icon, ICONS } from '../ui/icons';
import { toolName } from '../format';
import { useI18n } from '../i18n/lang';

export interface LaunchCardProps {
  proposal: ChatProposal;
  /** The launched session, once `launchedId` names one the overlay knows. */
  session?: Session;
  busy: boolean; disabled: boolean;
  onLaunch: () => void; onOpenSession: (id: string) => void; onTerminal: (id: string) => void;
}

const muted: React.CSSProperties = { color: 'var(--muted-foreground)' };
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 11.5, color: 'var(--muted-foreground)', overflowWrap: 'anywhere' };

/** The session the chat proposes (spec 2026-10-12 §6): proposed, launched, or failed with a retry. Launching is the user's click. */
export function LaunchCard(p: LaunchCardProps) {
  const { t } = useI18n(); const c = t.chat.card; const pr = p.proposal;
  const state = pr.launchedId !== undefined ? 'launched' : pr.error !== undefined ? 'failed' : 'proposed';
  return (
    <section data-launch-card={state} aria-label={c.label} style={{ border: '1px solid var(--sidebar-border)', borderRadius: 'var(--radius-md)', background: 'var(--well)', overflow: 'hidden', fontSize: 12.5, lineHeight: '18px' }}>
      {state === 'launched' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            {p.session ? <><a href={`ledge://session/${pr.launchedId}`} onClick={e => { e.preventDefault(); p.onOpenSession(pr.launchedId!); }} style={{ fontWeight: 600, color: 'inherit' }}>{p.session.name}</a> {c.started}</> : c.startedUnknown}
          </span>
          <Button variant="outline" size="sm" onClick={() => p.onTerminal(pr.launchedId!)} style={{ height: 26, padding: '0 10px', fontSize: 12 }}>{c.terminal}</Button>
        </div>
      ) : (
        <>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', padding: '10px 12px' }}>
            <dt style={muted}>{c.folder}</dt><dd style={{ margin: 0, minWidth: 0 }}><strong>{pr.project}</strong> <span style={mono}>{pr.cwd}</span></dd>
            <dt style={muted}>{c.tool}</dt><dd style={{ margin: 0 }}>{c.byDefault(toolName(pr.tool))}</dd>
            <dt style={muted}>{c.prompt}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{pr.prompt ?? <span style={muted}>{c.noPrompt}</span>}</dd>
          </dl>
          {state === 'failed' && <div role="alert" style={{ padding: '6px 12px', color: 'var(--destructive)', background: 'color-mix(in srgb, var(--destructive) 12%, transparent)' }}>{c.failed(pr.error!)}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--sidebar-border)' }}>
            <Button variant="primary" size="sm" disabled={p.busy || p.disabled} onClick={p.onLaunch} style={{ height: 28, padding: '0 10px', gap: 6, fontSize: 12 }}>
              {state === 'proposed' && <Icon size={12} {...ICONS.rocket} />}{p.busy ? c.launching : state === 'failed' ? c.retry : c.launch}
            </Button>
            <span style={{ ...muted, fontSize: 12 }}>{state === 'failed' ? c.orFolder : c.orRephrase}</span>
          </div>
        </>
      )}
    </section>
  );
}
