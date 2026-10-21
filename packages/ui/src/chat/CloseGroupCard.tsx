import type { ChatClose, Session } from '@ledge/protocol';
import { Button } from '../ui/Button';
import { useChatCopy } from './copy';
import { toolName } from './format';

export interface CloseGroupCardProps {
  closes: ChatClose[];
  /** The listed sessions: a row's live state comes from here (a session that ended on its own has nothing left to close). */
  sessions: readonly Session[];
  /** The rows being closed now: their buttons say so; `busy` holds the whole card. */
  busy: boolean; busyRows: readonly number[]; disabled: boolean;
  onClose: (rows: number[]) => void; onOpenSession: (id: string) => void;
}

const muted: React.CSSProperties = { color: 'var(--muted-foreground)' };
const small: React.CSSProperties = { height: 26, padding: '0 10px', fontSize: 12 };

/** The sessions one answer proposes to close: a row each, closed on its own or with « Close all » for those still open. */
export function CloseGroupCard(p: CloseGroupCardProps) {
  const t = useChatCopy().chat.closeGroup;
  const rows = p.closes.map((c, i) => {
    const session = p.sessions.find(s => s.id === c.id);
    const settled: 'closed' | 'killed' | 'ended' | undefined = c.closedAt !== undefined ? (c.how === 'killed' ? 'killed' : 'closed') : session?.state === 'exited' ? 'ended' : undefined;
    const state: 'closed' | 'killed' | 'ended' | 'closing' | 'failed' | 'proposed' = settled ?? (p.busy && p.busyRows.includes(i) ? 'closing' : c.error !== undefined ? 'failed' : 'proposed');
    return { c, i, session, state, open: settled === undefined };
  });
  const open = rows.filter(r => r.open).map(r => r.i);
  return (
    <section data-close-group aria-label={t.label(p.closes.length)} style={{ border: '1px solid var(--sidebar-border)', borderRadius: 'var(--radius-md)', background: 'var(--well)', overflow: 'hidden', fontSize: 12.5, lineHeight: '18px' }}>
      {rows.map(({ c, i, session, state }) => (
        <div key={i} data-close-row={state} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 12px', borderTop: i > 0 ? '1px solid var(--sidebar-border)' : undefined }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
              <a href={`ledge://session/${c.id}`} onClick={e => { e.preventDefault(); p.onOpenSession(c.id); }} style={{ fontWeight: 600, color: 'inherit' }}>{session?.name ?? c.name}</a> <span style={muted}>{toolName(c.tool)}</span>
            </span>
            {state === 'proposed' || state === 'failed' || state === 'closing' ? (
              <Button variant="outline" size="sm" disabled={p.busy || p.disabled} onClick={() => p.onClose([i])} style={small}>
                {state === 'closing' ? t.closing : state === 'failed' ? t.retry : t.row}
              </Button>
            ) : (
              <span style={muted}>{t[state]}</span>
            )}
          </div>
          {state === 'failed' && <div role="alert" style={{ color: 'var(--destructive)', overflowWrap: 'anywhere' }}>{t.failed(c.error!)}</div>}
        </div>
      ))}
      {open.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--sidebar-border)' }}>
          <Button variant="primary" size="sm" disabled={p.busy || p.disabled} onClick={() => p.onClose(open)} style={{ height: 28, padding: '0 10px', gap: 6, fontSize: 12 }}>{t.all(open.length)}</Button>
        </div>
      )}
    </section>
  );
}
