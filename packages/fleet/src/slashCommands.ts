import { useEffect, useState } from 'react';
import type { SlashCommand, Tool } from '@ledge/protocol';
import type { DaemonClient } from './client';

export interface SlashCommandsState { status: 'idle' | 'loading' | 'ready'; commands: readonly SlashCommand[]; tool?: Tool; error?: string }
const IDLE: SlashCommandsState = { status: 'idle', commands: [] };
const LOADING: SlashCommandsState = { status: 'loading', commands: [] };
/** How long an answer is shown again without asking: the daemon keeps its own, longer, and sees a commands folder change. */
export const SLASH_KEEP_MS = 2 * 60_000;
/** Answers received this run, per session: the list opens at once the next time « / » is typed. */
const known = new Map<string, { at: number; state: SlashCommandsState }>();
let next = 0;

/**
 * The slash commands of a session's agent, asked of its machine once `wanted` (the first « / » typed), with its own
 * requestId. A failure (an agent Ledge does not list, offline, an older daemon: `outdated`) is ready with its `error`, and
 * not kept, so the next « / » asks again.
 */
export function useSlashCommands(client: DaemonClient | undefined, sessionId: string, wanted: boolean, now: () => number = Date.now): SlashCommandsState {
  const [answer, setAnswer] = useState<{ id: string; state: SlashCommandsState } | null>(null);
  const kept = known.get(sessionId);
  const fresh = kept && now() - kept.at < SLASH_KEEP_MS ? kept.state : undefined;
  const ask = wanted && !!client && !fresh;
  useEffect(() => {
    if (!ask || !client) return;
    const requestId = `commands-${++next}`;
    const off = client.onMessage(m => {
      if (m.type !== 'session.commands.listing' || m.requestId !== requestId) return;
      const state: SlashCommandsState = { status: 'ready', commands: m.commands, ...(m.tool ? { tool: m.tool } : {}), ...(m.error ? { error: m.error } : {}) };
      if (!m.error) known.set(sessionId, { at: now(), state });
      setAnswer({ id: sessionId, state });
    });
    client.send({ type: 'session.commands', requestId, id: sessionId });
    return off;
  }, [ask, client, sessionId]);
  if (fresh) return fresh;
  if (!wanted && !answer) return IDLE;
  // A failed answer is shown until the « / » is typed again; a new ask shows loading.
  if (answer && answer.id === sessionId && (!ask || answer.state.error)) return answer.state;
  return client ? LOADING : IDLE;
}

/** For tests: forget the answers kept this run. */
export function forgetSlashCommands(): void { known.clear(); }
