import { useEffect, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { ModelChoice, Tool } from '@ledge/protocol';

export interface ModelsState { status: 'idle' | 'loading' | 'ready'; models: readonly ModelChoice[]; error?: string }
const IDLE: ModelsState = { status: 'idle', models: [] };
const LOADING: ModelsState = { status: 'loading', models: [] };
/** Answers already received this run, per machine and agent: a form opened again shows them at once (the daemon keeps its own TTL). */
const known = new Map<string, ModelsState>();
let next = 0;

/** The models an agent offers on a machine (#58): one `models.list` per (machine, agent), with its own requestId. A failure
 *  (not installed, offline, an older daemon: `outdated`) is ready with its `error`, and not kept, so the next form asks again. */
export function useModels(client: DaemonClient, machine: string | null, tool: Tool | null): ModelsState {
  const key = machine === null || tool === null ? null : `${machine}|${tool}`;
  const [answer, setAnswer] = useState<{ key: string; state: ModelsState } | null>(null);
  useEffect(() => {
    if (key === null || machine === null || tool === null || known.has(key)) return;
    const requestId = `models-${++next}`;
    const off = client.onMessage(m => {
      if (m.type !== 'models.listing' || m.requestId !== requestId) return;
      const state: ModelsState = { status: 'ready', models: m.models, ...(m.error ? { error: m.error } : {}) };
      if (!m.error) known.set(key, state);
      setAnswer({ key, state });
    });
    client.send({ type: 'models.list', requestId, tool, machineId: machine });
    return off;
  }, [client, key, machine, tool]);
  if (key === null) return IDLE;
  return known.get(key) ?? (answer && answer.key === key ? answer.state : LOADING);
}

/** For tests: forget the answers kept this run. */
export function forgetModels(): void { known.clear(); }
