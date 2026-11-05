import { useEffect, useMemo, useState } from 'react';
import { useUsage, type DaemonClient, type MachineState } from '@ledge/fleet';
import type { UsageAlert } from '@ledge/protocol';
import { usageAlerts, usageGroups, usageThreshold, type UsageGroup } from './model';

/** Now, every `ms`: the ages and the « dans 2 h 10 » move on their own. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

export interface UsageView { groups: UsageGroup[]; threshold: number; alerts: UsageAlert[]; now: number; label(machine: string): string }

/** Every machine's harness limits as the footer, « À toi » and the settings show them. */
export function useUsageView(client: DaemonClient, machines: readonly MachineState[]): UsageView {
  const states = useUsage(client);
  const now = useNow();
  return useMemo(() => {
    const byId = new Map(machines.map(m => [m.id, m]));
    return {
      groups: usageGroups(states, id => byId.get(id)?.status === 'open', now),
      threshold: usageThreshold(states),
      alerts: usageAlerts(states, id => byId.get(id)?.status === 'open', now),
      now,
      label: id => byId.get(id)?.label ?? id
    };
  }, [states, machines, now]);
}
