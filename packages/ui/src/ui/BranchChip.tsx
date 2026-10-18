import type { Session } from '@ledge/protocol';
import { Icon, ICONS } from './icons';

/** The checked-out branch as a mono chip; a linked worktree drops its `worktree-` prefix and gets a dashed border. */
export function BranchChip({ session: s }: { session: Session }) {
  if (!s.branch) return null;
  const label = s.worktree ? s.branch.replace(/^worktree-/, '') : s.branch;
  return (
    <span data-branch className="mono" title={`${s.worktree ? 'worktree' : 'branch'} ${s.branch}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 28, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, lineHeight: '14px', fontWeight: 500, padding: '2px 6px', borderRadius: 'var(--radius-sm)', color: 'var(--sidebar-foreground)', background: s.worktree ? 'transparent' : 'var(--secondary)', border: s.worktree ? '1px dashed var(--input)' : '1px solid transparent' }}>
      <Icon size={10} {...ICONS.branch} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </span>
  );
}
