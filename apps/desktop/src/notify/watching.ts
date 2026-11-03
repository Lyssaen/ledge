/** The session whose agent screen Ledge shows live (its page on the Terminal view, the window focused), or null: a subagent's
 *  page shows its parent's screen read only, not its own. */
export function watchedSession(s: { focused: boolean; agentView: boolean; placeId: string | null; helper: string | undefined }): string | null {
  return s.focused && s.agentView && s.placeId !== null && s.helper === undefined ? s.placeId : null;
}
