import { Button } from '../ui/Button';

const Icon = ({ d }: { d: string[] }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d.map((p, i) => <path key={i} d={p} />)}</svg>;

/** Header of a detail view inside the surface (settings, help): back to the list, a title, close. */
export function DetailHeader({ title, onBack, onClose }: { title: string; onBack: () => void; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 56, flexShrink: 0, boxSizing: 'border-box', padding: '0 8px', borderBottom: '1px solid var(--sidebar-border)' }}>
      <Button variant="ghost" size="icon" aria-label="Back to sessions" data-initial-focus onClick={onBack}><Icon d={['m15 18-6-6 6-6']} /></Button>
      <span style={{ flexGrow: 1, fontSize: 14, lineHeight: '18px', fontWeight: 600 }}>{title}</span>
      <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}><Icon d={['M18 6 6 18', 'm6 6 12 12']} /></Button>
    </div>
  );
}
