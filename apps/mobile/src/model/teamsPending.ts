import type { PhoneTeam } from '@ledge/protocol';

/** What a seat runs with once every default is resolved: its own value, else its role's. */
export interface SeatSettings { tool?: string; model?: string; effort?: string }
/** What a composition leaves to do on a seat: a restart (its tool changed), or its IA / effort taking effect at its next start. */
export interface SeatPending { restart: boolean; next: boolean }

/**
 * What every seat of a live team runs with, from when the editor opened: the seats that are leaving too, since they run until their
 * turn ends. A seat's own composed value wins; `fallback` gives its role's default for what it did not set.
 * It is the baseline of `pendingAfter`, and moves only when a seat is (re)started, never on a composition.
 */
export function runningSettings(team: PhoneTeam, fallback: (role: string) => SeatSettings | undefined): Map<string, SeatSettings> {
  return new Map(team.seats.map(s => {
    const d = fallback(s.role);
    return [s.role, { tool: s.tool ?? d?.tool, model: s.model ?? d?.model, effort: s.effort ?? d?.effort }];
  }));
}

/**
 * What the last applied composition (`sent`, each seat with its resolved settings) leaves to do, against what each seat runs with (`ran`).
 * A tool that differs needs a restart; an IA or effort that differs shows at the seat's next start. A seat with nothing running
 * under its role (just added) has nothing to compare with, and gets nothing. Changing a value and then back leaves nothing to do.
 */
export function pendingAfter(ran: ReadonlyMap<string, SeatSettings>, sent: ReadonlyArray<SeatSettings & { role: string }>): Record<string, SeatPending> {
  const out: Record<string, SeatPending> = {};
  for (const s of sent) {
    const was = ran.get(s.role);
    if (!was) continue;
    const restart = was.tool !== s.tool;
    const next = was.model !== s.model || was.effort !== s.effort;
    if (restart || next) out[s.role] = { restart, next };
  }
  return out;
}
