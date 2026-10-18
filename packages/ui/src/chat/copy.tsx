import { createContext, useContext } from 'react';

type Say = (s: string) => string;
type Steps = { sessions: string; pane: Say; reply: Say; git: Say; repo: Say };

/** The words the shared Ledge chat speaks: the `chat.*` keys, the `machines.*` and `time.*` keys its cards and times read,
 *  and the offline line. Each app fills it from its own messages; `@ledge/ui` declares the shape and owns no copy. */
export interface ChatCopy {
  chat: {
    title: string; subtitle: (sessions: number, repos: number) => string;
    ask: string; askPlaceholder: string; open: string; send: string; stop: string; reset: string; back: string; close: string;
    emptyTitle: string; emptyHint: (sessions: number) => string; starters: string; chips: string[]; thinking: string;
    step: Steps; source: Steps;
    sources: string; sourcesNone: string; ago: Say; error: Say; stopped: string;
    card: {
      label: string; folder: string; tool: string; byDefault: Say; prompt: string; noPrompt: string;
      launch: string; launching: string; retry: string; orRephrase: string; orFolder: string;
      failed: Say; started: string; startedUnknown: string; terminal: string;
    };
    relay: {
      label: string; session: string; instruction: string;
      send: string; sending: string; cancel: string; retry: string; orRephrase: string;
      queued: string; sentTo: string; failed: Say;
      pill: { yours: string; working: string; waiting: string; stopped: string };
    };
    /** The project card (lot 11): `title` a new project, `complete` an existing one to add to. Desktop only shows it; the island fills it. */
    project: { label: string; title: Say; complete: Say; repos: (n: number) => string; review: string };
  };
  machines: { destination: string; local: string; offline: string; choose: Say; clarification: string };
  time: { seconds: (n: number) => string; minutes: (n: number) => string; hours: (n: number) => string; locale: string };
  /** Why questions cannot be sent while the daemon is away. */
  offline: string;
}

const ChatCopyContext = createContext<ChatCopy | null>(null);
export const ChatCopyProvider = ChatCopyContext.Provider;
/** The chat's copy; the chat has no default language, so a missing provider is a wiring error. */
export function useChatCopy(): ChatCopy {
  const copy = useContext(ChatCopyContext);
  if (!copy) throw new Error('ChatCopyProvider missing: wrap the chat in <ChatCopyProvider value={…}>');
  return copy;
}
