import type { ChatRigLaunch } from '@ledge/protocol';
import { Button } from '../ui/Button';
import { useChatCopy } from './copy';

const muted: React.CSSProperties = { color: 'var(--muted-foreground)' };
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 11.5, color: 'var(--muted-foreground)' };

/** The rig Ledge's brain proposes (lot 7): its spec and goal, and « Lancer ce rig », which opens the launch window prefilled.
 *  Ledge never launches it: only the user, from that window. */
export function RigLaunchCard(p: { card: ChatRigLaunch; onLaunch(): void; disabled?: boolean }) {
  const c = useChatCopy().chat.rigLaunch!;
  const where = p.card.project ?? p.card.off;
  return (
    <section data-rig-launch-card aria-label={c.label} style={{ border: '1px solid var(--sidebar-border)', borderRadius: 'var(--radius-md)', background: 'var(--well)', overflow: 'hidden', fontSize: 12.5, lineHeight: '18px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', minWidth: 0 }}>
        {(p.card.spec || where) && <span style={mono}>{[p.card.spec, where].filter(Boolean).join(' · ')}</span>}
        <span style={{ ...muted, overflowWrap: 'anywhere' }}>{p.card.goal}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--sidebar-border)' }}>
        <Button variant="primary" size="sm" disabled={p.disabled} onClick={p.onLaunch} style={{ height: 28, padding: '0 10px', fontSize: 12 }}>{c.launch}</Button>
      </div>
    </section>
  );
}
