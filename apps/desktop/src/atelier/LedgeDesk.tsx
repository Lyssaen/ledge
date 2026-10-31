import type { JSX } from 'react';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { useTheme } from '../shell/theme';

/** Ledge in the atelier's top-left corner (observatory.tsx, `ledge-corner`), on the ledge of its own logo: its bubble counts
 *  the rigs it orchestrates and the decisions waiting for the user (lot 3), else the agents it watches over, or says it listens while
 *  the chat is open; a click opens or closes the chat. */
export function LedgeDesk({ count, rigs = 0, decisions = 0, chat, paused, onClick }: { count: number; rigs?: number; decisions?: number; chat: boolean; paused: boolean; onClick: () => void }): JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  return (
    <div className="ledge-corner">
      <button className={`ledge-desk ${chat ? 'active' : ''}`} onClick={onClick} aria-label={t.atelier.desk} aria-pressed={chat}>
        <span className="ledge-bubble">{chat ? t.atelier.listening : rigs > 0 ? t.atelier.orchestrating(rigs, decisions) : t.atelier.watching(count)}<Kbd>/</Kbd></span>
        <span className="ledge-seat"><ResidentMascot size={80} theme={theme} paused={paused} reducedMotion={reduced} /></span>
        <strong>Ledge</strong><small>{t.atelier.assistant}</small>
      </button>
    </div>
  );
}
