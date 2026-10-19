import { useState } from 'react';
import type { ChatProposal, Session } from '@ledge/protocol';
import { Button } from '../ui/Button';
import { Icon, ICONS } from '../ui/icons';
import { useChatCopy } from './copy';
import { toolName } from './format';

export interface LaunchGroupCardProps {
  proposals: ChatProposal[];
  /** The listed sessions: a launched row names its own once the overlay knows it. */
  sessions: readonly Session[];
  /** The rows being launched now: their buttons say so; `busy` holds the whole card. */
  busy: boolean; busyRows: readonly number[]; disabled: boolean;
  onLaunch: (rows: number[]) => void; onOpenSession: (id: string) => void; onTerminal: (id: string) => void;
}

const muted: React.CSSProperties = { color: 'var(--muted-foreground)' };
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 11.5, color: 'var(--muted-foreground)', overflowWrap: 'anywhere' };
const small: React.CSSProperties = { height: 26, padding: '0 10px', fontSize: 12 };

/** The sessions one answer proposes (#24): a row each, launched on its own or with « Launch all » for the checked rows still to start. */
export function LaunchGroupCard(p: LaunchGroupCardProps) {
  const t = useChatCopy().chat; const c = t.card;
  // Unchecking a row keeps it out of « Launch all »; a launched row has no box.
  const [unchecked, setUnchecked] = useState<ReadonlySet<number>>(new Set());
  const open = p.proposals.flatMap((pr, i) => (pr.launchedId === undefined ? [i] : []));
  const picked = open.filter(i => !unchecked.has(i));
  const toggle = (i: number) => setUnchecked(u => { const n = new Set(u); if (!n.delete(i)) n.add(i); return n; });
  return (
    <section data-launch-group aria-label={t.group.label(p.proposals.length)} style={{ border: '1px solid var(--sidebar-border)', borderRadius: 'var(--radius-md)', background: 'var(--well)', overflow: 'hidden', fontSize: 12.5, lineHeight: '18px' }}>
      {p.proposals.map((pr, i) => {
        const state = pr.launchedId !== undefined ? 'launched' : pr.error !== undefined ? 'failed' : 'proposed';
        const session = pr.launchedId === undefined ? undefined : p.sessions.find(s => s.id === pr.launchedId);
        return (
          <div key={i} data-launch-row={state} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 12px', borderTop: i > 0 ? '1px solid var(--sidebar-border)' : undefined }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {state !== 'launched' && <input type="checkbox" aria-label={t.group.pick(pr.project)} checked={!unchecked.has(i)} disabled={p.busy} onChange={() => toggle(i)} />}
              <span style={{ flex: 1, minWidth: 0 }}><strong>{pr.project}</strong> <span style={mono}>{pr.cwd}</span></span>
              {state === 'launched' ? (
                <Button variant="outline" size="sm" onClick={() => p.onTerminal(pr.launchedId!)} style={small}>{c.terminal}</Button>
              ) : (
                <Button variant="outline" size="sm" disabled={p.busy || p.disabled} onClick={() => p.onLaunch([i])} style={small}>
                  {p.busy && p.busyRows.includes(i) ? c.launching : state === 'failed' ? c.retry : t.group.launchRow}
                </Button>
              )}
            </div>
            <div style={{ ...muted, overflowWrap: 'anywhere' }}>{c.byDefault(toolName(pr.tool))} · {pr.prompt ?? c.noPrompt}</div>
            {state === 'launched' && (
              <div>{session ? <><a href={`ledge://session/${pr.launchedId}`} onClick={e => { e.preventDefault(); p.onOpenSession(pr.launchedId!); }} style={{ fontWeight: 600, color: 'inherit' }}>{session.name}</a> {c.started}</> : c.startedUnknown}</div>
            )}
            {state === 'failed' && <div role="alert" style={{ color: 'var(--destructive)' }}>{c.failed(pr.error!)}</div>}
          </div>
        );
      })}
      {open.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--sidebar-border)' }}>
          <Button variant="primary" size="sm" disabled={p.busy || p.disabled || picked.length === 0} onClick={() => p.onLaunch(picked)} style={{ height: 28, padding: '0 10px', gap: 6, fontSize: 12 }}>
            <Icon size={12} {...ICONS.rocket} />{t.group.launchAll(picked.length)}
          </Button>
          <span style={{ ...muted, fontSize: 12 }}>{c.orRephrase}</span>
        </div>
      )}
    </section>
  );
}
