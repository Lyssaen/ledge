import type { JSX } from 'react';
import type { Helper, Session } from '@ledge/protocol';
import { Bot } from '@ledge/ui/bots/Bot';
import { botState, poseFor, type BotState } from '@ledge/ui/bots/poseFor';
import { Badge } from '@ledge/ui/ui/Badge';
import { Icon } from '@ledge/ui/ui/icons';
import { helperState } from '../atelier/layout';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { cls } from './cls';
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

const ZAP = ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'];
const SHIELD = ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'];

/** OMP launched with another approval than « ask » (mockup omp-sessions): « Fichiers auto » quiet, « Auto » in the danger tone; nothing
 *  for the asking default nor for the other harnesses. */
export function ApprovalBadge({ session }: { session: Pick<Session, 'tool' | 'approval'> }): JSX.Element | null {
  const { t } = useI18n();
  if (session.tool !== 'omp' || !session.approval || session.approval === 'always-ask') return null;
  const [label, hint] = t.launch.approvals[session.approval];
  return <span className={cls('approval-badge', session.approval)} title={hint}><Icon d={session.approval === 'yolo' ? ZAP : SHIELD} size={12} />{label}</span>;
}

/** The sidebar's mark for an OMP session in auto mode: the bolt beside its name. */
export function AutoMark({ session }: { session: Pick<Session, 'tool' | 'approval'> }): JSX.Element | null {
  const { t } = useI18n();
  if (session.tool !== 'omp' || session.approval !== 'yolo') return null;
  return <span className="auto-mark" role="img" aria-label={t.launch.approvals.yolo[0]} title={t.launch.approvals.yolo[1]}><Icon d={ZAP} size={11} /></span>;
}
