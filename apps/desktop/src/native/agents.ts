import { useEffect, useSyncExternalStore } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { AgentStatus, AgentsInstalled, InstallableTool } from '@ledge/protocol';

/** Claude Code and Codex on native Windows (spec 2026-11-03 §4.2.6): which are installed, as the local daemon says, and
 *  one install at a time, on the user's click. Shared by Settings' Agents card and the launch form. */
export interface AgentsView {
  agents: readonly AgentStatus[] | null;
  installing: InstallableTool | null;
  last: Omit<AgentsInstalled, 'type' | 'requestId'> | null;
}

const EMPTY: AgentsView = { agents: null, installing: null, last: null };
let state: AgentsView = EMPTY;
const listeners = new Set<() => void>();
let seq = 0, pendingStatus: string | null = null, pendingInstall: string | null = null;
let attached: { client: DaemonClient; off: () => void } | null = null;

const set = (patch: Partial<AgentsView>) => { state = { ...state, ...patch }; for (const l of listeners) l(); };

function attach(client: DaemonClient): void {
  if (attached?.client === client) return;
  attached?.off();
  const off = client.onMessage(m => {
    if (m.type === 'agents.listing' && m.requestId === pendingStatus) { pendingStatus = null; set({ agents: m.agents }); }
    if (m.type === 'agents.installed' && m.requestId === pendingInstall) {
      pendingInstall = null;
      const { type: _t, requestId: _r, ...last } = m;
      set({ installing: null, last });
      refreshAgents(client);
    }
  });
  attached = { client, off };
}

/** Asks the local daemon which agents are installed. */
export function refreshAgents(client: DaemonClient): void {
  attach(client);
  pendingStatus = `agents-${++seq}`;
  client.send({ type: 'agents.status', requestId: pendingStatus });
}

/** Installs `tool` with its official installer; ignored while another install runs. */
export function installAgent(client: DaemonClient, tool: InstallableTool): void {
  attach(client);
  if (state.installing) return;
  pendingInstall = `agents-install-${++seq}`;
  set({ installing: tool, last: null });
  client.send({ type: 'agents.install', requestId: pendingInstall, tool });
}

/** The agents' state; asked once `offered` (the local daemon says it offers agents). */
export function useAgents(client: DaemonClient, offered: boolean): AgentsView {
  const view = useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => state, () => state);
  useEffect(() => { if (offered) refreshAgents(client); }, [client, offered]);
  return offered ? view : EMPTY;
}

/** For tests: forget what was asked this run. */
export function forgetAgents(): void { attached?.off(); attached = null; state = EMPTY; pendingStatus = pendingInstall = null; }
