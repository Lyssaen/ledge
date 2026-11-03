import { agentTabId, type TermStore } from '../term/store';

/** Where the keyboard goes when the Terminal view comes (Ctrl + ², a click on its tab): into the agent's screen when it can be
 *  typed into, else to its banner's button (Aller à Otto, Réessayer, Ouvrir un shell), never onto a read-only screen. Out of
 *  AgentView so that App, in the first bundle, reaches it without the session chunk. */
/** How many frames the keyboard waits for the view to be drawn. */
const FRAMES = 30;

export function focusAgentView(store: TermStore | null, sessionId: string, tries = FRAMES): void {
  const view = document.querySelector<HTMLElement>('.agent-view');
  // Not drawn yet (the view just asked for, the session page's chunk still loading): a few frames more.
  if (!view) { if (tries > 0) requestAnimationFrame(() => focusAgentView(store, sessionId, tries - 1)); return; }
  if (view.dataset.typeable === 'true') { store?.surface(agentTabId(sessionId))?.focus(); return; }
  view.querySelector<HTMLElement>('.term-banner button, .agent-native button')?.focus();
}
