import type { Session } from '@ledge/protocol';

export type SessionAction = 'terminal' | 'interrupt' | 'kill' | 'dismiss' | 'rename';
export type ActionReason = 'offline' | 'noTerminal' | 'idle';
export interface ActionState { shown: boolean; enabled: boolean; reason?: ActionReason }
export const SESSION_ACTIONS: readonly SessionAction[] = ['terminal', 'interrupt', 'kill', 'dismiss', 'rename'];
const BUSY: readonly Session['state'][] = ['starting', 'working', 'waiting_permission', 'waiting_input'];

/** The session actions of spec §9.1. A local session opens its terminal by title even without tmux (island parity); a remote
 *  one needs the fleet's command and a tmux session. Stop is for launcher sessions still running; Dismiss for finished or
 *  hook-only ones. Offline disables everything (spec §14). */
export function sessionActions(s: Session, terminal: string[] | null): Record<SessionAction, ActionState> {
  const live = s.source !== 'hook_only' && s.state !== 'exited';
  const remote = !!s.machineId && s.machineId !== 'local';
  const on = (shown: boolean, ok: boolean, reason?: ActionReason): ActionState =>
    s.offline ? { shown, enabled: false, reason: 'offline' } : ok ? { shown, enabled: true } : { shown, enabled: false, ...(reason ? { reason } : {}) };
  return {
    terminal: on(true, !remote || (!!terminal && !!s.tmuxSession), 'noTerminal'),
    interrupt: on(live, BUSY.includes(s.state), 'idle'),
    kill: on(live, true),
    dismiss: on(s.state === 'exited' || s.source === 'hook_only', true),
    rename: on(true, true)
  };
}
