import { createContext, useContext } from 'react';
import type { Exchange, MandateCategory } from '@ledge/protocol';

/** Day separators of the thread: `date` gets a local `YYYY-MM-DD` older than yesterday (« 28/10 »). */
export interface DayWords { today: string; yesterday: string; date: (day: string) => string }
/** An age in words: `now` under a minute, a span, and `ago` around it (« il y a 4 min »). */
export interface AgeWords { now: string; minutes: (n: number) => string; hours: (n: number) => string; days: (n: number) => string; ago: (span: string) => string }

/** The words of Ledge's thread (lot 4): the decision in message, the exchange groups, the bubbles and the settled line.
 *  Each app fills it from its own messages; `@ledge/ui` declares the shape and owns no copy. */
export interface LedgeThreadCopy {
  days: DayWords;
  age: AgeWords;
  /** A mandate category as people read it (the app maps `MANDATE_CATEGORY_LABEL`). */
  category: (c: MandateCategory) => string;
  /** The authors over the bubbles: « Ledge », « Toi ». */
  bubbles: { ledge: string; you: string };
  escalation: {
    /** « Mon avis : <advice> ». */
    advice: (text: string) => string;
    talk: string; grace: string;
    /** « Répondu par toi : <libellé> », « Tranché par Ledge : <libellé> ». */
    answeredByYou: (label: string) => string; answeredByLedge: (label: string) => string;
    alreadyAnswered: string;
    /** An escalation closed elsewhere without an answer the card knows. */
    closed: string;
    /** A refusal other than `already_answered`: the daemon's reason when it gave one. */
    refused: (code: string, reason?: string) => string;
    /** The single button of an update (« Vu »). */
    seen: string;
    /** The one-line field of an ask (R16): its accessible name, its placeholder and its button. */
    askLabel: string; askPlaceholder: string; send: string;
  };
  exchanges: {
    /** « 3 échanges entre agents », « 1 échange ». */
    count: (n: number) => string;
    fold: string; unfold: string;
    missing: (n: number) => string;
    kind: Record<Exchange['kind'], string>;
  };
  decided: {
    /** « J'ai tranché pour build : merge, pas de rebase ». */
    line: (to: string, summary: string) => string;
    /** The rule a decision applied, by its id, when the rule is no longer known (`LedgeDecision.rule`). */
    rule: (rule: string) => string;
    /** The rule a decision applied, by the local day it holds since (`LedgeRule.since`, `YYYY-MM-DD`): « Règle du 26/10 ». */
    ruleOf: (since: string) => string;
    revisit: string;
  };
  /** The bubble « Ledge est arrêté · Démarrer » (lot 7): its text and its button, which turns the brain on. */
  brain: { stopped: string; start: string };
}

const LedgeThreadCopyContext = createContext<LedgeThreadCopy | null>(null);
export const LedgeThreadCopyProvider = LedgeThreadCopyContext.Provider;
/** The thread's copy; there is no default language, so a missing provider is a wiring error. */
export function useLedgeThreadCopy(): LedgeThreadCopy {
  const copy = useContext(LedgeThreadCopyContext);
  if (!copy) throw new Error('LedgeThreadCopyProvider missing: wrap the thread in <LedgeThreadCopyProvider value={…}>');
  return copy;
}
