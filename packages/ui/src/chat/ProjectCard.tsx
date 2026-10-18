import type { ChatProjectProposal } from '@ledge/protocol';
import { Button } from '../ui/Button';
import { useChatCopy } from './copy';

export interface ProjectCardProps {
  proposal: ChatProjectProposal;
  /** The current name of the project `addTo` designates, when one exists; absent: a new project. */
  target?: string;
  onReview: () => void;
}

const muted: React.CSSProperties = { color: 'var(--muted-foreground)' };
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 11.5, color: 'var(--muted-foreground)' };
const basename = (path: string) => { const t = path.replace(/\/+$/, ''); return t.slice(t.lastIndexOf('/') + 1) || path; };

/** The project the chat proposes (lot 11, task 5): its name (or « Complete X »), how many repositories, and « Review the proposal »,
 *  which opens the editor prefilled. Nothing is created from the card: only the editor's button saves. */
export function ProjectCard(p: ProjectCardProps) {
  const c = useChatCopy().chat.project; const pr = p.proposal;
  return (
    <section data-project-card aria-label={c.label} style={{ border: '1px solid var(--sidebar-border)', borderRadius: 'var(--radius-md)', background: 'var(--well)', overflow: 'hidden', fontSize: 12.5, lineHeight: '18px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', minWidth: 0 }}>
        <strong style={{ overflowWrap: 'anywhere' }}>{p.target !== undefined ? c.complete(p.target) : c.title(pr.name)}</strong>
        <span style={muted}>{c.repos(pr.repos.length)}</span>
        <span style={{ ...mono, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={pr.repos.map(r => r.path).join('\n')}>{pr.repos.map(r => basename(r.path)).join(' · ')}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--sidebar-border)' }}>
        <Button variant="primary" size="sm" onClick={p.onReview} style={{ height: 28, padding: '0 10px', fontSize: 12 }}>{c.review}</Button>
      </div>
    </section>
  );
}
