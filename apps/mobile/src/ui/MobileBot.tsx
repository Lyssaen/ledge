import type { SessionState, Tool } from '@ledge/protocol';
import { Bot } from '@ledge/ui/bots/Bot';
import { poseFor, type BotState } from '@ledge/ui/bots/poseFor';

/** The phone gets no helpers, so a session's own state is the bot's. */
const BOT_STATE: Record<SessionState, BotState> = {
  starting: 'starting', working: 'working', waiting_input: 'question', waiting_permission: 'approval', idle: 'idle', exited: 'done', error: 'error'
};

/**
 * A session's mascot, the one the PC shows (the phone is dark only). `seed` is the session's id, never its name.
 * `frozen` while what is shown is only the last known state.
 */
export function MobileBot({ tool, seed, state, large = false, frozen = false }: { tool: Tool; seed: string; state: SessionState; large?: boolean; frozen?: boolean }) {
  const s = BOT_STATE[state];
  return (
    <span className="inline-flex flex-none" aria-hidden="true">
      <Bot tool={tool} seed={seed} state={s} pose={poseFor(seed, s)} size={large ? 68 : 34} theme="dark" frozen={frozen} />
    </span>
  );
}
