import type { ActionWords } from './actionWords';
import { createContext, useContext } from 'react';

type Say = (s: string) => string;
type Steps = { sessions: string; pane: Say; reply: Say; git: Say; repo: Say };

/** The words the shared Ledge chat speaks: the `chat.*` keys, the `machines.*` and `time.*` keys its cards and times read,
 *  and the offline line. Each app fills it from its own messages; `@ledge/ui` declares the shape and owns no copy. */
export interface ChatCopy {
  chat: {
    title: string; subtitle: (sessions: number, repos: number) => string;
    /** The ✕ of an image chip under the field; a front without images leaves it out. */
    removeImage?: string;
    ask: string; askPlaceholder: string; open: string; send: string; stop: string; reset: string; back: string; close: string;
    emptyTitle: string; emptyHint: (sessions: number) => string; starters: string; chips: string[]; thinking: string;
    step: Steps; source: Steps;
    sources: string; sourcesNone: string; ago: Say; error: Say; stopped: string;
    card: {
      label: string; folder: string; tool: string; byDefault: Say; prompt: string; noPrompt: string;
      launch: string; launching: string; retry: string; orRephrase: string; orFolder: string;
      failed: Say; started: string; startedUnknown: string; terminal: string;
    };
    /** The card of an answer that proposes several sessions (#24): `pick` names a row's checkbox. */
    group: { label: (n: number) => string; launchAll: (n: number) => string; launchRow: string; pick: Say };
    /** The card of an answer that proposes to close sessions: a row's end state is `closed`, `killed` (force closed) or `ended` (it had exited already). */
    closeGroup: { label: (n: number) => string; row: string; all: (n: number) => string; closing: string; closed: string; killed: string; ended: string; retry: string; failed: Say };
    relay: {
      label: string; session: string; instruction: string;
      send: string; sending: string; cancel: string; retry: string; orRephrase: string;
      queued: string; sentTo: string; failed: Say;
      pill: { yours: string; working: string; waiting: string; stopped: string };
    };
    /** The project card (lot 11): `title` a new project, `complete` an existing one to add to. Desktop only shows it; the island fills it. */
    project: { label: string; title: Say; complete: Say; repos: (n: number) => string; review: string };
    /** The generic card (#94): a row per action, a plan past one. `verbs` the button of each action, by its id, `apply`
     *  when the front knows none; `at` a time already put in words (10:42), empty when the daemon gave none. Left out by a front that does not show it yet. */
    action?: ActionCopy;
    /** The « Lancer ce rig » card the brain posts (lot 7): its accessible name and its button. Left out by a front that cannot open the launch window. */
    rigLaunch?: { label: string; launch: string };
  };
  machines: { destination: string; local: string; offline: string; choose: Say; clarification: string };
  time: { seconds: (n: number) => string; minutes: (n: number) => string; hours: (n: number) => string; locale: string };
  /** Why questions cannot be sent while the daemon is away. */
  offline: string;
}

type Risk = 'read' | 'reversible' | 'destructive';
export interface ActionCopy {
  label: (n: number) => string; risk: Record<Risk, string>; riskTip: Record<Risk, string>;
  step: (k: number) => string; stepState: Record<'done' | 'failed' | 'refused' | 'running', (k: number) => string>; askAgain: string;
  verbs: Record<string, string>; apply: string; deny: string; ignore: string; review: string; retry: string; running: string;
  done: Say; refusedState: string; denied: Say; open: Say;
  failed: Say; refused: Say; held: (k: number) => string; stale: Say; deniedNote: Say;
  all: (n: number) => string; resume: (k: number, n: number) => string; skip: (k: number, n: number) => string;
  inOrder: string; destructiveLater: (n: number) => string; notReplayed: string; progress: (k: number, n: number) => string; planDone: Say;
  confirm: {
    label: string; many: (n: number, all: boolean) => string; one: Say; oneWhy: string; manyWhy: (destructive: number) => string;
    cancel: string; go: (n: number) => string; alreadyDone: string;
  };
  /** `sent`: the rows applied, denied or failed before the card was set aside; none, and nothing was sent. */
  ignored: (n: number, at: string, sent?: { done: number; denied: number; failed: number }) => string;
  /** The rows' lines and why one was refused, from their `vars` (actionWords.ts). */
  words: ActionWords;
}

const ChatCopyContext = createContext<ChatCopy | null>(null);
export const ChatCopyProvider = ChatCopyContext.Provider;
/** The chat's copy; the chat has no default language, so a missing provider is a wiring error. */
export function useChatCopy(): ChatCopy {
  const copy = useContext(ChatCopyContext);
  if (!copy) throw new Error('ChatCopyProvider missing: wrap the chat in <ChatCopyProvider value={…}>');
  return copy;
}
