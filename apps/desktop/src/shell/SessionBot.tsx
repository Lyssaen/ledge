import type { JSX } from 'react';
import type { Helper, Session } from '@ledge/protocol';
import { Bot } from '@ledge/ui/bots/Bot';
import { botState, poseFor, type BotState } from '@ledge/ui/bots/poseFor';
import { Badge } from '@ledge/ui/ui/Badge';
import { helperState } from '../atelier/layout';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { useTheme } from './theme';

/** A session's bot: frozen offline (`frozen`), read-only for `hook_only`, seeded by its id. */
export function SessionBot({ session, size, paused }: { session: Session; size: number; paused?: boolean }): JSX.Element {
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  return <Bot tool={session.tool} state={botState(session)} pose={poseFor(session.id, session.state)} size={size} theme={theme} seed={session.id} frozen={!!session.offline} paused={paused} reducedMotion={reduced} readOnly={session.source === 'hook_only'} />;
}

/** A sub-agent's bot: its parent's `tool`, seed `${parent.id}:${helper.id}`, state `helperState`, frozen when the parent is offline. */
export function HelperBot({ helper, parent, size, paused }: { helper: Helper; parent: Session; size: number; paused?: boolean }): JSX.Element {
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const seed = `${parent.id}:${helper.id}`;
  const state = helperState(helper);
  return <Bot tool={parent.tool} state={state} pose={poseFor(seed, state)} size={size} theme={theme} seed={seed} frozen={!!parent.offline} paused={paused} reducedMotion={reduced} readOnly={parent.source === 'hook_only'} />;
}

/** Offline reads « Offline » whatever the state; otherwise the state's badge. */
export function StateBadge({ state, offline }: { state: BotState; offline?: boolean }): JSX.Element {
  const { t } = useI18n();
  return offline ? <Badge state="readonly" label={t.atelier.offline} /> : <Badge state={state} />;
}
