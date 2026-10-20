/** The session whose agent screen Ledge shows live, or null: a subagent's page shows a notice, not the agent's screen. */
export function watchedSession(s: { focused: boolean; terminal: boolean; placeId: string | null; helper: string | undefined; active: string; agentTab: string }): string | null {
  return s.focused && s.terminal && s.placeId !== null && s.helper === undefined && s.active === s.agentTab ? s.placeId : null;
}
