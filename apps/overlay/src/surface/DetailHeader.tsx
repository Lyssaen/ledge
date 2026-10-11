import { Button } from '../ui/Button';
import { useI18n } from '../i18n/lang';

const Icon = ({ d }: { d: string[] }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d.map((p, i) => <path key={i} d={p} />)}</svg>;

export const DETAIL_HEADER_H = 56;
/** Header of a detail view inside the surface (settings, help): back to the list (or `backLabel`'s place), a title, close. */
export function DetailHeader({ title, onBack, onClose, backLabel }: { title: string; onBack: () => void; onClose: () => void; backLabel?: string }) {
  const { t } = useI18n();
  const back = backLabel ?? t.detail.back;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: DETAIL_HEADER_H, flexShrink: 0, boxSizing: 'border-box', padding: '0 8px', borderBottom: '1px solid var(--sidebar-border)' }}>
      <Button variant="ghost" size="icon" aria-label={back} title={back} data-initial-focus onClick={onBack}><Icon d={['m15 18-6-6 6-6']} /></Button>
      <span style={{ flexGrow: 1, fontSize: 14, lineHeight: '18px', fontWeight: 600 }}>{title}</span>
      <Button variant="ghost" size="icon" aria-label={t.detail.close} title={t.detail.close} onClick={onClose}><Icon d={['M18 6 6 18', 'm6 6 12 12']} /></Button>
    </div>
  );
}
