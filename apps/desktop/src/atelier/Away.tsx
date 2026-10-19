import type { JSX } from 'react';
import { Button } from '@ledge/ui/ui/Button';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { SHELL_ICONS } from '../shell/icons';

/** The overview while the Atelier is in its own window (#21): say where it is, bring that window forward, or take it back. */
export function AtelierAway({ onShow, onAttach }: { onShow(): void; onAttach(): void }): JSX.Element {
  const { t } = useI18n();
  const c = t.detached;
  return (
    <section className="atelier-away" aria-label={c.away}>
      <Icon d={SHELL_ICONS.detach} size={28} />
      <h2>{c.away}</h2>
      <p>{c.awayBody}</p>
      <div className="atelier-away-actions">
        <Button variant="primary" onClick={onShow}>{c.show}</Button>
        <Button variant="ghost" title={c.attachTitle} onClick={onAttach}>{c.attach}</Button>
      </div>
    </section>
  );
}
