import { createContext } from 'react';

/** What the thread's cards need from the page to open the « Conversation » tab. In the app this is two props on Thread
 *  (as `planOpen` / `onPlan` for plans): the peerKey of the active conversation tab, and the callback that opens one. */
export interface ConversationLink {
  /** The peerKey whose tab is the pane's active one; null: none. */
  open: string | null;
  onOpen(key: string): void;
}
export const ConversationContext = createContext<ConversationLink>({ open: null, onOpen: () => {} });
