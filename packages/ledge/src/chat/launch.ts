// Starts the sessions of a chat card (spec 2026-10-12 §4), for the PC's overlays and for a phone alike.
import type { ChatProposal } from '@ledge/protocol';
import type { Chat, ChatMessage } from './service.js';

export interface LaunchDeps {
  chat: Pick<Chat, 'proposal' | 'markLaunched' | 'markFailed'>;
  /** Starts the agent for a proposal and returns the session's id; throws the reason. */
  launch: (p: ChatProposal) => Promise<string>;
  emit: (m: ChatMessage) => void;
  /** The `qid#row` launches under way, shared by every caller: a second click is passed over until the first one has answered. */
  inFlight: Set<string>;
  /** Why a proposal is not launched (the phone refuses a folder too wide), or null. The card row is marked failed, nothing starts. */
  refuse?: (p: ChatProposal) => string | null;
}

/** Thrown when no row can start at all: every one is already launched, or the card has no such row. */
export class LaunchRefused extends Error {}

/** A chat card's rows (#24) start one after the other, so each launch registers its bot before the next picks a name; a launched row, or one in flight, is passed over. */
export async function launchFromChat(deps: LaunchDeps, qid: string, rows: number[] = [0]): Promise<{ launched: string[]; failed: number }> {
  const { chat, inFlight } = deps;
  const todo = [...new Set(rows)].filter(r => { const p = chat.proposal(qid, r); return p && !p.launchedId && !inFlight.has(`${qid}#${r}`); });
  if (todo.length === 0) throw new LaunchRefused(rows.some(r => chat.proposal(qid, r)) ? 'already launched' : 'unknown proposal');
  for (const r of todo) inFlight.add(`${qid}#${r}`);
  const launched: string[] = [];
  let failed = 0;
  try {
    for (const r of todo) {
      // Re-checked: a concurrent caller may have launched the row since the filter.
      const p = chat.proposal(qid, r);
      if (!p || p.launchedId) { inFlight.delete(`${qid}#${r}`); continue; }
      try {
        const refused = deps.refuse?.(p) ?? null;
        if (refused !== null) throw new Error(refused);
        const id = await deps.launch(p);
        launched.push(id);
        chat.markLaunched(qid, id, deps.emit, r);
      } catch (e) { failed++; chat.markFailed(qid, (e as Error).message, deps.emit, r); }
      finally { inFlight.delete(`${qid}#${r}`); }
    }
  } finally { for (const r of todo) inFlight.delete(`${qid}#${r}`); }
  return { launched, failed };
}
