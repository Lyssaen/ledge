import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';

/** The mockup's dialog: a blurred backdrop that closes on its own click, a titled box with « Fermer ».
 *  Focus moves into the box unless a field already took it, and goes back where it was on close. */
export function Modal({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const id = useId();
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    if (box.current && !box.current.contains(document.activeElement)) box.current.focus();
    return () => { if (before?.isConnected) before.focus(); };
  }, []);
  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={box} className={wide ? 'modal composer-modal' : 'modal'} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <div className="modal-title">
          <h2 id={id}>{title}</h2>
          <Button variant="ghost" size="icon" aria-label={t.close} onClick={onClose}><Icon d={ICONS.close.d} /></Button>
        </div>
        {children}
      </section>
    </div>
  );
}
