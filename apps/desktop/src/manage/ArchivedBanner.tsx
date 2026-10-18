import type { JSX } from 'react';
import type { Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { machineOf } from '../nav/agents';
import { spanOf } from '../list/time';
import { SHELL_ICONS } from '../shell/icons';
import type { SessionActions } from './useSessionActions';

/** An archived session's page: its conversation reads, nothing can be said to the agent (it is stopped). Reprendre starts it again,
 *  « Remettre à la table » puts it back among the live ones, Supprimer… asks first. A machine that cannot archive keeps the three disabled. */
export function ArchivedBanner({ session: s, actions, now }: { session: Session; actions: SessionActions; now: number }): JSX.Element {
  const { t } = useI18n();
  const b = t.manage.archivedBanner;
  const w = t.list.when;
  const span = spanOf(now - (Date.parse(s.archivedAt ?? '') || now));
  const ago = span === 'now' ? w.now : w.ago(`${span.n} ${w.units[span.unit]}`);
  const outdated = actions.allowed(s.id) ? undefined : t.manage.outdated(machineOf(s));
  return (
    <div className="archived-banner" role="status">
      <Icon d={SHELL_ICONS.archive} size={15} />
      <span><strong>{b.title}</strong> <span className="muted">{b.body(ago)}</span></span>
      <span className="spacer" />
      <Button size="sm" variant="ghost" disabled={outdated !== undefined} title={outdated} onClick={() => actions.restore(s.id)}><Icon d={SHELL_ICONS.restore} size={13} />{b.restore}</Button>
      <Button size="sm" variant="ghost" className="danger-outline" disabled={outdated !== undefined} title={outdated} onClick={() => actions.request('delete', [s.id])}><Icon d={SHELL_ICONS.trash} size={13} />{b.delete}</Button>
      <Button size="sm" variant="primary" disabled={outdated !== undefined} title={outdated} onClick={() => actions.resume(s.id)}><Icon d={SHELL_ICONS.resume} size={13} />{b.resume}</Button>
    </div>
  );
}
