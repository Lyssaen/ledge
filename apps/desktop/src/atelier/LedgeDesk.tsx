import type { JSX } from 'react';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { useTheme } from '../shell/theme';

/** Ledge's own little desk at the head of the atelier (observatory.tsx, `ledge-corner`): its bubble counts the agents
 *  it watches over, or says it listens while the chat is open; a click opens or closes the chat. */
export function LedgeDesk({ count, chat, paused, onClick }: { count: number; chat: boolean; paused: boolean; onClick: () => void }): JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  return (
    <div className="ledge-corner">
      <button className={`ledge-desk ${chat ? 'active' : ''}`} onClick={onClick} aria-label={t.atelier.desk} aria-pressed={chat}>
        <span className="ledge-bubble">{chat ? t.atelier.listening : t.atelier.watching(count)}<Kbd>/</Kbd></span>
        <span className="ledge-seat"><ResidentMascot size={92} theme={theme} paused={paused} reducedMotion={reduced} /></span>
        <span className="mini-desk" aria-hidden="true"><i className="mini-sheet" /><i className="mini-sheet two" /><i className="mini-mug" /><i className="mini-lamp" /></span>
        <strong>Ledge</strong><small>{t.atelier.assistant}</small>
      </button>
    </div>
  );
}
