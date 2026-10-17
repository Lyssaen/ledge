import type { Session } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { botState, poseFor } from '../bots/poseFor';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useI18n } from '../i18n/lang';

/** One line about a bot that is not waiting: its state, its task, and the way into Ledge Desktop. */
export function PeekCard({ session, visible, frozen, reducedMotion, theme = 'dark', onClose, onOpen }: {
  session: Session; visible: boolean; frozen?: boolean; reducedMotion?: boolean; theme?: 'dark' | 'light'; onClose: () => void; onOpen: () => void;
}) {
  const { t } = useI18n();
  const offline = frozen || session.state === 'exited';
  return (
    <div data-layer="peek" inert={!visible} style={{ position: 'absolute', left: 0, top: 0, width: 360, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px 12px', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Bot seed={session.id} readOnly={session.source === 'hook_only'} tool={session.tool} state={botState(session)} pose={poseFor(session.id, session.state)} size={40} theme={theme} paused={!visible} frozen={frozen} reducedMotion={reducedMotion} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <strong style={{ fontSize: 14, lineHeight: '20px' }}>{session.name}</strong>
          <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{session.project}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Badge state={offline ? 'readonly' : botState(session)} label={offline ? t.bubble.offlineBadge : undefined} />
        <span style={{ fontSize: 13, lineHeight: '18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.topic || session.project}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button variant="ghost" size="sm" onClick={onClose}>{t.bubble.close}</Button>
        <Button variant="primary" size="sm" onClick={onOpen}>{t.bubble.openSession}</Button>
      </div>
    </div>
  );
}
