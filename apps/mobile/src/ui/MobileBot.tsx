import type { SessionState, Tool } from '@ledge/protocol';
import { Bot } from '@ledge/ui/bots/Bot';
import { ResidentMascot, type ResidentMascotProps } from '@ledge/ui/bots/ResidentMascot';
import { poseFor, type BotState } from '@ledge/ui/bots/poseFor';
import { useTheme } from '../theme';

/** The phone gets no helpers, so a session's own state is the bot's. */
const BOT_STATE: Record<SessionState, BotState> = {
  starting: 'starting', working: 'working', waiting_input: 'question', waiting_permission: 'approval', idle: 'idle', exited: 'done', error: 'error'
};

/**
 * A session's mascot, the one the PC shows, in the theme shown. `seed` is the session's id, never its name.
 * `frozen` while what is shown is only the last known state.
 */
export function MobileBot({ tool, seed, state, large = false, frozen = false }: { tool: Tool; seed: string; state: SessionState; large?: boolean; frozen?: boolean }) {
  const s = BOT_STATE[state];
  const theme = useTheme();
  return (
    <span className="inline-flex flex-none" aria-hidden="true">
      <Bot tool={tool} seed={seed} state={s} pose={poseFor(seed, s)} size={large ? 68 : 34} theme={theme} frozen={frozen} />
    </span>
  );
}

/** Ledge's own mascot, in the theme shown. */
export function Mascot(props: Omit<ResidentMascotProps, 'theme'>) {
  return <ResidentMascot {...props} theme={useTheme()} />;
}
