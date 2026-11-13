import type { UsageHarness, UsageStateMessage } from '@ledge/protocol';

/** What « Comptes lus » says of one account on one machine (docs/mockups/ledge-usage-sign-in.html, #301; design-ux 09:43Z). */
export type AccountState =
  | { kind: 'signIn' }                 // refused: « reconnexion nécessaire », the only warning
  | { kind: 'read'; at: string }       // read now: « lu il y a … »
  | { kind: 'last'; at: string }       // an old read (stale, unreachable, machine offline, reading again): « dernière lecture il y a … »
  | { kind: 'never' }                  // first read under way: « pas encore lu »
  | { kind: 'unreachable' };           // never read and cannot be: « injoignable »

export interface AccountRow { harness: UsageHarness; machine: string; state: AccountState }

const ORDER: Record<UsageHarness, number> = { claude: 0, codex: 1, cursor: 2 };

/**
 * One row per harness and machine, in the footer's order (Claude Code, Codex, Cursor Agent), then the machines' order. A harness
 * never signed in is not listed by its daemon, so it has no row (as in the bar). `machines`: the machines' ids in display order;
 * `online(id)`: is it connected now.
 */
export function accountRows(states: ReadonlyMap<string, UsageStateMessage>, machines: readonly string[], online: (id: string) => boolean): AccountRow[] {
  const rank = (id: string) => { const i = machines.indexOf(id); return i < 0 ? machines.length : i; };
  const rows: AccountRow[] = [];
  for (const [machine, msg] of states) {
    const up = online(machine);
    for (const h of msg.harnesses) {
      const old = (): AccountState => (h.readAt ? { kind: 'last', at: h.readAt } : { kind: 'unreachable' });
      const state: AccountState =
        h.status === 'expired' ? { kind: 'signIn' }
        : !up ? old()
        : h.status === 'ok' ? (h.readAt ? { kind: 'read', at: h.readAt } : { kind: 'never' })
        : h.status === 'loading' ? (h.readAt ? { kind: 'last', at: h.readAt } : { kind: 'never' })
        : old();
      rows.push({ harness: h.harness, machine, state });
    }
  }
  return rows.sort((a, b) => ORDER[a.harness] - ORDER[b.harness] || rank(a.machine) - rank(b.machine));
}
