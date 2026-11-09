import { useEffect, useRef } from 'react';
import type { UsageAlert } from '@ledge/protocol';
import { readJson, writeJson } from '../state/storage';

/** The usage alerts the IDE has told, kept across restarts: each one is said once (the user, 2026-11-09), never as a card in « À toi ». */
export const USAGE_TOLD_KEY = 'ledge.ide.usageTold';
const MAX = 200;

const load = (): string[] => { const r = readJson(USAGE_TOLD_KEY); return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : []; };

/** The alerts not told yet, now marked told (past 200 ids the oldest are forgotten: their windows started again long ago). */
export function untold(alerts: readonly UsageAlert[], told: string[]): UsageAlert[] {
  const fresh = alerts.filter(a => !told.includes(a.id));
  if (fresh.length) { told.push(...fresh.map(a => a.id)); told.splice(0, Math.max(0, told.length - MAX)); }
  return fresh;
}

/** While the IDE shows, each new usage alert in one toast, once. */
export function useUsageTold(on: boolean, alerts: readonly UsageAlert[], notify: (text: string) => void, say: (a: UsageAlert) => string): void {
  const told = useRef<string[] | null>(null);
  const live = useRef({ notify, say });
  live.current = { notify, say };
  const key = alerts.map(a => a.id).join('\n');
  useEffect(() => {
    if (!on) return;
    told.current ??= load();
    const fresh = untold(alerts, told.current);
    if (!fresh.length) return;
    writeJson(USAGE_TOLD_KEY, told.current);
    live.current.notify(fresh.map(a => live.current.say(a)).join(' · '));
  }, [on, key]);
}
